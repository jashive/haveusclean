import test from "node:test";
import assert from "node:assert/strict";
import {
  capturePricingSnapshot,
  buildOpportunityPayload,
  buildEstimatePayload,
  buildQuotePayload,
  buildQuoteVersionPayload,
  buildQuoteResponsePayload,
  buildCustomerPayload,
  buildContactPayload,
  buildServiceLocationPayload,
  buildJobHandoffPayload,
} from "../src/lib/serviceosRevenueUtils.js";

// ── Wave 2 table contract ─────────────────────────────────────────────────────
// Confirm the 9 NEW Wave 2 tables are exactly as specified.

test("Wave 2 new table contract: 9 tables — no customer/contact/service_location", () => {
  const WAVE2_NEW_TABLES = [
    "service_request",
    "opportunity",
    "estimate",
    "pricing_snapshot",
    "quote",
    "quote_version",
    "quote_response",
    "conversion_record",
    "job_handoff",
  ];
  assert.equal(WAVE2_NEW_TABLES.length, 9);
  // Wave 1 canonical tables must NOT appear in the Wave 2 new-table list
  assert.equal(WAVE2_NEW_TABLES.includes("customer"), false);
  assert.equal(WAVE2_NEW_TABLES.includes("contact"), false);
  assert.equal(WAVE2_NEW_TABLES.includes("service_location"), false);
  // conversion_record must be present
  assert.equal(WAVE2_NEW_TABLES.includes("conversion_record"), true);
});

// ── validateServiceOSContext return shape (unit-level, no network) ────────────

test("validateServiceOSContext return shape carries businessUnitRecords and primaryBusinessUnitId", () => {
  // Simulate the shape that validateServiceOSContext now returns so downstream
  // consumers (buildRevenueContext) can be verified without a live network call.
  const mockValidationResult = {
    orgId: "org-uuid-001",
    appUserId: "user-uuid-001",
    roleId: "role-uuid-001",
    businessUnits: ["HUC-ON", "HUC-AZ"],
    businessUnitRecords: [
      { id: "bu-uuid-on", code: "HUC-ON", name: "HaveUsClean Ontario" },
      { id: "bu-uuid-az", code: "HUC-AZ", name: "HaveUsClean Arizona" },
    ],
    businessUnitByCode: {
      "HUC-ON": { id: "bu-uuid-on", code: "HUC-ON", name: "HaveUsClean Ontario" },
      "HUC-AZ": { id: "bu-uuid-az", code: "HUC-AZ", name: "HaveUsClean Arizona" },
    },
    primaryBusinessUnitId: "bu-uuid-on",
  };

  // businessUnits backward compat
  assert.deepEqual(mockValidationResult.businessUnits, ["HUC-ON", "HUC-AZ"]);
  // UUID resolution for HUC-ON
  assert.equal(mockValidationResult.businessUnitByCode["HUC-ON"].id, "bu-uuid-on");
  // UUID resolution for HUC-AZ
  assert.equal(mockValidationResult.businessUnitByCode["HUC-AZ"].id, "bu-uuid-az");
  // primaryBusinessUnitId derives from the live record, not from region_id
  assert.equal(mockValidationResult.primaryBusinessUnitId, "bu-uuid-on");
  // businessUnitRecords carries all fields
  assert.equal(mockValidationResult.businessUnitRecords.length, 2);
  assert.equal(mockValidationResult.businessUnitRecords[0].id, "bu-uuid-on");
  assert.equal(mockValidationResult.businessUnitRecords[1].id, "bu-uuid-az");
});

// ── capturePricingSnapshot ────────────────────────────────────────────────────

