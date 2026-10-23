import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const nativeRequire = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(file, mocks = {}, globals = {}) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module: compiled, exports: compiled.exports, require: name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (['react', 'react/jsx-runtime', 'next/server'].includes(name)) return nativeRequire(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, URL, AbortSignal, process: { env: { VERCEL_API_TOKEN: 'fixture', VERCEL_TEAM_ID: 'fixture-team' } }, ...globals });
  return compiled.exports;
}

function registrar(respond) {
  const calls = [];
  const api = load('lib/custom-domains.ts', {}, { fetch: async (url, init) => {
    calls.push({ url, init });
    const reply = await respond(url, init);
    return { ok: !reply.errorStatus, status: reply.errorStatus || 200, json: async () => reply };
  } });
  return { api, calls };
}

function database(initial = {}) {
  let data = { ...initial };
  const writes = [];
  return { writes, get data() { return data; }, change(patch) { data = { ...data, ...patch }; }, from(table) {
    assert.equal(table, 'sites');
    let update, expected;
    const query = {
      select() { return query; }, eq() { return query; },
      update(value) { update = value; return query; },
      filter(key, op, value) { assert.equal(key, 'site_data'); assert.equal(op, 'eq'); expected = JSON.parse(value); return query; },
      is(key, value) { assert.equal(key, 'site_data'); expected = value; return query; },
      async maybeSingle() {
        if (!update) return { data: { id: 'site-1', site_data: structuredClone(data) }, error: null };
        if (JSON.stringify(expected) !== JSON.stringify(data)) return { data: null, error: null };
        data = structuredClone(update.site_data); writes.push(data);
        return { data: { id: 'site-1' }, error: null };
      },
    };
    return query;
  } };
}

function fulfillment(options = {}) {
  const calls = { buy: 0, attach: 0, refund: 0, quote: 0, order: 0 };
  class RegistrarRequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const api = load('lib/domain-purchase.ts', { '@/lib/custom-domains': {
    normalizeDomain: value => String(value || '').trim().toLowerCase(), validDomain: value => /^[a-z0-9-]+\.com$/.test(value), RegistrarRequestError,
    getDomainQuote: async () => { calls.quote++; return { available: true, wholesalePriceCents: 1125, ...options.quote }; },
    buyDomain: async () => { calls.buy++; if (options.buyError) throw options.buyError(RegistrarRequestError); return { orderId: 'order-1' }; },
    getDomainOrder: async () => { calls.order++; options.onOrder?.(); return { status: options.orderStatus || 'completed', error: 'Registrar rejected registration' }; },
    addDomainToProject: async () => { calls.attach++; if (options.attachError) throw Error('Attach failed'); return { verified: options.verified ?? true }; },
  } });
  const db = database(options.initial);
  const args = { db, siteId: 'site-1', domain: 'examplehome.com', chargedCents: 3625, maxWholesaleCents: 1125, paymentReference: 'pi_fixture', provider: 'stripe', live: true, contact: api.GSV_DOMAIN_REGISTRANT, refund: async () => { calls.refund++; } };
  return { ...api, calls, db, args };
}

