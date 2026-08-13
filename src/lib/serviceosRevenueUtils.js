// ── Wave 2: ServiceOS Revenue Utils ──────────────────────────────────────────
//
// Pure helpers — no network calls, no import.meta.env dependency.
// Pricing snapshots are captured at acceptance time so that accepted quote
// economics are NEVER recomputed from future JS pricing constants.
//
// Architecture:
//   Service Request → Opportunity → Estimate → Pricing Snapshot
//   → Quote → Quote Version → Quote Response/Acceptance
//   → Customer / Contact / Service Location conversion
//   → Job Handoff (Wave 3 boundary only)

// ── Pricing snapshot ──────────────────────────────────────────────────────────

/**
 * Capture a pricing snapshot from a computed quote at acceptance time.
 * The returned object is suitable for persisting to the pricing_snapshot table.
 *
 * @param {object} opts
 * @param {object} opts.quote        Computed quote object (from calcResQuote / calcComQuote)
 * @param {string} opts.businessUnitId  Canonical business_unit.id (not a region_id)
 * @param {string} [opts.capturedAt] ISO timestamp; defaults to now
 * @param {string} [opts.quoteVersionId]
 * @returns {object} Snapshot payload
 */
export function capturePricingSnapshot({ quote, businessUnitId, capturedAt, quoteVersionId }) {
  if (!quote || typeof quote !== "object") {
    throw new Error("capturePricingSnapshot: quote is required");
  }
  if (!businessUnitId) {
    throw new Error("capturePricingSnapshot: businessUnitId is required");
  }

  return {
    business_unit_id: businessUnitId,
    quote_version_id: quoteVersionId ?? null,
    captured_at: capturedAt ?? new Date().toISOString(),
    // Preserved economics — never recomputed after snapshot is stored
    pre_tax_total: quote.preTaxTotal ?? quote.total ?? 0,
    tax_amount: quote.taxAmount ?? 0,
    tax_rate: quote.taxRate ?? 0,
    tax_name: quote.taxName ?? null,
    total: quote.total ?? 0,
    discount_amount: quote.discountAmt ?? 0,
    discount_pct: quote.discPct ?? 0,
    partner_pay_total: quote.partnerPay ?? quote.partnerPayTotal ?? 0,
    partner_pay_each: quote.partnerPayEach ?? null,
    profit: quote.profit ?? 0,
    team_size: quote.teamSize ?? quote.crewSize ?? 1,
    job_hours: quote.jobHours ?? quote.estimatedHours ?? null,
    currency: quote.currency ?? null,
    // Snapshot provenance
    quote_contract_version: quote.quoteContractVersion ?? null,
    confidence: quote.confidence ?? null,
  };
}

// ── Payload builders ──────────────────────────────────────────────────────────

/**
 * Build an opportunity INSERT payload from a service request.
 * Carries business_unit_id; does NOT invent a region_id.
 */
export function buildOpportunityPayload({ serviceRequestId, businessUnitId, appUserId, notes }) {
  if (!serviceRequestId) throw new Error("buildOpportunityPayload: serviceRequestId required");
  if (!businessUnitId) throw new Error("buildOpportunityPayload: businessUnitId required");

  return {
    service_request_id: serviceRequestId,
    business_unit_id: businessUnitId,
    created_by: appUserId ?? null,
    status: "open",
    notes: notes ?? null,
  };
}

/**
 * Build an estimate INSERT payload from an opportunity + computed quote data.
 */
export function buildEstimatePayload({ opportunityId, businessUnitId, quoteType, quoteInput }) {
  if (!opportunityId) throw new Error("buildEstimatePayload: opportunityId required");
  if (!businessUnitId) throw new Error("buildEstimatePayload: businessUnitId required");

  return {
    opportunity_id: opportunityId,
    business_unit_id: businessUnitId,
    quote_type: quoteType ?? "residential",
    quote_input: quoteInput ?? null,
    status: "draft",
  };
}

/**
 * Build a quote INSERT payload from an estimate + persisted pricing snapshot id.
 */
export function buildQuotePayload({ estimateId, businessUnitId, pricingSnapshotId, totalAmount }) {
  if (!estimateId) throw new Error("buildQuotePayload: estimateId required");
  if (!businessUnitId) throw new Error("buildQuotePayload: businessUnitId required");

  return {
    estimate_id: estimateId,
    business_unit_id: businessUnitId,
    pricing_snapshot_id: pricingSnapshotId ?? null,
    total_amount: totalAmount ?? null,
    status: "draft",
  };
}

/**
 * Build a quote_version INSERT payload.
 */
export function buildQuoteVersionPayload({ quoteId, versionNumber, snapshotId }) {
  if (!quoteId) throw new Error("buildQuoteVersionPayload: quoteId required");

  return {
    quote_id: quoteId,
    version_number: versionNumber ?? 1,
    pricing_snapshot_id: snapshotId ?? null,
    status: "active",
  };
}