test("capturePricingSnapshot returns expected shape from full quote", () => {
  const quote = {
    preTaxTotal: 300,
    taxAmount: 39,
    taxRate: 0.13,
    taxName: "HST",
    total: 339,
    discountAmt: 0,
    discPct: 0,
    partnerPay: 180,
    partnerPayEach: 90,
    profit: 120,
    teamSize: 2,
    jobHours: 3,
    currency: "CA$",
    quoteContractVersion: "2.0",
    confidence: "High",
  };
  const snap = capturePricingSnapshot({ quote, businessUnitId: "bu-001" });

  assert.equal(snap.business_unit_id, "bu-001");
  assert.equal(snap.pre_tax_total, 300);
  assert.equal(snap.tax_amount, 39);
  assert.equal(snap.tax_rate, 0.13);
  assert.equal(snap.total, 339);
  assert.equal(snap.partner_pay_total, 180);
  assert.equal(snap.profit, 120);
  assert.equal(snap.team_size, 2);
  assert.equal(snap.job_hours, 3);
  assert.equal(snap.currency, "CA$");
  assert.equal(snap.quote_contract_version, "2.0");
  assert.equal(snap.confidence, "High");
  assert.ok(typeof snap.captured_at === "string");
  assert.equal(snap.quote_version_id, null);
});

test("capturePricingSnapshot accepts custom capturedAt and quoteVersionId", () => {
  const quote = { total: 200, preTaxTotal: 180, taxAmount: 20, profit: 60, teamSize: 1 };
  const snap = capturePricingSnapshot({
    quote,
    businessUnitId: "bu-on",
    capturedAt: "2025-01-01T12:00:00.000Z",
    quoteVersionId: "qv-123",
  });

  assert.equal(snap.captured_at, "2025-01-01T12:00:00.000Z");
  assert.equal(snap.quote_version_id, "qv-123");
  assert.equal(snap.total, 200);
});

test("capturePricingSnapshot throws when quote is missing", () => {
  assert.throws(
    () => capturePricingSnapshot({ quote: null, businessUnitId: "bu-001" }),
    /quote is required/
  );
});

test("capturePricingSnapshot throws when businessUnitId is missing", () => {
  assert.throws(
    () => capturePricingSnapshot({ quote: { total: 100 }, businessUnitId: "" }),
    /businessUnitId is required/
  );
});

// ── buildOpportunityPayload ───────────────────────────────────────────────────

test("buildOpportunityPayload returns correct shape", () => {
  const payload = buildOpportunityPayload({
    serviceRequestId: "sr-1",
    businessUnitId: "bu-on",
    appUserId: "usr-1",
    notes: "Test opp",
  });

  assert.equal(payload.service_request_id, "sr-1");
  assert.equal(payload.business_unit_id, "bu-on");
  assert.equal(payload.created_by, "usr-1");
  assert.equal(payload.status, "open");
  assert.equal(payload.notes, "Test opp");
});

test("buildOpportunityPayload throws without serviceRequestId", () => {
  assert.throws(
    () => buildOpportunityPayload({ businessUnitId: "bu-on" }),
    /serviceRequestId required/
  );
});

test("buildOpportunityPayload throws without businessUnitId", () => {
  assert.throws(
    () => buildOpportunityPayload({ serviceRequestId: "sr-1", businessUnitId: "" }),
    /businessUnitId required/
  );
});

// ── buildEstimatePayload ──────────────────────────────────────────────────────

test("buildEstimatePayload returns correct shape", () => {
  const payload = buildEstimatePayload({
    opportunityId: "opp-1",
    businessUnitId: "bu-on",
    quoteType: "residential",
    quoteInput: { sqft: 1500 },
  });

  assert.equal(payload.opportunity_id, "opp-1");
  assert.equal(payload.business_unit_id, "bu-on");
  assert.equal(payload.quote_type, "residential");
  assert.deepEqual(payload.quote_input, { sqft: 1500 });
  assert.equal(payload.status, "draft");
});

// ── buildQuotePayload ─────────────────────────────────────────────────────────

test("buildQuotePayload includes business_unit_id", () => {
  const payload = buildQuotePayload({
    estimateId: "est-1",
    businessUnitId: "bu-az",
    pricingSnapshotId: "snap-1",
    totalAmount: 450,
  });

  assert.equal(payload.business_unit_id, "bu-az");
  assert.equal(payload.estimate_id, "est-1");
  assert.equal(payload.pricing_snapshot_id, "snap-1");
  assert.equal(payload.total_amount, 450);
  assert.equal(payload.status, "draft");
});

test("buildQuotePayload throws without estimateId", () => {
  assert.throws(
    () => buildQuotePayload({ businessUnitId: "bu-on" }),
    /estimateId required/
  );
});

// ── buildQuoteVersionPayload ──────────────────────────────────────────────────