test('suggested property domain is a real input value and its search button is enabled', () => {
  const Store = load('app/dashboard/site/[slug]/CustomDomainStore.tsx', { '@/src/lib/authenticated-fetch': { authenticatedFetch() { throw Error('No network during rendering'); } } }).default;
  const html = renderToStaticMarkup(React.createElement(Store, { siteId: 'site-1', suggestedDomain: '123example.com' }));
  assert.match(html, /value="123example.com"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('one-year registration uses the documented registrar contract', async () => {
  const { api, calls } = registrar(() => ({ orderId: 'order-1' }));
  const contact = { firstName: 'Golden State', lastName: 'Visions', email: 'test@example.invalid', phone: '+15555550100', address1: '123 Example', city: 'Lincoln', state: 'CA', postalCode: '95648', country: 'US' };
  await api.buyDomain({ domain: 'examplehome.com', wholesalePriceCents: 1125, contact });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.autoRenew, false); assert.equal(body.years, 1); assert.equal(body.expectedPrice, 11.25);
  assert.equal(body.contactInformation.zip, '95648'); assert.equal(body.contactInformation.email, contact.email);
  assert.equal(body.renew, undefined); assert.equal(body.firstName, undefined);
  assert.match(calls[0].url, /\/v1\/registrar\/domains\/examplehome.com\/buy\?teamId=fixture-team$/);
});

test('domain pricing preserves the registrar price and configured markup', async () => {
  const { api } = registrar(url => url.includes('availability') ? { available: true } : { purchasePrice: '11.25', renewalPrice: 12 });
  const quote = await api.getDomainQuote('examplehome.com');
  assert.equal(quote.wholesalePriceCents, 1125); assert.equal(quote.retailPriceCents, 3625);
});
for (const purchasePrice of [null, '', 'invalid', -1, 0]) {
  test(`invalid wholesale price cannot start checkout: ${JSON.stringify(purchasePrice)}`, async () => {
    const { api } = registrar(url => url.includes('availability') ? { available: true } : { purchasePrice });
    await assert.rejects(api.getDomainQuote('examplehome.com'), /price/);
  });
}

test('successful registrar order is verified before attaching and retries are idempotent', async () => {
  const f = fulfillment();
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'active');
  assert.equal(f.db.data.custom_domain, 'examplehome.com');
  assert.equal(f.db.data.custom_domains[0].registrar_order_id, 'order-1');
  await f.completeDomainPurchase(f.args);
  assert.equal(f.calls.buy, 1); assert.equal(f.calls.attach, 1); assert.equal(f.calls.refund, 0);
});

test('pending orders are retained without attachment, refund, or repeat purchase', async () => {
  const f = fulfillment({ orderStatus: 'pending' });
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'registration_pending');
  await f.completeDomainPurchase(f.args);
  assert.equal(f.calls.buy, 1); assert.equal(f.calls.attach, 0); assert.equal(f.calls.refund, 0);
  assert.equal(f.db.data.custom_domain, undefined);
});

test('a pending order resumes to completion without another registrar purchase', async () => {
  const f = fulfillment({ initial: { custom_domains: [{ domain: 'examplehome.com', status: 'registration_pending', registrar_order_id: 'order-1', payment_reference: 'pi_fixture', payment_provider: 'stripe', amount_paid_cents: 3625 }] } });
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'active');
  assert.equal(f.calls.buy, 0); assert.equal(f.calls.quote, 0); assert.equal(f.calls.attach, 1);
});

test('parallel callbacks cannot submit two registrar purchases', async () => {
  const f = fulfillment();
  await Promise.allSettled([f.completeDomainPurchase(f.args), f.completeDomainPurchase(f.args)]);
  assert.equal(f.calls.buy, 1);
});

test('definite registrar rejection refunds once and never retries registration', async () => {
  const f = fulfillment({ buyError: ErrorType => new ErrorType('Invalid registration contact', 400) });
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'registration_failed_refunded');
  await f.completeDomainPurchase(f.args);
  assert.equal(f.calls.buy, 1); assert.equal(f.calls.refund, 1); assert.equal(f.calls.attach, 0);
});

test('uncertain registrar timeout is held for review rather than refunded or purchased twice', async () => {
  const f = fulfillment({ buyError: () => Error('Connection lost') });
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'registration_review_required');
  await f.completeDomainPurchase(f.args);
  assert.equal(f.calls.buy, 1); assert.equal(f.calls.refund, 0);
  assert.equal(f.domainPurchaseBlocked(f.db.data, 'examplehome.com'), true);
});

test('failed asynchronous registrar order refunds instead of connecting the name', async () => {
  const f = fulfillment({ orderStatus: 'failed' });
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'registration_failed_refunded');
  assert.equal(f.calls.refund, 1); assert.equal(f.calls.attach, 0);
});

