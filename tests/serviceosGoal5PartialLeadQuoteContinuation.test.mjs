import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const panel = fs.readFileSync("src/features/wave1/ServiceOSLeadIntakePanel.jsx", "utf8");
const continuation = fs.readFileSync("src/features/wave1/ServiceOSPartialLeadQuoteContinuation.jsx", "utf8");
const client = fs.readFileSync("src/lib/serviceosLeadQuoteContinuationClient.js", "utf8");
const intakeClient = fs.readFileSync("src/lib/serviceosLeadIntakeClient.js", "utf8");

test("saved partial lead exposes explicit continuation to quote", () => {
  assert.match(panel, /Continue This Lead to Quote/);
  assert.match(panel, /ServiceOSPartialLeadQuoteContinuation/);
  assert.match(panel, /!result\?\.duplicate_review_required/);
});

test("continuation reuses canonical service request and opportunity instead of creating new ones", () => {
  assert.match(continuation, /promoteExistingLeadForQuote/);
  assert.match(continuation, /createEstimate/);
  assert.match(continuation, /createPricingSnapshot/);
  assert.match(continuation, /createQuote/);
  assert.match(continuation, /createQuoteVersion/);
  assert.doesNotMatch(continuation, /createServiceRequest/);
  assert.doesNotMatch(continuation, /createOpportunity/);
});

test("quote generation requires pricing inputs but not complete booking identity", () => {
  assert.match(continuation, /Bedrooms and bathrooms are required to price this residential lead/);
  assert.doesNotMatch(continuation, /Customer name is required/);
  assert.doesNotMatch(continuation, /Service address and city are required/);
  assert.match(continuation, /Quote allowed — booking information still incomplete/);
});

test("booking readiness is persisted separately from quote readiness", () => {
  assert.match(continuation, /booking_ready: bookingMissing.length === 0/);
  assert.match(continuation, /booking_missing: bookingMissing/);
  assert.match(client, /quote_ready: true/);
  assert.match(client, /continued_from_partial_intake: true/);
});

test("existing lead promotion remains business-unit scoped and fail closed", () => {
  assert.match(client, /serviceRequest\.business_unit_id !== businessUnitId/);
  assert.match(client, /opportunity\.business_unit_id !== businessUnitId/);
  assert.match(client, /Only intake\/qualified leads can continue to quote/);
  assert.match(client, /Only open\/proposal opportunities can continue to quote/);
});

test("restored saved leads carry canonical business unit ids needed by the continuation guard", () => {
  assert.match(intakeClient, /id,organization_id,business_unit_id,title,lifecycle_status/);
  assert.match(intakeClient, /id,organization_id,business_unit_id,service_request_id,stage/);
});

test("saved lead continuation anchors to its visible canonical business unit", () => {
  assert.match(panel, /serviceRequestBusinessUnitId/);
  assert.match(panel, /serviceRequestBusinessUnitId !== opportunityBusinessUnitId/);
  assert.match(panel, /visibleRecords\.find\(\(item\) => item\.id === serviceRequestBusinessUnitId\)/);
  assert.match(panel, /primaryBusinessUnitId: canonicalLeadBusinessUnit\.id/);
  assert.match(panel, /activeBusinessUnitCode: canonicalLeadBusinessUnit\.code/);
});

test("changing active market closes stale continuation state", () => {
  assert.match(panel, /setContinuationLead\(null\);\s*setResult\(null\);\s*refreshRecentLeads\(\)/);
  assert.match(panel, /\[accessToken, organizationId, businessUnitId\]/);
});

test("sent action remains explicit and does not fabricate acceptance", () => {
  assert.match(continuation, /I Sent This Quote — Record Sent/);
  assert.match(continuation, /does not mark the customer accepted or create a job/);
  assert.match(continuation, /updateQuoteVersionStatus\(saved\.quoteVersion\.id, "sent"/);
  assert.doesNotMatch(continuation, /"accepted"/);
});
