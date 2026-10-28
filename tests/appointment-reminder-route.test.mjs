import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const booking = { id, client_id: 'client', client_email: 'client@example.invalid', scheduled_start: '2026-10-29T18:00:00Z', scheduled_end: '2026-10-29T19:00:00Z', status: 'scheduled' };
const site = { id: 'site', booking_id: id, client_id: 'client', property_full_address: '123 Test Street', status: 'scheduled', site_data: {} };
function fixture(options = {}) {
  const sent = [], writes = [], claims = new Set(), filters = [];
  let claimCount = 0;
  const db = { from(table) {
    const conditions = []; let update;
    const result = () => {
      if (table === 'notification_holds' && options.holdError) return { data: null, error: Error('Hold lookup unavailable') };
      const rows = table === 'bookings' ? options.bookings || [booking] : table === 'sites' ? options.sites || [site] : table === 'notification_holds' ? options.holds || [] : table === 'profiles' ? [{ id: 'client', email: 'client@example.invalid' }] : [];
      return { data: rows.filter(row => conditions.every(([key, values]) => values.includes(row[key]))), error: null };
    };
    const query = {
      select() { return query; }, order() { return query; }, gte() { return query; }, lt() { return query; },
      eq(key, value) { conditions.push([key, [value]]); return query; },
      in(key, values) { conditions.push([key, values]); filters.push({ table, key, values }); return query; },
      update(payload) { update = payload; return query; },
      async maybeSingle() { const r = result(); return { ...r, data: r.data?.[0] || null }; },
      then(resolve, reject) { if (update) writes.push({ table, update }); return Promise.resolve(result()).then(resolve, reject); },
    }; return query;
  }, async rpc(name, args) {
    assert.equal(name, 'claim_outbound_message'); claimCount++;
    if (claims.has(args.p_idempotency_key)) return { data: null, error: null };
    claims.add(args.p_idempotency_key); return { data: 'message-1', error: null };
  } };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(new URL('../app/api/cron/appointment-reminders/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-28T23:00:00Z'])); } }
  vm.runInNewContext(code, { module, exports: module.exports, URL, Date: FixedDate, console: { error() {} }, process: { env: { CRON_SECRET: 'fixture-secret', NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } }, require(name) {
    if (name === 'next/server') return require(name);
    if (name === '@supabase/supabase-js') return { createClient: () => db };
    if (name === '@/lib/appointment-reminder-schedule') return { nextBusinessDateKey: () => '2026-10-29', appointmentFallsOnBusinessDate: date => date.startsWith('2026-10-29') };
    if (name === '@/lib/portal-access') return { assistantCcEmails: async () => [] };
    if (name === '@/lib/appointment-reminder-email') return { sendAppointmentReminderEmail: async args => { sent.push(args); if (options.sendError) throw Error('Provider failure'); return { emailId: 'provider-1' }; } };
    throw Error(`Unexpected dependency: ${name}`);
  } });
  return { sent, writes, filters, get claimCount() { return claimCount; }, async run(query = '', authorized = true) {
    const response = await module.exports.GET(new Request(`https://example.invalid/api/cron/appointment-reminders${query}`, { headers: authorized ? { authorization: 'Bearer fixture-secret' } : {} }));
    return { status: response.status, body: await response.json() };
  } };
}
for (const topic of ['order_confirmation', 'appointment_confirmation', 'invoice', 'payment_receipt', 'media_delivery', 'property_site_live']) {
  test(`${topic} hold does not suppress tomorrow's reminder`, async () => {
    const f = fixture({ holds: [{ booking_id: id, site_id: 'site', active: true, topic }] });
    const r = await f.run(); assert.equal(r.body.sent, 1); assert.equal(f.sent.length, 1);
    assert.equal(f.writes[0].update.status, 'sent'); assert.equal(f.sent[0].idempotencyKey, `appointment-reminder:${id}:2026-10-29`);
  });
}
for (const scope of [{ booking_id: id }, { site_id: 'site' }]) {
  test(`active appointment-change hold still suppresses reminders: ${JSON.stringify(scope)}`, async () => {
    const f = fixture({ holds: [{ ...scope, topic: 'appointment_change', active: true }] });
    assert.equal((await f.run()).body.skipped, 1); assert.equal(f.sent.length, 0); assert.equal(f.claimCount, 0);
  });
}
test('released appointment-change hold permits the reminder', async () => {
  const f = fixture({ holds: [{ booking_id: id, topic: 'appointment_change', active: false }] }); assert.equal((await f.run()).body.sent, 1);
});
for (const options of [{ bookings: [{ ...booking, status: 'cancelled' }] }, { sites: [{ ...site, status: 'canceled' }] }, { sites: [{ ...site, site_data: { booking_cancelled_at: '2026-10-28T20:00:00Z' } }] }]) {
  test(`cancelled bookings/sites remain excluded: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await f.run(); assert.equal(f.sent.length, 0); assert.equal(f.claimCount, 0);
  });
}
test('dry-run and authorization checks never claim or send a message', async () => {
  const f = fixture(); assert.equal((await f.run('?dry_run=1')).body.eligible, 1); assert.equal((await f.run('', false)).status, 401);
  assert.equal(f.sent.length, 0); assert.equal(f.claimCount, 0); assert.equal(f.writes.length, 0);
});
test('targeted recovery processes only the requested booking; repeated execution is deduplicated', async () => {
  const f = fixture({ bookings: [booking, { ...booking, id: otherId }], sites: [site, { ...site, id: 'other-site', booking_id: otherId }] });
  const first = await f.run(`?booking_id=${id}`); assert.equal(first.body.candidates, 1); assert.equal(first.body.sent, 1);
  const second = await f.run(`?booking_id=${id}`); assert.equal(second.body.already_sent, 1); assert.equal(f.sent.length, 1);
});
test('invalid recovery target is rejected without writes or sending', async () => {
  const f = fixture(); assert.equal((await f.run('?booking_id=invalid')).status, 400); assert.equal(f.sent.length, 0); assert.equal(f.writes.length, 0);
});
test('hold lookup failure fails closed', async () => {
  const f = fixture({ holdError: true }); await assert.rejects(f.run(), /Hold lookup unavailable/); assert.equal(f.sent.length, 0);
});
test('provider failure is recorded as failed rather than sent', async () => {
  const f = fixture({ sendError: true }); const r = await f.run(); assert.equal(r.status, 500); assert.equal(r.body.sent, 0); assert.equal(f.writes[0].update.status, 'failed');
});