test('a changed wholesale price refunds before sending any registration request', async () => {
  const f = fulfillment({ quote: { wholesalePriceCents: 1300 } });
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'registration_failed_refunded');
  assert.equal(f.calls.buy, 0); assert.equal(f.calls.refund, 1);
});

test('sandbox payments never buy, connect, or refund a real domain', async () => {
  const f = fulfillment();
  assert.equal((await f.completeDomainPurchase({ ...f.args, live: false })).status, 'test_checkout_complete');
  assert.equal(f.calls.buy + f.calls.quote + f.calls.attach + f.calls.refund, 0);
  assert.equal(f.db.data.custom_domain, undefined);
});

test('registration preserves website settings changed while the registrar works', async () => {
  let f;
  f = fulfillment({ initial: { public_site_description: 'Original' }, onOrder: () => f.db.change({ public_site_description: 'Updated by owner' }) });
  await f.completeDomainPurchase(f.args);
  assert.equal(f.db.data.public_site_description, 'Updated by owner');
});

test('attachment failure keeps the purchased order for setup instead of refunding or re-buying', async () => {
  const f = fulfillment({ attachError: true });
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'configuration_required');
  await f.completeDomainPurchase(f.args);
  assert.equal(f.calls.buy, 1); assert.equal(f.calls.refund, 0);
});

test('a second payment for an already registered domain is refunded without replacing its owner record', async () => {
  const f = fulfillment({ initial: { custom_domains: [{ domain: 'examplehome.com', status: 'active', payment_reference: 'pi_original' }] } });
  assert.equal((await f.completeDomainPurchase(f.args)).status, 'duplicate_payment_refunded');
  assert.equal(f.calls.buy, 0); assert.equal(f.calls.refund, 1);
  assert.equal(f.db.data.custom_domains[0].payment_reference, 'pi_original');
});

function authorization(admin, allowed = true) {
  class AuthorizationError extends Error { constructor(message, status) { super(message); this.status = status; } }
  return { '@/lib/authz': {
    AuthorizationError,
    requireUser: async () => ({ user: { id: 'user-1', email: 'test@example.invalid' }, profile: { is_admin: false }, admin }),
    authorizationErrorResponse: error => error instanceof AuthorizationError ? Response.json({ error: error.message }, { status: error.status }) : null,
  }, '@/lib/portal-access': { portalUserOwnsSite: () => allowed } };
}

test('unauthorized users cannot create a domain payment', async () => {
  const db = database(); let payments = 0;
  const route = load('app/api/sites/[id]/custom-domain/checkout/route.ts', {
    ...authorization(db, false), '@/lib/custom-domains': { getDomainQuote() { throw Error('Must not quote'); } },
    '@/lib/domain-purchase': { domainPurchaseBlocked: () => false },
    stripe: class { constructor() { payments++; } },
  });
  const response = await route.POST({ json: async () => ({ domain: 'examplehome.com' }) }, { params: Promise.resolve({ id: 'site-1' }) });
  assert.equal(response.status, 403); assert.equal(payments, 0);
});

test('an existing registration is rejected before a new payment is created', async () => {
  const db = database(); let payments = 0;
  const route = load('app/api/sites/[id]/custom-domain/checkout/route.ts', {
    ...authorization(db), '@/lib/custom-domains': { getDomainQuote() { throw Error('Must not quote'); } },
    '@/lib/domain-purchase': { domainPurchaseBlocked: () => true },
    stripe: class { constructor() { payments++; } },
  });
  const response = await route.POST({ json: async () => ({ domain: 'examplehome.com' }) }, { params: Promise.resolve({ id: 'site-1' }) });
  assert.equal(response.status, 409); assert.equal(payments, 0);
});

test('registrar order verification matches the purchased domain and respects pending status', async () => {
  const { api } = registrar(() => ({ status: 'completed', domains: [{ domainName: 'examplehome.com', purchaseType: 'purchase', status: 'pending' }] }));
  assert.equal((await api.getDomainOrder('order-1', 'examplehome.com')).status, 'pending');
  await assert.rejects(api.getDomainOrder('order-1', 'different.com'), /did not include/);
});

