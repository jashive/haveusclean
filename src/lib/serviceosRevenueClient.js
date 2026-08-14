// ── Wave 2: ServiceOS Revenue Client ─────────────────────────────────────────
//
// Feature-flagged canonical REST client for the revenue pipeline.
// All functions are HARD no-ops when VITE_SERVICEOS_REVENUE_ENABLED !== "true".
// Zero canonical revenue calls are made while the flag is off.
//
// Uses the same authenticatedRestFetch / direct REST pattern as Wave 1.
// Does NOT add @supabase/supabase-js.
//
// Wave 2 NEW tables (9):
//   service_request, opportunity, estimate, pricing_snapshot,
//   quote, quote_version, quote_response, conversion_record, job_handoff
//
// Wave 1 canonical tables (used but NOT created by Wave 2):
//   customer, contact, service_location

import { authenticatedRestFetch } from "./serviceosAuthClient.js";

// ── Feature guard ─────────────────────────────────────────────────────────────

function isRevenueEnabled() {
  try {
    return (typeof import.meta !== "undefined" ? import.meta.env?.VITE_SERVICEOS_REVENUE_ENABLED : "") === "true";
  } catch {
    return false;
  }
}

function assertEnabled() {
  if (!isRevenueEnabled()) {
    throw new Error("ServiceOS revenue feature is disabled (VITE_SERVICEOS_REVENUE_ENABLED is not true)");
  }
}

// ── Generic helpers ───────────────────────────────────────────────────────────