/**
 * Build a quote_response INSERT payload (acceptance or rejection).
 *
 * @param {object} opts
 * @param {string} opts.quoteVersionId
 * @param {"accepted"|"rejected"} opts.responseType
 * @param {string} [opts.respondedBy]  app_user.id or contact.id
 * @param {string} [opts.notes]
 */
export function buildQuoteResponsePayload({ quoteVersionId, responseType, respondedBy, notes }) {
  if (!quoteVersionId) throw new Error("buildQuoteResponsePayload: quoteVersionId required");
  if (responseType !== "accepted" && responseType !== "rejected") {
    throw new Error('buildQuoteResponsePayload: responseType must be "accepted" or "rejected"');
  }

  return {
    quote_version_id: quoteVersionId,
    response_type: responseType,
    responded_by: respondedBy ?? null,
    responded_at: new Date().toISOString(),
    notes: notes ?? null,
  };
}

// ── Customer / Contact / Service Location conversion ──────────────────────────
//
// Conversion is EXPLICIT and CONSERVATIVE:
// - Never auto-converts a cold prospect
// - Customer, Contact, and Service Location are distinct entities
// - Customer deduplication is NOT done by name alone
// - Customer row does NOT carry email/phone — that belongs on Contact

/**
 * Build a customer INSERT payload.
 * Email/phone live on Contact, not here.
 *
 * @param {object} opts
 * @param {string} opts.businessUnitId
 * @param {string} [opts.name]
 * @param {string} [opts.type]  "residential" | "commercial"
 * @param {string} [opts.sourceRef]  e.g. the accepted quote_version_id
 */
export function buildCustomerPayload({ businessUnitId, name, type, sourceRef }) {
  if (!businessUnitId) throw new Error("buildCustomerPayload: businessUnitId required");

  return {
    business_unit_id: businessUnitId,
    name: name ?? null,
    type: type ?? "residential",
    source_ref: sourceRef ?? null,
    status: "active",
  };
}

/**
 * Build a contact INSERT payload.
 * Carries email/phone so Customer row stays clean.
 *
 * @param {object} opts
 * @param {string} opts.customerId   customer.id
 * @param {string} [opts.firstName]
 * @param {string} [opts.lastName]
 * @param {string} [opts.email]
 * @param {string} [opts.phone]
 */
export function buildContactPayload({ customerId, firstName, lastName, email, phone }) {
  if (!customerId) throw new Error("buildContactPayload: customerId required");

  return {
    customer_id: customerId,
    first_name: firstName ?? null,
    last_name: lastName ?? null,
    email: email ?? null,
    phone: phone ?? null,
    is_primary: true,
  };
}

/**
 * Build a service_location INSERT payload.
 *
 * @param {object} opts
 * @param {string} opts.customerId
 * @param {string} opts.businessUnitId
 * @param {string} [opts.addressLine1]
 * @param {string} [opts.city]
 * @param {string} [opts.provinceState]
 * @param {string} [opts.postalCode]
 * @param {string} [opts.country]
 */
export function buildServiceLocationPayload({
  customerId,
  businessUnitId,
  addressLine1,
  city,
  provinceState,
  postalCode,
  country,
}) {
  if (!customerId) throw new Error("buildServiceLocationPayload: customerId required");
  if (!businessUnitId) throw new Error("buildServiceLocationPayload: businessUnitId required");

  return {
    customer_id: customerId,
    business_unit_id: businessUnitId,
    address_line_1: addressLine1 ?? null,
    city: city ?? null,
    province_state: provinceState ?? null,
    postal_code: postalCode ?? null,
    country: country ?? null,
    status: "active",
  };
}

// ── Job handoff (Wave 3 boundary) ─────────────────────────────────────────────

/**
 * Build a job_handoff INSERT payload.
 * This is ONLY the Wave 3 boundary marker — no scheduling or work orders.
 *
 * @param {object} opts
 * @param {string} opts.quoteVersionId      Accepted quote version
 * @param {string} opts.customerId
 * @param {string} opts.serviceLocationId
 * @param {string} opts.businessUnitId
 * @param {string} [opts.contactId]
 * @param {string} [opts.pricingSnapshotId]
 */
export function buildJobHandoffPayload({
  quoteVersionId,
  customerId,
  serviceLocationId,
  businessUnitId,
  contactId,
  pricingSnapshotId,
}) {
  if (!quoteVersionId) throw new Error("buildJobHandoffPayload: quoteVersionId required");
  if (!customerId) throw new Error("buildJobHandoffPayload: customerId required");
  if (!serviceLocationId) throw new Error("buildJobHandoffPayload: serviceLocationId required");
  if (!businessUnitId) throw new Error("buildJobHandoffPayload: businessUnitId required");

  return {
    quote_version_id: quoteVersionId,
    customer_id: customerId,
    contact_id: contactId ?? null,
    service_location_id: serviceLocationId,
    business_unit_id: businessUnitId,
    pricing_snapshot_id: pricingSnapshotId ?? null,
    status: "pending",
    handed_off_at: new Date().toISOString(),
  };
}