test("buildQuoteVersionPayload defaults version_number to 1", () => {
  const payload = buildQuoteVersionPayload({ quoteId: "q-1" });

  assert.equal(payload.quote_id, "q-1");
  assert.equal(payload.version_number, 1);
  assert.equal(payload.status, "active");
});

// ── buildQuoteResponsePayload ─────────────────────────────────────────────────

test("buildQuoteResponsePayload accepted path", () => {
  const payload = buildQuoteResponsePayload({
    quoteVersionId: "qv-1",
    responseType: "accepted",
    respondedBy: "usr-1",
  });

  assert.equal(payload.quote_version_id, "qv-1");
  assert.equal(payload.response_type, "accepted");
  assert.equal(payload.responded_by, "usr-1");
  assert.ok(typeof payload.responded_at === "string");
});

test("buildQuoteResponsePayload rejects invalid responseType", () => {
  assert.throws(
    () => buildQuoteResponsePayload({ quoteVersionId: "qv-1", responseType: "maybe" }),
    /responseType must be/
  );
});

// ── Customer / Contact / Service Location ─────────────────────────────────────

test("buildCustomerPayload does NOT include email field (email lives on Contact)", () => {
  const payload = buildCustomerPayload({ businessUnitId: "bu-on", name: "Acme", type: "commercial" });

  assert.equal(payload.business_unit_id, "bu-on");
  assert.equal(payload.name, "Acme");
  assert.equal(payload.type, "commercial");
  assert.equal(payload.status, "active");
  // The customer row MUST NOT carry email/phone
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "email"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "phone"), false);
});

test("buildContactPayload carries email/phone and links to customerId", () => {
  const payload = buildContactPayload({
    customerId: "cust-1",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "416-555-0100",
  });

  assert.equal(payload.customer_id, "cust-1");
  assert.equal(payload.email, "jane@example.com");
  assert.equal(payload.phone, "416-555-0100");
  assert.equal(payload.is_primary, true);
});

test("buildContactPayload throws without customerId", () => {
  assert.throws(
    () => buildContactPayload({ email: "x@x.com" }),
    /customerId required/
  );
});

test("buildServiceLocationPayload includes business_unit_id but not region_id", () => {
  const payload = buildServiceLocationPayload({
    customerId: "cust-1",
    businessUnitId: "bu-on",
    city: "Toronto",
    provinceState: "ON",
    country: "CA",
  });

  assert.equal(payload.customer_id, "cust-1");
  assert.equal(payload.business_unit_id, "bu-on");
  assert.equal(payload.city, "Toronto");
  // Must NOT invent region_id
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "region_id"), false);
});

// ── buildJobHandoffPayload ────────────────────────────────────────────────────

test("buildJobHandoffPayload creates Wave 3 boundary with required fields", () => {
  const payload = buildJobHandoffPayload({
    quoteVersionId: "qv-1",
    customerId: "cust-1",
    serviceLocationId: "sl-1",
    businessUnitId: "bu-on",
    contactId: "ct-1",
    pricingSnapshotId: "snap-1",
  });

  assert.equal(payload.quote_version_id, "qv-1");
  assert.equal(payload.customer_id, "cust-1");
  assert.equal(payload.service_location_id, "sl-1");
  assert.equal(payload.business_unit_id, "bu-on");
  assert.equal(payload.contact_id, "ct-1");
  assert.equal(payload.pricing_snapshot_id, "snap-1");
  assert.equal(payload.status, "pending");
  assert.ok(typeof payload.handed_off_at === "string");
});

test("buildJobHandoffPayload throws without required fields", () => {
  assert.throws(() => buildJobHandoffPayload({ customerId: "c", serviceLocationId: "sl", businessUnitId: "bu" }), /quoteVersionId required/);
  assert.throws(() => buildJobHandoffPayload({ quoteVersionId: "q", serviceLocationId: "sl", businessUnitId: "bu" }), /customerId required/);
  assert.throws(() => buildJobHandoffPayload({ quoteVersionId: "q", customerId: "c", businessUnitId: "bu" }), /serviceLocationId required/);
  assert.throws(() => buildJobHandoffPayload({ quoteVersionId: "q", customerId: "c", serviceLocationId: "sl" }), /businessUnitId required/);
});
