import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const bookingPage = fs.readFileSync(new URL('../src/pages/book.jsx', import.meta.url), 'utf8');
const bookingWidget = fs.readFileSync(new URL('../src/components/BookingWidget.jsx', import.meta.url), 'utf8');
const bookingCreate = fs.readFileSync(new URL('../api/bookings/create.js', import.meta.url), 'utf8');
const bookingQuote = fs.readFileSync(new URL('../api/bookings/quote.js', import.meta.url), 'utf8');
const bookingMigration = fs.readFileSync(new URL('../supabase/migrations/20260903194500_public_booking_intake_boundary.sql', import.meta.url), 'utf8');
const finance = fs.readFileSync(new URL('../src/features/wave5/ServiceOSFinanceWorkspace.jsx', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../src/features/wave1/ServiceOSWave1Workspace.jsx', import.meta.url), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('public booking routes bypass the ServiceOS auth gate in the Vite root router', () => {
  assert.equal(packageJson.dependencies?.next, undefined, 'repository must not pretend to use Next.js middleware');
  assert.match(main, /isPublicBookingRequest/);
  assert.match(main, /path === "\/book" \|\| path\.startsWith\("\/book\/"\)/);
  assert.match(main, /if \(isPublicBookingRequest\(\)\)[\s\S]*?<BookPage \/>/);
  assert.match(main, /return <ServiceOSAuthGate><ServiceOSRoot \/><\/ServiceOSAuthGate>/);
  assert.ok(main.indexOf('if (isPublicBookingRequest())') < main.indexOf('return <ServiceOSAuthGate><ServiceOSRoot /></ServiceOSAuthGate>'));
  assert.match(bookingPage, /No account required/);
});

test('public booking price and submission paths are server-governed rather than trusting legacy browser pricing', () => {
  assert.match(bookingWidget, /\/api\/bookings\/quote/);
  assert.match(bookingWidget, /HUC-ON/);
  assert.match(bookingWidget, /HUC-AZ/);
  assert.match(bookingWidget, /configurationVersion/);
  assert.doesNotMatch(bookingWidget, /basePrice:\s*99/);
  assert.match(bookingCreate, /calculatePublicBookingQuote/);
  assert.match(bookingCreate, /Client totals are never trusted/);
  assert.match(bookingCreate, /create_public_booking_intake/);
  assert.match(bookingCreate, /customer_auth_created:\s*false/);
  assert.doesNotMatch(bookingCreate, /auth\/v1\/(signup|invite|admin\/users)/);
  assert.match(bookingQuote, /getGovernedResidentialRequiredVersion/);
  assert.match(bookingQuote, /requireServiceosServerTarget/);
});

test('public booking schema is service-role only and preserves accepted-only Operations boundary', () => {
  assert.match(bookingMigration, /create table if not exists public\.booking/i);
  assert.match(bookingMigration, /service_request_id uuid not null unique references public\.service_request/i);
  assert.match(bookingMigration, /alter table public\.booking force row level security/i);
  assert.match(bookingMigration, /revoke all on table public\.booking from anon/i);
  assert.match(bookingMigration, /revoke all on table public\.booking from authenticated/i);
  assert.match(bookingMigration, /create or replace function public\.create_public_booking_intake/i);
  assert.match(bookingMigration, /security definer/i);
  assert.match(bookingMigration, /grant execute on function public\.create_public_booking_intake[\s\S]*to service_role/i);
  assert.doesNotMatch(bookingMigration, /insert into public\.operational_job/i);
  assert.doesNotMatch(bookingMigration, /insert into public\.job_handoff/i);
  assert.doesNotMatch(bookingMigration, /insert into public\.conversion_record/i);
});

test('Finance automatically surfaces uninvoiced QA-passed jobs for the active business unit', () => {
  assert.match(finance, /Billing Queue \/ Pending Invoices/);
  assert.match(finance, /operational_status=in\.\(qa_passed,closed\)/);
  assert.match(finance, /business_unit_id=eq\.\$\{encodeURIComponent\(activeBusinessUnitId\)\}/);
  assert.match(finance, /invoice_request\?select=/);
  assert.match(finance, /invoicedJobIds/);
  assert.match(finance, /setBillingQueue\(jobs\.filter/);
  assert.match(finance, /useEffect\(\(\) => \{[\s\S]*refreshBillingQueue\(\)/);
  assert.match(shell, /primaryBusinessUnitId: activeBusinessUnit\.id/);
  assert.match(shell, /activeBusinessUnitCode: activeBusinessUnit\.code/);
});
