import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const nativeRequire = createRequire(import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));

// Render the real page and hero with isolated records; never connect to live data.
function loadComponent(file, mocks) {
  const filename = path.join(testDirectory, '..', file);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(output, {
    module: compiledModule, exports: compiledModule.exports,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'react' || name === 'react/jsx-runtime') return nativeRequire(name);
      if (name.endsWith('.css')) return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } },
    URL, setTimeout, clearTimeout,
  }, { filename });
  return compiledModule.exports.default;
}

async function renderAgents(primary, coLister) {
  const site = { id: 'site-fixture', client_id: 'primary', paid: true, property_address: '123 Example Street', property_city: 'Sacramento', property_state: 'CA', property_zip: '95814', beds: 3, baths: 2, sqft: 1800, site_data: { video_url: 'https://vimeo.com/123456', listing_mls_number: 'MLS-123' } };
  const profiles = {
    primary: { full_name: 'Primary Agent', phone: '555-0100', email: 'primary@example.invalid', mls_license: '12345', ...primary },
    secondary: { full_name: 'Second Agent', phone: '555-0200', email: 'second@example.invalid', mls_license: '67890', ...coLister },
  };
  const createClient = () => ({ from(table) {
    let profileId;
    const result = () => ({ data: table === 'sites' ? site : table === 'profiles' ? profiles[profileId] : table === 'site_co_listers' ? (coLister ? { profile_id: 'secondary' } : null) : [{ id: 'photo-1', category: 'photo', cloudinary_secure_url: '/property.jpg', is_primary: true }] });
    const query = { select() { return query; }, or() { return query; }, limit() { return query; }, order() { return query; }, eq(key, value) { if (table === 'profiles' && key === 'id') profileId = value; return query; }, maybeSingle: async () => result(), then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
    return query;
  } });
  const Hero = loadComponent('app/sites/[id]/PropertyHeroSlideshow.tsx', {});
  const Page = loadComponent('app/sites/[id]/page.tsx', {
    '@supabase/supabase-js': { createClient },
    'next/navigation': { notFound() { throw new Error('Unexpected notFound'); } },
    '@/lib/property-site-slug': { makePropertySiteSlug: () => '123example', normalizePropertySiteSlug: value => value, propertySiteUrl: () => 'https://example.invalid/123example' },
    '@/lib/property-format': { formatLotSize: () => '' },
    '@/lib/supabase/server': { createSupabaseServerClient() { throw new Error('Paid site should not require staff auth'); } },
    './PropertyHeroSlideshow': Hero,
    './PropertyGallery': () => React.createElement('div', { 'data-gallery': true }),
    './SiteTrafficTracker': () => null,
    './PropertyContactPanel': () => React.createElement('form', { 'data-contact': true }),
  });
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: '123example' }) }));
}

for (const brokerage of [undefined, '', '   ', 'Not added', ' NOT ADDED ', 'not\tadded']) {
  test(`missing brokerage and photo are omitted for both agents: ${JSON.stringify(brokerage)}`, async () => {
    const html = await renderAgents({ brokerage_name: brokerage }, { brokerage_name: brokerage });
    assert.doesNotMatch(html, /not\s+added/i);
    assert.doesNotMatch(html, /agent-placeholder|listing-agent-photo|<span>[PS]<\/span>/);
    assert.equal((html.match(/listing-agent-main without-photo/g) || []).length, 2);
    for (const text of ['Primary Agent', 'Second Agent', '555-0100', '555-0200', '12345', '67890', 'MLS-123', 'href="#video"', 'href="#gallery"', 'data-contact', 'data-gallery']) assert.ok(html.includes(text), `Preserves ${text}`);
  });
}

test('existing photos, brokerage names, logos, and contact details remain visible', async () => {
  const html = await renderAgents(
    { brokerage_name: 'Primary Realty', profile_photo_url: '/primary.jpg', brokerage_logo1_url: '/logo.jpg' },
    { brokerage_name: 'Second Realty', profile_photo_url: '/secondary.jpg' },
  );
  for (const name of ['Primary Realty', 'Second Realty']) {
    assert.ok(html.includes(`<small>${name}</small>`));
    assert.ok(html.includes(`<p>${name}</p>`));
  }
  for (const photo of ['/primary.jpg', '/secondary.jpg']) assert.equal(html.split(`src="${photo}"`).length - 1, 2, `${photo} appears in hero and contact`);
  assert.ok(html.includes('/logo.jpg'));
  assert.doesNotMatch(html, /without-photo/);
});

test('one missing photo does not hide the other agent photo or brokerage logo', async () => {
  const html = await renderAgents(
    { brokerage_name: 'Not added', brokerage_logo1_url: '/logo.jpg' },
    { brokerage_name: 'Second Realty', profile_photo_url: '/secondary.jpg' },
  );
  assert.doesNotMatch(html, /not added/i);
  assert.ok(html.includes('/logo.jpg'));
  assert.equal(html.split('src="/secondary.jpg"').length - 1, 2);
  assert.equal((html.match(/listing-agent-main without-photo/g) || []).length, 1);
});

test('single-agent listings keep their contact details without an extra agent card', async () => {
  const html = await renderAgents({});
  assert.ok(html.includes('Primary Agent'));
  assert.doesNotMatch(html, /Second Agent|Co-listing contact/);
  assert.equal((html.match(/listing-agent-main without-photo/g) || []).length, 1);
});
