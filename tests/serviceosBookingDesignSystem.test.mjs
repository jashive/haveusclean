import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const widget = fs.readFileSync(new URL('../src/components/BookingWidget.jsx', import.meta.url), 'utf8');
const primitives = fs.readFileSync(new URL('../src/components/ui.jsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/book.jsx', import.meta.url), 'utf8');
const bookingApi = fs.readFileSync(new URL('../api/bookings/create.js', import.meta.url), 'utf8');
const notificationDelivery = fs.readFileSync(new URL('../server-internal/intake-notification-delivery.js', import.meta.url), 'utf8');
const notificationMigration = fs.readFileSync(new URL('../supabase/migrations/20260906181342_residential_revenue_notifications.sql', import.meta.url), 'utf8');

test('Foundation publishes approved brand, semantic, radius, and numeral tokens', () => {
  for (const token of ['--brand-900:#123d35', '--brand-800:#185247', '--brand-700:#216b5d', '--brand-600:#2b8271', '--brand-500:#3d9a87', '--brand-400:#66b5a4', '--brand-300:#91cdbc', '--brand-200:#bce3d8', '--brand-100:#ddf3ed', '--brand-50:#f1faf7', '--ink-950:#14201d']) assert.match(css, new RegExp(token));
  assert.match(css, /--success-fg:#177245/);
  assert.match(css, /--warning-fg:#9a5b08/);
  assert.match(css, /--danger-fg:#b33131/);
  assert.match(css, /--radius-control:10px/);
  assert.match(css, /font-variant-numeric:tabular-nums/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('Foundation exposes the five approved shared primitives', () => {
  for (const name of ['Button', 'FormField', 'SelectionTile', 'StatusBadge', 'StickySummaryCard']) assert.match(primitives, new RegExp(`export (?:const|function) ${name}`));
  assert.match(primitives, /aria-pressed/);
  assert.match(primitives, /aria-label="Booking summary"/);
});

test('Residential booking is a six-step governed wizard without public diagnostic ids', () => {
  for (const step of ['Location', 'Home Specs', 'Frequency & Tier', 'Add-ons', 'Schedule & Contact', 'Confirmation']) assert.match(widget, new RegExp(step.replace(/[&]/g, '\\&')));
  assert.match(widget, /\/api\/bookings\/quote/);
  assert.match(widget, /governedQuote: quote/);
  assert.match(widget, /13% HST/);
  assert.match(widget, /currency: 'USD'/);
  assert.match(widget, /StickySummaryCard/);
  assert.match(primitives, /sticky-summary-card/);
  assert.doesNotMatch(page, /serviceRequestId|bookingId|job\?\.id/);
});

test('Commercial intake retains its configurable frequency selector during Phase A1', () => {
  assert.match(widget, /Preferred cleaning frequency/);
  for (const value of ['one_time', 'weekly', 'biweekly', 'three_times_weekly', 'five_times_weekly', 'monthly', 'custom']) {
    assert.match(widget, new RegExp(`\\['${value}'`));
  }
});

test('Production booking APIs support modern Supabase secrets and preserve JSON errors', () => {
  assert.match(bookingApi, /supabase-secret-key-fetch-compat\.js/);
  assert.match(bookingApi, /return await handleCommercialWalkthrough/);
  assert.match(widget, /async function readApiJson/);
  assert.match(widget, /response\.text\(\)/);
});

test('Residential submissions create one idempotent Revenue opportunity', () => {
  assert.match(widget, /makeIdempotencyKey\('residential-booking'\)/);
  assert.match(bookingApi, /submission_idempotency_key: idempotencyKey/);
  assert.match(bookingApi, /opportunityId: result\?\.opportunity_id/);
  assert.match(notificationMigration, /insert into public\.opportunity[\s\S]*?'open'/i);
  assert.match(notificationMigration, /'queue','revenue_follow_up'/);
  assert.match(notificationMigration, /scope='public_booking_intake' and key=v_key/);
});

test('Residential and commercial receipts use private durable Microsoft 365 delivery', () => {
  assert.match(bookingApi, /kind: 'residential'/);
  assert.match(bookingApi, /kind: 'commercial'/);
  assert.match(notificationDelivery, /M365_OPERATIONS_EMAIL \|\| senderEmail/);
  assert.match(notificationDelivery, /audience: 'customer'/);
  assert.match(notificationDelivery, /audience: 'operations'/);
  assert.match(notificationDelivery, /requested appointment and governed estimate/i);
  assert.match(notificationDelivery, /does not create an instant price or confirmed appointment/i);
  assert.match(notificationMigration, /force row level security/i);
  assert.match(notificationMigration, /revoke all on table public\.intake_notification_delivery from public,anon,authenticated/i);
  assert.match(notificationMigration, /grant select,insert,update on table public\.intake_notification_delivery to service_role/i);
});