async function insertOne(table, payload, accessToken) {
  const res = await authenticatedRestFetch(table, accessToken, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`Revenue insert failed on ${table}: ${res?.status ?? "network error"} ${text}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

/**
 * Update a single column on a table row by id.
 * Used for quote_version lifecycle transitions (draft → sent → accepted).
 * Only updates the specified fields — no other edits allowed per the pipeline contract.
 */
async function updateById(table, id, patch, accessToken) {
  const res = await authenticatedRestFetch(
    `${table}?id=eq.${encodeURIComponent(id)}`,
    accessToken,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    }
  );
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`Revenue update failed on ${table} id=${id}: ${res?.status ?? "network error"} ${text}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function deleteById(table, id, accessToken) {
  const res = await authenticatedRestFetch(`${table}?id=eq.${encodeURIComponent(id)}`, accessToken, {
    method: "DELETE",
  });
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(`Revenue delete failed on ${table} id=${id}: ${res?.status ?? "network error"} ${text}`);
  }
  return true;
}

// ── Service Request ───────────────────────────────────────────────────────────

export async function createServiceRequest(payload, accessToken) {
  assertEnabled();
  return insertOne("service_request", payload, accessToken);
}

// ── Opportunity ───────────────────────────────────────────────────────────────

export async function createOpportunity(payload, accessToken) {
  assertEnabled();
  return insertOne("opportunity", payload, accessToken);
}

// ── Estimate ──────────────────────────────────────────────────────────────────

export async function createEstimate(payload, accessToken) {
  assertEnabled();
  return insertOne("estimate", payload, accessToken);
}

// ── Pricing Snapshot ──────────────────────────────────────────────────────────

export async function createPricingSnapshot(payload, accessToken) {
  assertEnabled();
  return insertOne("pricing_snapshot", payload, accessToken);
}

// ── Quote ─────────────────────────────────────────────────────────────────────

export async function createQuote(payload, accessToken) {
  assertEnabled();
  return insertOne("quote", payload, accessToken);
}

// ── Quote Version ─────────────────────────────────────────────────────────────

export async function createQuoteVersion(payload, accessToken) {
  assertEnabled();
  return insertOne("quote_version", payload, accessToken);
}

/**
 * Transition a quote_version through its lifecycle.
 * Valid transitions: draft → sent, sent → accepted
 * Do NOT combine with commercial edits.
 *
 * @param {string} quoteVersionId
 * @param {"sent"|"accepted"} newStatus
 * @param {string} accessToken
 * @returns {Promise<object>} Updated row
 */
export async function updateQuoteVersionStatus(quoteVersionId, newStatus, accessToken) {
  assertEnabled();
  if (newStatus !== "sent" && newStatus !== "accepted") {
    throw new Error('updateQuoteVersionStatus: newStatus must be "sent" or "accepted"');
  }
  const patch = { lifecycle_status: newStatus };
  if (newStatus === "sent") {
    patch.sent_at = new Date().toISOString();
  }
  return updateById("quote_version", quoteVersionId, patch, accessToken);
}

// ── Quote Response ────────────────────────────────────────────────────────────

export async function createQuoteResponse(payload, accessToken) {
  assertEnabled();
  return insertOne("quote_response", payload, accessToken);
}

// ── Conversion Record ─────────────────────────────────────────────────────────
//
// Records the explicit moment a prospect converts to a customer.
// Never auto-created; always an intentional conversion action.

export async function createConversionRecord(payload, accessToken) {
  assertEnabled();
  return insertOne("conversion_record", payload, accessToken);
}

// ── Customer ──────────────────────────────────────────────────────────────────
//
// Wave 1 canonical table. Customers are NOT deduplicated by email.
// Email/phone live on contact, not here.

export async function createCustomer(payload, accessToken) {
  assertEnabled();
  return insertOne("customer", payload, accessToken);
}

// ── Contact ───────────────────────────────────────────────────────────────────

export async function createContact(payload, accessToken) {
  assertEnabled();
  return insertOne("contact", payload, accessToken);
}

// ── Service Location ──────────────────────────────────────────────────────────

export async function createServiceLocation(payload, accessToken) {
  assertEnabled();
  return insertOne("service_location", payload, accessToken);
}

// ── Job Handoff (Wave 3 boundary) ─────────────────────────────────────────────
//
// Creates the handoff marker only. No scheduling or work orders.

export async function createJobHandoff(payload, accessToken) {
  assertEnabled();
  return insertOne("job_handoff", payload, accessToken);
}

// ── Pipeline orchestration ────────────────────────────────────────────────────

/**
 * Run the full revenue pipeline for a single accepted quote.
 * Returns an object with every created row so callers can track them.
 *
 * Pipeline order (M005-verified):
 *   1.  service_request
 *   2.  opportunity
 *   3.  estimate
 *   4.  pricing_snapshot  (economics locked here; immutable after creation)
 *   5.  quote
 *   6.  quote_version (lifecycle_status = draft)
 *   7.  UPDATE quote_version: draft → sent
 *   8.  quote_response (accepted; quote_version must be "sent")
 *   9.  UPDATE quote_version: sent → accepted
 *   10. customer + contact + service_location (explicit conversion; Wave 1 tables)
 *   13. conversion_record
 *   14. job_handoff (Wave 3 boundary)
 *
 * @param {object} opts
 * @param {object} opts.serviceRequestPayload
 * @param {object} opts.opportunityPayload
 * @param {object} opts.estimatePayload
 * @param {object} opts.pricingSnapshotPayload  Pre-built via capturePricingSnapshot()
 * @param {object} opts.quotePayload
 * @param {object} opts.quoteVersionPayload
 * @param {object} opts.quoteResponsePayload
 * @param {object} opts.customerPayload
 * @param {object} opts.contactPayload
 * @param {object} opts.serviceLocationPayload
 * @param {object} opts.conversionRecordPayload
 * @param {object} opts.jobHandoffPayload
 * @param {string} opts.accessToken
 * @returns {Promise<object>} Map of entity → created row
 */
export async function runRevenuePipeline({
  serviceRequestPayload,
  opportunityPayload,
  estimatePayload,
  pricingSnapshotPayload,
  quotePayload,
  quoteVersionPayload,
  quoteResponsePayload,
  customerPayload,
  contactPayload,
  serviceLocationPayload,
  conversionRecordPayload,
  jobHandoffPayload,
  accessToken,
}) {
  assertEnabled();

  // 1. Service request
  const serviceRequest = await insertOne("service_request", serviceRequestPayload, accessToken);

  // 2. Opportunity (linked to service_request)
  const opportunity = await insertOne(
    "opportunity",
    { ...opportunityPayload, service_request_id: serviceRequest.id },
    accessToken
  );

  // 3. Estimate (linked to opportunity)
  const estimate = await insertOne(
    "estimate",
    { ...estimatePayload, opportunity_id: opportunity.id },
    accessToken
  );

  // 4. Pricing snapshot — immutable economics locked here
  const pricingSnapshot = await insertOne(
    "pricing_snapshot",
    { ...pricingSnapshotPayload, opportunity_id: opportunity.id, estimate_id: estimate.id },
    accessToken
  );

  // 5. Quote (linked to opportunity and estimate; no pricing_snapshot_id on quote)
  const quote = await insertOne(
    "quote",
    { ...quotePayload, opportunity_id: opportunity.id, estimate_id: estimate.id },
    accessToken
  );

  // 6. Quote version — MUST start as draft; pricing_snapshot_id goes HERE
  const quoteVersion = await insertOne(
    "quote_version",
    {
      ...quoteVersionPayload,
      quote_id: quote.id,
      estimate_id: estimate.id,
      pricing_snapshot_id: pricingSnapshot.id,
    },
    accessToken
  );

  // 7. Transition quote_version: draft → sent
  await updateById(
    "quote_version",
    quoteVersion.id,
    { lifecycle_status: "sent", sent_at: new Date().toISOString() },
    accessToken
  );

  // 8. Quote response — accepted; quote_version is now "sent"
  const quoteResponse = await insertOne(
    "quote_response",
    { ...quoteResponsePayload, quote_version_id: quoteVersion.id },
    accessToken
  );

  // 9. Transition quote_version: sent → accepted
  await updateById(
    "quote_version",
    quoteVersion.id,
    { lifecycle_status: "accepted" },
    accessToken
  );

  // 10–12. Explicit customer conversion — Wave 1 canonical tables
  const customer = await insertOne("customer", customerPayload, accessToken);
  const contact = await insertOne(
    "contact",
    { ...contactPayload, customer_id: customer.id },
    accessToken
  );
  const serviceLocation = await insertOne(
    "service_location",
    { ...serviceLocationPayload, customer_id: customer.id },
    accessToken
  );

  // 13. Conversion record — links the entire pipeline to the converted customer
  const conversionRecord = await insertOne(
    "conversion_record",
    {
      ...conversionRecordPayload,
      service_request_id: serviceRequest.id,
      opportunity_id: opportunity.id,
      estimate_id: estimate.id,
      quote_id: quote.id,
      quote_version_id: quoteVersion.id,
      quote_response_id: quoteResponse.id,
      customer_id: customer.id,
      contact_id: contact.id,
      service_location_id: serviceLocation.id,
    },
    accessToken
  );

  // 14. Wave 3 boundary: job_handoff references conversion_record
  const jobHandoff = await insertOne(
    "job_handoff",
    {
      ...jobHandoffPayload,
      conversion_record_id: conversionRecord.id,
      quote_version_id: quoteVersion.id,
      pricing_snapshot_id: pricingSnapshot.id,
    },
    accessToken
  );

  return {
    serviceRequest,
    opportunity,
    estimate,
    pricingSnapshot,
    quote,
    quoteVersion,
    quoteResponse,
    customer,
    contact,
    serviceLocation,
    conversionRecord,
    jobHandoff,
  };
}

// ── Pilot cleanup ─────────────────────────────────────────────────────────────
//
// Deletes ONLY the records explicitly created by a synthetic pilot session.
// Deletion order respects foreign-key dependencies (children first).
// pricing_snapshot is immutable but orphan snapshots may be deleted after
// quote_version is deleted.

/**
 * @param {object} createdIds  Map of entity → { id } as returned by runRevenuePipeline
 * @param {string} accessToken
 */
export async function cleanupPilotSession(createdIds, accessToken) {
  assertEnabled();

  const order = [
    "job_handoff",
    "conversion_record",
    "service_location",
    "contact",
    "customer",
    "quote_response",
    "quote_version",
    "quote",
    "pricing_snapshot",
    "estimate",
    "opportunity",
    "service_request",
  ];

  const errors = [];
  for (const table of order) {
    const key = toCamelKey(table);
    const row = createdIds[key];
    if (row?.id) {
      try {
        await deleteById(table, row.id, accessToken);
      } catch (err) {
        errors.push({ table, id: row.id, error: err.message });
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Pilot cleanup had ${errors.length} error(s): ${errors.map((e) => `${e.table}/${e.id}: ${e.error}`).join("; ")}`
    );
  }
  return true;
}

function toCamelKey(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
