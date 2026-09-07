import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildDispatchCascade } from "../src/lib/serviceosDispatchCascade.js";
import { buildOperationalJobPayload, buildWorkOrderPayload } from "../src/lib/serviceosOperationsUtils.js";

const bookingApi = fs.readFileSync(new URL("../api/bookings/create.js", import.meta.url), "utf8");
const bookingUi = fs.readFileSync(new URL("../src/components/BookingWidget.jsx", import.meta.url), "utf8");
const operations = fs.readFileSync(new URL("../src/features/wave3/ServiceOSOperationsWorkspace.jsx", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260907010000_zero_entry_booking_location_cascade.sql", import.meta.url), "utf8");

test("public booking captures the complete zero-entry intake shape", () => {
  for (const field of ["addressLine2", "accessNotes", "customer", "location", "scope"]) assert.match(bookingApi + bookingUi, new RegExp(field));
  assert.match(bookingApi, /address_line2: addressLine2/);
  assert.match(bookingApi, /access_notes: accessNotes/);
});

test("public booking location trigger persists Unit/Apt and access notes transactionally", () => {
  assert.match(migration, /after insert or update of requirements on public\.service_request/i);
  assert.match(migration, /new\.intake_channel = 'public_booking'/i);
  assert.match(migration, /set address_line2 =/i);
  assert.match(migration, /access_notes =/i);
  assert.match(migration, /customer_id = new\.customer_id/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test("fresh booking dry run reaches immutable job and work-order snapshots without retyping", () => {
  const cascade = buildDispatchCascade({
    requirements: {
      customer: { name: "TEST Zero Entry", email: "zero@example.invalid", phone: "+14165550123" },
      location: { address_line1: "45 Test Street", address_line2: "Unit 7", city: "Brampton", subdivision: "ON", postal_code: "L6V 3C5", country_code: "CA", access_notes: "Buzz 701" },
      scope: { packageKey: "essential_refresh", dwellingType: "townhouse", beds: 3, baths: 2.5, sqft: 1800, condition: "light", frequency: "biweekly", addons: ["inside_oven"], preferredDate: "2026-09-21", preferredWindow: "Morning", notes: "Use side entrance" },
    },
    booking: { currency_code: "CAD", tax_name: "HST", tax_rate: 0.13, estimated_subtotal: 300, estimated_tax: 39, estimated_total: 339 },
    customer: { display_name: "TEST Zero Entry" },
    contact: { email: "zero@example.invalid", phone: "+14165550123" },
    location: { address_line1: "45 Test Street", address_line2: "Unit 7", city: "Brampton", subdivision: "ON", postal_code: "L6V 3C5", country_code: "CA", access_notes: "Buzz 701" },
    pricingSnapshot: { id: "pricing-1", currency_code: "CAD", tax_name: "HST", tax_rate: 0.13, subtotal_amount: 300, tax_amount: 39, total_amount: 339 },
  });
  const job = buildOperationalJobPayload({ organizationId: "org", businessUnitId: "on", jurisdictionId: "jur", jobHandoffId: "handoff", conversionRecordId: "conversion", quoteVersionId: "quote", pricingSnapshotId: "pricing-1", customerId: "customer", contactId: "contact", serviceLocationId: "location", serviceFamily: "residential", serviceScopeSnapshot: cascade.scope });
  const workOrder = buildWorkOrderPayload({ organizationId: "org", businessUnitId: "on", jurisdictionId: "jur", operationalJobId: "job", scopeSnapshot: cascade.scope, customerInstructionSnapshot: cascade.customerInstructions, accessInstructionSnapshot: cascade.accessInstructions, checklistTemplateSnapshot: cascade.checklist, pricingReferenceSnapshot: cascade.pricing });
  assert.deepEqual(job.service_scope_snapshot.addons, ["inside_oven"]);
  assert.equal(workOrder.scope_snapshot.location.address_line2, "Unit 7");
  assert.equal(workOrder.access_instruction_snapshot.notes, "Buzz 701");
  assert.equal(workOrder.customer_instruction_snapshot.notes, "Use side entrance");
  assert.equal(workOrder.customer_instruction_snapshot.email, "zero@example.invalid");
  assert.equal(workOrder.customer_instruction_snapshot.phone, "+14165550123");
  assert.equal(workOrder.pricing_reference_snapshot.total_amount, 339);
  assert.equal(workOrder.pricing_reference_snapshot.currency_code, "CAD");
});

test("dispatch UI consumes snapshots and exposes one action after cleaner selection", () => {
  for (const key of ["serviceScopeSnapshot", "scopeSnapshot", "customerInstructionSnapshot", "accessInstructionSnapshot", "checklistTemplateSnapshot", "pricingReferenceSnapshot"]) assert.match(operations, new RegExp(key));
  assert.match(operations, /Assign &amp; Dispatch/);
  assert.match(operations, /select=id,first_name,last_name,email,phone/);
  assert.match(operations, /address_line1,address_line2,city,subdivision,postal_code,country_code,access_notes/);
});
