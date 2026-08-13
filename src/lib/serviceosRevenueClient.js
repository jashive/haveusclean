// ── Wave 2: ServiceOS Revenue Client ─────────────────────────────────────────
//
// Feature-flagged canonical REST client for the revenue pipeline.
// All functions are HARD no-ops when VITE_SERVICEOS_REVENUE_ENABLED !== "true".
// Zero canonical revenue calls are made while the flag is off.
//
// Uses the same authenticatedRestFetch / direct REST pattern as Wave 1.
// Does NOT add @supabase/supabase-js.
//
// Canonical table names (snake_case, no huc_* prefix):
//   service_request, opportunity, estimate, pricing_snapshot,
//   quote, quote_version, quote_response,
//   customer, contact, service_location, job_handoff

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

/**
 * Create a service_request record.
 *
 * @param {object} payload   Fields matching the service_request schema
 * @param {string} accessToken
 * @returns {Promise<object>} Created row
 */
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

/**
 * Persist a pricing snapshot.
 * The snapshot captures accepted economics so they are never recomputed
 * from future JS pricing constants.
 */
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

// ── Quote Response ────────────────────────────────────────────────────────────

export async function createQuoteResponse(payload, accessToken) {
  assertEnabled();
  return insertOne("quote_response", payload, accessToken);
}

// ── Customer ──────────────────────────────────────────────────────────────────
//
// Customers are NOT deduplicated by name. Each explicit conversion produces
// a distinct customer row. Email/phone live on contact, not here.

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
 * Returns an object with every created row ID so callers can track them.
 *
 * Steps:
 *   1. service_request
 *   2. opportunity
 *   3. estimate
 *   4. pricing_snapshot  (economics locked here)
 *   5. quote
 *   6. quote_version
 *   7. quote_response (accepted)
 *   8. customer + contact + service_location (explicit conversion)
 *   9. job_handoff (Wave 3 boundary)
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
  jobHandoffPayload,
  accessToken,
}) {
  assertEnabled();

  const serviceRequest = await insertOne("service_request", serviceRequestPayload, accessToken);
  const opportunity = await insertOne(
    "opportunity",
    { ...opportunityPayload, service_request_id: serviceRequest.id },
    accessToken
  );
  const estimate = await insertOne(
    "estimate",
    { ...estimatePayload, opportunity_id: opportunity.id },
    accessToken
  );
  const pricingSnapshot = await insertOne(
    "pricing_snapshot",
    pricingSnapshotPayload,
    accessToken
  );
  const quote = await insertOne(
    "quote",
    { ...quotePayload, estimate_id: estimate.id, pricing_snapshot_id: pricingSnapshot.id },
    accessToken
  );
  const quoteVersion = await insertOne(
    "quote_version",
    { ...quoteVersionPayload, quote_id: quote.id, pricing_snapshot_id: pricingSnapshot.id },
    accessToken
  );
  const quoteResponse = await insertOne(
    "quote_response",
    { ...quoteResponsePayload, quote_version_id: quoteVersion.id },
    accessToken
  );

  // Explicit customer conversion — never auto-converted from a cold prospect
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

  // Wave 3 boundary: job_handoff only
  const jobHandoff = await insertOne(
    "job_handoff",
    {
      ...jobHandoffPayload,
      quote_version_id: quoteVersion.id,
      customer_id: customer.id,
      contact_id: contact.id,
      service_location_id: serviceLocation.id,
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
    jobHandoff,
  };
}

// ── Pilot cleanup ─────────────────────────────────────────────────────────────
//
// Deletes ONLY the records explicitly created by a synthetic pilot session.
// Deletion order respects foreign-key dependencies (children first).

/**
 * @param {object} createdIds  Map of entity → { id } as returned by runRevenuePipeline
 * @param {string} accessToken
 */
export async function cleanupPilotSession(createdIds, accessToken) {
  assertEnabled();

  const order = [
    "job_handoff",
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