test('replayed completed PayPal capture uses the verified capture without charging again', async () => {
  const db = database(); const calls = []; let completed;
  const route = load('app/api/sites/[id]/custom-domain/paypal/capture/route.ts', {
    ...authorization(db),
    '@/lib/custom-domains': { normalizeDomain: value => value, getDomainQuote() { throw Error('Do not recheck availability after purchase'); } },
    '@/lib/paypal': { paypalConfigured: () => true, paypalRequest: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ status: 'COMPLETED', purchase_units: [{ reference_id: 'site-1', custom_id: 'examplehome.com', amount: { currency_code: 'USD', value: '36.25' }, payments: { captures: [{ id: 'CAPTURE123', status: 'COMPLETED', amount: { currency_code: 'USD', value: '36.25' } }] } }] }) };
    } },
    '@/lib/domain-purchase': { GSV_DOMAIN_REGISTRANT: {}, completeDomainPurchase: async args => { completed = args; return { status: 'active' }; } },
  }, { process: { env: { PAYPAL_ENVIRONMENT: 'live' } } });
  const response = await route.POST({ json: async () => ({ domain: 'examplehome.com', paypalOrderId: 'ORDER123' }) }, { params: Promise.resolve({ id: 'site-1' }) });
  assert.equal(response.status, 200); assert.equal(calls.length, 1); assert.equal(calls[0].init, undefined);
  assert.equal(completed.paymentReference, 'paypal:CAPTURE123'); assert.equal(completed.chargedCents, 3625);
});

test('registration status endpoint rejects users who do not own the property', async () => {
  const route = load('app/api/sites/[id]/custom-domain/status/route.ts', {
    ...authorization(database(), false), stripe: class {}, '@/lib/paypal': { paypalRequest() { throw Error('No financial request allowed'); } },
    '@/lib/domain-purchase': { completeDomainPurchase() { throw Error('No registration allowed'); } },
  });
  const response = await route.POST({}, { params: Promise.resolve({ id: 'site-1' }) });
  assert.equal(response.status, 403);
});

test('normal invoice webhooks still apply the invoice payment and receipt without invoking domain registration', async () => {
  const calls = { invoice: 0, receipt: 0, domain: 0 };
  const event = { id: 'evt_fixture', type: 'payment_intent.succeeded', data: { object: { id: 'pi_invoice', amount: 30000, amount_received: 30000, currency: 'usd', created: 1700000000, metadata: { source: 'invoice_public', site_id: 'site-1', invoice_payment_amount_cents: '30000' } } } };
  const query = { select() { return query; }, eq() { return query; }, update() { return query; }, async maybeSingle() { return { data: null }; }, async upsert() { return { error: null }; }, then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); } };
  const route = load('app/api/stripe/webhook/route.ts', {
    '@supabase/supabase-js': { createClient: () => ({ from: () => query, rpc: async (name, args) => { assert.equal(name, 'apply_invoice_payment'); assert.equal(args.p_amount_cents, 30000); calls.invoice++; return { error: null }; } }) },
    stripe: class { webhooks = { constructEvent: () => event }; },
    '@/lib/domain-purchase': { completeDomainPurchase: async () => { calls.domain++; } },
    '@/lib/payment-received-email': { sendPaymentReceivedEmail: async () => { calls.receipt++; } },
  }, { process: { env: { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'fixture', NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } } });
  const response = await route.POST({ headers: new Headers({ 'stripe-signature': 'fixture' }), text: async () => 'fixture' });
  assert.equal(response.status, 200); assert.equal(calls.invoice, 1); assert.equal(calls.receipt, 1); assert.equal(calls.domain, 0);
});


test('status recovery cannot submit a new purchase if its saved registration was removed', async () => {
  const f = fulfillment();
  await assert.rejects(f.completeDomainPurchase({ ...f.args, resumeOnly: true }), /saved registration changed/);
  assert.equal(f.calls.buy, 0); assert.equal(f.calls.refund, 0);
});
