import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260906181342_residential_revenue_notifications.sql', 'utf8');
const api = fs.readFileSync('api/bookings/create.js', 'utf8');
const widget = fs.readFileSync('src/components/BookingWidget.jsx', 'utf8');
const page = fs.readFileSync('src/pages/book.jsx', 'utf8');
const delivery = fs.readFileSync('server-internal/intake-notification-delivery.js', 'utf8');

test('residential intake atomically creates exactly one open Revenue opportunity', () => {
  assert.match(migration, /insert into public\.opportunity[\s\S]*?'open'/i);
  assert.match(migration, /'queue','revenue_follow_up'/);
  assert.match(migration, /'opportunity_id',v_opportunity_id/);
  assert.match(migration, /scope='public_booking_intake' and key=v_key/);
  assert.match(migration, /request_hash=v_request_hash/);
  assert.match(api, /submission_idempotency_key: idempotencyKey/);
  assert.match(api, /opportunityId: result\?\.opportunity_id/);
  assert.match(widget, /makeIdempotencyKey\('residential-booking'\)/);
});

test('notification evidence is private, idempotent, and service-role-only', () => {
  assert.match(migration, /create table if not exists public\.intake_notification_delivery/i);
  assert.match(migration, /unique\(service_request_id,audience,template_key,template_version\)/i);
  assert.match(migration, /idempotency_key text not null unique/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke all on table public\.intake_notification_delivery from public,anon,authenticated/i);
  assert.match(migration, /grant select,insert,update on table public\.intake_notification_delivery to service_role/i);
  assert.match(migration, /delivery_status in \('sent','requested'\)[\s\S]*?'should_send',false/i);
});

test('booking handler dispatches customer and operations notifications without adding an API function', () => {
  assert.match(api, /dispatchIntakeNotifications/);
  assert.match(api, /kind: 'residential'/);
  assert.match(api, /kind: 'commercial'/);
  assert.match(delivery, /M365_OPERATIONS_EMAIL \|\| senderEmail/);
  assert.match(delivery, /audience: 'customer'/);
  assert.match(delivery, /audience: 'operations'/);
  assert.match(delivery, /Revenue → Recent Saved Leads/);
  assert.match(page, /email confirmation may be delayed/);
});

test('notification templates distinguish requested slots from confirmed appointments', () => {
  assert.match(delivery, /requested appointment and governed estimate/i);
  assert.match(delivery, /confirm availability before the visit is scheduled/i);
  assert.match(delivery, /does not create an instant price or confirmed appointment/i);
  assert.doesNotMatch(delivery, /Your appointment is confirmed/i);
});

test('Microsoft 365 dispatch sends customer and operations messages and defaults operations to sender', async () => {
  const priorFetch = globalThis.fetch;
  const priorEnv = Object.fromEntries(['M365_TENANT_ID','M365_CLIENT_ID','M365_CLIENT_SECRET','M365_SENDER_EMAIL','M365_OPERATIONS_EMAIL'].map((key) => [key, process.env[key]]));
  process.env.M365_TENANT_ID = 'tenant';
  process.env.M365_CLIENT_ID = 'client';
  process.env.M365_CLIENT_SECRET = 'secret';
  process.env.M365_SENDER_EMAIL = 'operations@haveusclean.example';
  delete process.env.M365_OPERATIONS_EMAIL;
  const drafts = [];
  let draftNumber = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'graph-token' }), { status: 200 });
    if (String(url).endsWith('/messages')) {
      drafts.push(JSON.parse(options.body));
      draftNumber += 1;
      return new Response(JSON.stringify({ id: `draft-${draftNumber}` }), { status: 201 });
    }
    if (String(url).endsWith('/send')) return new Response(null, { status: 202 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const completed = [];
  let reservationNumber = 0;
  const callRpc = async (name, payload) => {
    if (name === 'reserve_intake_notification_delivery') {
      reservationNumber += 1;
      return { delivery_id: `00000000-0000-0000-0000-00000000000${reservationNumber}`, delivery_status: 'requested', should_send: true };
    }
    if (name === 'complete_intake_notification_delivery') { completed.push(payload); return { delivery_status: payload.p_delivery_status }; }
    throw new Error(`Unexpected RPC: ${name}`);
  };
  try {
    const { dispatchIntakeNotifications } = await import('../server-internal/intake-notification-delivery.js');
    const result = await dispatchIntakeNotifications({
      intake: {
        kind: 'residential', submissionKey: 'booking-key', serviceRequestId: '00000000-0000-0000-0000-000000000099',
        market: 'HUC-AZ', contactName: 'Test Customer', customerEmail: 'customer@example.com', phone: '+16025550100',
        address: '123 Test Ave, Phoenix, 85001', requestedDate: '2026-09-08', arrivalWindow: 'Morning',
        serviceLabel: 'Essential Refresh', frequencyLabel: 'One Time', currencyCode: 'USD', taxName: 'Service Tax',
        subtotal: 250, taxAmount: 0, total: 250, notes: '',
      },
      callRpc,
    });
    assert.deepEqual(result, { customer: 'sent', operations: 'sent' });
    assert.equal(drafts.length, 2);
    assert.deepEqual(drafts.map((item) => item.toRecipients[0].emailAddress.address).sort(), ['customer@example.com','operations@haveusclean.example']);
    assert.equal(completed.filter((item) => item.p_delivery_status === 'sent').length, 2);
  } finally {
    globalThis.fetch = priorFetch;
    for (const [key, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
