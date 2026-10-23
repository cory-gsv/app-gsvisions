import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
function load(file, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, console, require: name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (['react', 'react/jsx-runtime', 'next/server'].includes(name)) return require(name);
      if (name.endsWith('.css')) return {};
      throw Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
}
const listing = load('lib/property-listing.ts');
const saved = { listing_status: 'pending', open_house_enabled: true, open_house_start: '2026-11-01T18:00:00Z', open_house_end: '2026-11-01T20:00:00Z', open_house_notes: 'Gate 123', custom_domains: [{ domain: 'example.com', status: 'registration_pending' }], video_url: 'https://vimeo.com/123', invoice_items: [{ amount: 80000 }], public_site_aliases: ['oldpath'] };
function fixture(routeName, { admin = true, owner = true, conflict = false, concurrent = false } = {}) {
  let row = { id: 'site-1', site_slug: '123example', client_id: 'owner', property_address: '123 Example', site_data: structuredClone(saved) };
  let writes = 0, payload;
  const db = { from() {
    let update, otherSites = false, expected;
    const query = {
      select() { return query; }, eq() { return query; }, limit() { return query; }, neq() { otherSites = true; return query; },
      update(value) { update = value; return query; },
      filter(key, op, value) { assert.equal(key, 'site_data'); assert.equal(op, 'eq'); expected = value; return query; },
      is(key, value) { assert.equal(key, 'site_data'); expected = value; return query; },
      single() { return query.maybeSingle(); },
      async maybeSingle() {
        if (!update) return { data: structuredClone(row), error: null };
        assert.equal(expected, JSON.stringify(row.site_data));
        if (concurrent) return { data: null, error: null };
        payload = structuredClone(update); row = { ...row, ...payload }; writes++;
        return { data: row, error: null };
      },
      then(resolve, reject) { return Promise.resolve({ data: otherSites && conflict ? [{ id: 'other', site_slug: 'newpath' }] : [], error: null }).then(resolve, reject); },
    }; return query;
  } };
  class AuthorizationError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const route = load(`app/api/sites/[id]/${routeName}/route.ts`, {
    '@/lib/authz': { requireUser: async () => ({ user: { id: 'owner' }, profile: { is_admin: admin }, admin: db }), AuthorizationError, authorizationErrorResponse: error => error instanceof AuthorizationError ? new Response('{}', { status: error.status }) : null },
    '@/lib/portal-access': { portalUserOwnsSite: () => owner },
    '@/lib/property-listing': listing,
    '@/lib/property-site-slug': { normalizePropertySiteSlug: value => String(value || '').toLowerCase(), makePropertySiteSlug: () => '123example' },
  });
  return { get row() { return row; }, get writes() { return writes; }, get payload() { return payload; }, save: body => route.PATCH({ json: async () => body }, { params: Promise.resolve({ id: 'site-1' }) }) };
}
test('address-only save preserves open house, listing, domain purchase, invoice and media data', async () => {
  const f = fixture('site-summary');
  assert.equal((await f.save({ site_slug: 'newpath', public_site_aliases: ['123example', 'oldpath'] })).status, 200);
  for (const key of Object.keys(saved).filter(key => key !== 'public_site_aliases')) assert.deepEqual(f.row.site_data[key], saved[key]);
  assert.equal(f.row.site_slug, 'newpath');
});
test('property save updates listing and open house atomically and preserves website/payment data', async () => {
  const f = fixture('property-details', { admin: false });
  assert.equal((await f.save({ beds: '4', listing_status: 'sold', open_house_enabled: false, open_house_notes: 'Updated' })).status, 200);
  assert.equal(f.writes, 1); assert.equal(f.payload.beds, 4);
  assert.equal(f.row.site_data.listing_status, 'sold'); assert.equal(f.row.site_data.open_house_enabled, false);
  for (const key of ['custom_domains', 'public_site_aliases', 'invoice_items', 'video_url', 'open_house_start']) assert.deepEqual(f.row.site_data[key], saved[key]);
});
for (const route of ['property-details', 'site-summary']) {
  for (const invalid of [{ listing_status: 'invalid' }, { open_house_start: 'invalid' }, { open_house_start: null }, { open_house_end: '2026-11-01T17:00:00Z' }]) {
    test(`${route} rejects invalid listing schedule without writing: ${JSON.stringify(invalid)}`, async () => {
      const f = fixture(route); assert.equal((await f.save(invalid)).status, 400); assert.equal(f.writes, 0);
    });
  }
  test(`${route} rejects unauthorized access`, async () => { const f = fixture(route, { admin: false, owner: false }); assert.equal((await f.save({ listing_status: 'sold' })).status, 403); assert.equal(f.writes, 0); });
  test(`${route} rejects concurrent updates instead of overwriting registration`, async () => { const f = fixture(route, { concurrent: true }); assert.equal((await f.save({ listing_status: 'sold' })).status, 409); assert.equal(f.writes, 0); });
}
test('owners cannot change included addresses and conflicting paths cannot be saved', async () => {
  const owner = fixture('site-summary', { admin: false }); assert.equal((await owner.save({ site_slug: 'newpath' })).status, 403);
  const conflict = fixture('site-summary', { conflict: true }); assert.equal((await conflict.save({ site_slug: 'newpath' })).status, 409);
  assert.equal(owner.writes + conflict.writes, 0);
});
test('website essentials starts with read-only sharing and collapsed advanced controls, without listing controls', () => {
  const Component = load('app/dashboard/site/[slug]/SiteSummaryPanel.tsx', { 'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@/src/lib/authenticated-fetch': {}, './CustomDomainStore': () => null }).default;
  const html = renderToStaticMarkup(React.createElement(Component, { siteId: 'site-1', initialPublicSlug: '123example', publicSiteUrl: 'https://sites.gsvisions.co/123example', canManageAddresses: true }));
  assert.match(html, /id="website"/); assert.match(html, /href="https:\/\/sites.gsvisions.co\/123example"/); assert.match(html, /Advanced website settings/);
  assert.doesNotMatch(html, /<details[^>]*open|Listing status|Open house|Save all website/);
});
test('read-only co-lister sees listing details with no save button or enabled promotion controls', () => {
  const Component = load('app/dashboard/site/[slug]/PropertyDetailsEditor.tsx', { 'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@/src/lib/authenticated-fetch': {} }).default;
  const html = renderToStaticMarkup(React.createElement(Component, { siteId: 'site-1', canEdit: false, initial: { ...saved } }));
  assert.match(html, /Listing &amp; open house/); assert.doesNotMatch(html, /Save Property Details<\/button>/); assert.match(html, /aria-label="Listing status"[^>]*disabled/);
});
