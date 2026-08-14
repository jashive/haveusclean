// ── Wave 2: ServiceOS Revenue Utils ──────────────────────────────────────────
//
// Pure helpers — no network calls, no import.meta.env dependency.
// Pricing snapshots are captured at acceptance time so that accepted quote
// economics are NEVER recomputed from future JS pricing constants.
//
// All payload builders match the M005-verified Wave 2 schema exactly.
//
// Architecture:
//   Service Request → Opportunity → Estimate → Pricing Snapshot
//   → Quote → Quote Version (draft → sent → accepted) → Quote Response
//   → Customer / Contact / Service Location conversion
//   → Conversion Record
//   → Job Handoff (Wave 3 boundary only)

// ── Pricing snapshot ──────────────────────────────────────────────────────────

/**
 * Capture a pricing snapshot from a computed quote at acceptance time.
 * Maps all quote economics into the canonical M005 pricing_snapshot schema.
 * The complete raw quote is preserved in raw_calculation_snapshot so
 * accepted economics never need recalculation from future JS constants.
 *
 * NOTE: There is NO pricing_snapshot.quote_version_id in M005.
 *
 * @param {object} opts
 * @param {object} opts.quote        Computed quote object (from calcResQuote / calcComQuote)
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId  Canonical business_unit.id (not a region_id)
 * @param {string} [opts.opportunityId]
 * @param {string} [opts.estimateId]
 * @param {string} [opts.capturedAt]    ISO timestamp; mapped to frozen_at; defaults to now
 * @param {string} [opts.appUserId]     created_by_app_user_id
 * @returns {object} Snapshot payload
 */
export function capturePricingSnapshot({
  quote,
  organizationId,
  businessUnitId,
  opportunityId,
  estimateId,
  capturedAt,
  appUserId,
}) {
  if (!quote || typeof quote !== "object") {
    throw new Error("capturePricingSnapshot: quote is required");
  }
  if (!organizationId) {
    throw new Error("capturePricingSnapshot: organizationId is required");
  }
  if (!businessUnitId) {
    throw new Error("capturePricingSnapshot: businessUnitId is required");
  }

  const frozenAt = capturedAt ?? new Date().toISOString();
  const taxRate = quote.taxRate ?? 0;
  const subtotal = quote.preTaxTotal ?? quote.subtotalAmount ?? quote.total ?? 0;
  const taxAmount = quote.taxAmount ?? 0;
  const total = quote.total ?? 0;
  const discountAmount = quote.discountAmt ?? quote.discountAmount ?? 0;

  // Labor / team economics — preserved in structured field
  const laborEconomics = {
    teamSize: quote.teamSize ?? quote.crewSize ?? null,
    jobHours: quote.jobHours ?? quote.estimatedHours ?? null,
    partnerPayTotal: quote.partnerPay ?? quote.partnerPayTotal ?? null,
    partnerPayEach: quote.partnerPayEach ?? null,
    profit: quote.profit ?? null,
    discountPct: quote.discPct ?? null,
  };

  // Calculation inputs/outputs for auditability
  const calculationInputs = quote.input ?? quote.quoteInput ?? null;
  const calculationOutputs = {
    preTaxTotal: subtotal,
    taxAmount,
    taxRate,
    total,
    discountAmount,
    currency: quote.currency ?? null,
  };

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    opportunity_id: opportunityId ?? null,
    estimate_id: estimateId ?? null,
    configuration_version_id: null,
    // Ontario pilot canonical tax values
    currency_code: quote.currency === "CA$" || !quote.currency ? "CAD" : (quote.currency ?? "CAD"),
    tax_name: quote.taxName ?? "HST",
    tax_rate: taxRate,
    subtotal_amount: subtotal,
    discount_amount: discountAmount,
    tax_amount: taxAmount,
    total_amount: total,
    calculator_version: quote.quoteContractVersion ?? null,
    configuration_snapshot: null,
    labor_economics: laborEconomics,
    calculation_inputs: calculationInputs,
    calculation_outputs: calculationOutputs,
    // Complete raw quote preserved — never recomputed after snapshot stored
    raw_calculation_snapshot: quote,
    frozen_at: frozenAt,
    metadata: null,
    created_by_app_user_id: appUserId ?? null,
  };
}

// ── Payload builders ──────────────────────────────────────────────────────────

/**
 * Build a service_request INSERT payload.
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} [opts.serviceCategory]  Default: "residential"
 * @param {string} [opts.lifecycleStatus]  Default: "qualified"
 * @param {string} [opts.intakeChannel]    Default: "pilot_ui"
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {object} [opts.metadata]
 * @param {string} [opts.appUserId]
 */
export function buildServiceRequestPayload({
  organizationId,
  businessUnitId,
  serviceCategory,
  lifecycleStatus,
  intakeChannel,
  title,
  description,
  metadata,
  appUserId,
}) {
  if (!organizationId) throw new Error("buildServiceRequestPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildServiceRequestPayload: businessUnitId required");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    service_category: serviceCategory ?? "residential",
    lifecycle_status: lifecycleStatus ?? "qualified",
    intake_channel: intakeChannel ?? "pilot_ui",
    requested_at: new Date().toISOString(),
    title: title ?? null,
    description: description ?? null,
    requirements: null,
    metadata: metadata ?? null,
    created_by_app_user_id: appUserId ?? null,
    updated_by_app_user_id: appUserId ?? null,
  };
}

/**
 * Build an opportunity INSERT payload.
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} opts.serviceRequestId
 * @param {string} [opts.stage]           Default: "qualified"
 * @param {string} [opts.title]
 * @param {string} [opts.summary]
 * @param {object} [opts.metadata]
 * @param {string} [opts.appUserId]
 */
export function buildOpportunityPayload({
  organizationId,
  businessUnitId,
  serviceRequestId,
  stage,
  title,
  summary,
  metadata,
  appUserId,
}) {
  if (!organizationId) throw new Error("buildOpportunityPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildOpportunityPayload: businessUnitId required");
  if (!serviceRequestId) throw new Error("buildOpportunityPayload: serviceRequestId required");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    service_request_id: serviceRequestId,
    stage: stage ?? "qualified",
    close_reason: null,
    expected_close_date: null,
    probability_percent: null,
    title: title ?? null,
    summary: summary ?? null,
    metadata: metadata ?? null,
    created_by_app_user_id: appUserId ?? null,
    updated_by_app_user_id: appUserId ?? null,
  };
}

/**
 * Build an estimate INSERT payload.
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} opts.opportunityId
 * @param {string} [opts.lifecycleStatus]  Default: "prepared"
 * @param {number} [opts.versionNo]        Default: 1
 * @param {object} [opts.scopeSnapshot]    Quote inputs / scope details
 * @param {string} [opts.notes]
 * @param {object} [opts.metadata]
 * @param {string} [opts.appUserId]
 */
export function buildEstimatePayload({
  organizationId,
  businessUnitId,
  opportunityId,
  lifecycleStatus,
  versionNo,
  scopeSnapshot,
  notes,
  metadata,
  appUserId,
}) {
  if (!organizationId) throw new Error("buildEstimatePayload: organizationId required");
  if (!businessUnitId) throw new Error("buildEstimatePayload: businessUnitId required");
  if (!opportunityId) throw new Error("buildEstimatePayload: opportunityId required");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    opportunity_id: opportunityId,
    estimate_number: null,
    version_no: versionNo ?? 1,
    lifecycle_status: lifecycleStatus ?? "prepared",
    assumptions: null,
    scope_snapshot: scopeSnapshot ?? null,
    notes: notes ?? null,
    metadata: metadata ?? null,
    created_by_app_user_id: appUserId ?? null,
    updated_by_app_user_id: appUserId ?? null,
  };
}

/**
 * Build a quote INSERT payload.
 * NOTE: pricing_snapshot_id does NOT belong on quote — it belongs on quote_version.
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} opts.opportunityId
 * @param {string} [opts.estimateId]
 * @param {string} [opts.lifecycleStatus]  Default: "active"
 * @param {object} [opts.metadata]
 * @param {string} [opts.appUserId]
 */
export function buildQuotePayload({
  organizationId,
  businessUnitId,
  opportunityId,
  estimateId,
  lifecycleStatus,
  metadata,
  appUserId,
}) {
  if (!organizationId) throw new Error("buildQuotePayload: organizationId required");
  if (!businessUnitId) throw new Error("buildQuotePayload: businessUnitId required");
  if (!opportunityId) throw new Error("buildQuotePayload: opportunityId required");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    opportunity_id: opportunityId,
    estimate_id: estimateId ?? null,
    quote_number: null,
    lifecycle_status: lifecycleStatus ?? "active",
    customer_id: null,
    contact_id: null,
    service_location_id: null,
    metadata: metadata ?? null,
    created_by_app_user_id: appUserId ?? null,
    updated_by_app_user_id: appUserId ?? null,
  };
}

/**
 * Build a quote_version INSERT payload.
 * A new quote_version MUST begin with lifecycle_status = "draft".
 * Caller must UPDATE draft → sent → accepted via updateQuoteVersionStatus().
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} opts.quoteId
 * @param {string} opts.pricingSnapshotId
 * @param {number} [opts.versionNo]       Default: 1
 * @param {string} [opts.estimateId]
 * @param {object} [opts.lineItemsSnapshot]
 * @param {string} [opts.title]
 * @param {object} [opts.metadata]
 * @param {string} [opts.appUserId]
 */
export function buildQuoteVersionPayload({
  organizationId,
  businessUnitId,
  quoteId,
  pricingSnapshotId,
  versionNo,
  estimateId,
  lineItemsSnapshot,
  title,
  metadata,
  appUserId,
}) {
  if (!organizationId) throw new Error("buildQuoteVersionPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildQuoteVersionPayload: businessUnitId required");
  if (!quoteId) throw new Error("buildQuoteVersionPayload: quoteId required");
  if (!pricingSnapshotId) throw new Error("buildQuoteVersionPayload: pricingSnapshotId required");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    quote_id: quoteId,
    estimate_id: estimateId ?? null,
    pricing_snapshot_id: pricingSnapshotId,
    version_no: versionNo ?? 1,
    // MUST begin as draft — caller transitions via updateQuoteVersionStatus()
    lifecycle_status: "draft",
    valid_until: null,
    title: title ?? null,
    terms_text: null,
    line_items_snapshot: lineItemsSnapshot ?? null,
    commercial_snapshot: null,
    sent_at: null,
    metadata: metadata ?? null,
    created_by_app_user_id: appUserId ?? null,
    updated_by_app_user_id: appUserId ?? null,
  };
}

/**
 * Build a quote_response INSERT payload.
 * NOTE: There is NO quote_id field — the response links via quote_version_id.
 * The quote_version MUST be in "sent" status when inserting an accepted response.
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} opts.quoteVersionId
 * @param {"accepted"|"rejected"} opts.responseType
 * @param {string} [opts.responseChannel]   Default: "pilot_ui"
 * @param {string} [opts.respondedByName]
 * @param {string} [opts.respondedByEmail]
 * @param {string} [opts.notes]
 * @param {object} [opts.metadata]
 * @param {string} [opts.appUserId]
 */
export function buildQuoteResponsePayload({
  organizationId,
  businessUnitId,
  quoteVersionId,
  responseType,
  responseChannel,
  respondedByName,
  respondedByEmail,
  notes,
  metadata,
  appUserId,
}) {
  if (!organizationId) throw new Error("buildQuoteResponsePayload: organizationId required");
  if (!businessUnitId) throw new Error("buildQuoteResponsePayload: businessUnitId required");
  if (!quoteVersionId) throw new Error("buildQuoteResponsePayload: quoteVersionId required");
  if (responseType !== "accepted" && responseType !== "rejected") {
    throw new Error('buildQuoteResponsePayload: responseType must be "accepted" or "rejected"');
  }

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    quote_version_id: quoteVersionId,
    idempotency_key_id: null,
    response_type: responseType,
    response_channel: responseChannel ?? "pilot_ui",
    responded_by_name: respondedByName ?? null,
    responded_by_email: respondedByEmail ?? null,
    responded_at: new Date().toISOString(),
    notes: notes ?? null,
    metadata: metadata ?? null,
    created_by_app_user_id: appUserId ?? null,
  };
}

// ── Customer / Contact / Service Location conversion ──────────────────────────
//
// Conversion is EXPLICIT and CONSERVATIVE:
// - Never auto-converts a cold prospect
// - Customer, Contact, and Service Location are distinct Wave 1 entities
// - Customer deduplication is NOT done by email alone (email lives on Contact)
// - customer row does NOT carry email/phone — that belongs on Contact

/**
 * Build a customer INSERT payload using Wave 1 canonical field names.
 * Email/phone MUST NOT appear here — they live on Contact.
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} [opts.customerType]  Default: "person"
 * @param {string} [opts.displayName]
 * @param {string} [opts.legalName]
 * @param {object} [opts.metadata]      Carry pilot marker / source reference here
 */
export function buildCustomerPayload({
  organizationId,
  businessUnitId,
  customerType,
  displayName,
  legalName,
  metadata,
}) {
  if (!organizationId) throw new Error("buildCustomerPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildCustomerPayload: businessUnitId required");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    customer_type: customerType ?? "person",
    display_name: displayName ?? null,
    legal_name: legalName ?? null,
    status: "active",
    notes: null,
    metadata: metadata ?? null,
  };
}

/**
 * Build a contact INSERT payload using Wave 1 canonical field names.
 * Carries email/phone so Customer row stays clean.
 *
 * @param {object} opts
 * @param {string} opts.customerId   customer.id
 * @param {string} [opts.contactType]  Default: "primary"
 * @param {string} [opts.firstName]
 * @param {string} [opts.lastName]
 * @param {string} [opts.email]
 * @param {string} [opts.phone]
 * @param {object} [opts.metadata]
 */
export function buildContactPayload({
  customerId,
  contactType,
  firstName,
  lastName,
  email,
  phone,
  metadata,
}) {
  if (!customerId) throw new Error("buildContactPayload: customerId required");

  return {
    customer_id: customerId,
    contact_type: contactType ?? "primary",
    first_name: firstName ?? null,
    last_name: lastName ?? null,
    email: email ?? null,
    phone: phone ?? null,
    is_primary: true,
    metadata: metadata ?? null,
  };
}

/**
 * Build a service_location INSERT payload using Wave 1 canonical field names.
 * Uses jurisdiction_id (from live DB via revenueContext) — NOT region_id or province_state.
 * Does NOT carry business_unit_id (Wave 1 field structure).
 *
 * @param {object} opts
 * @param {string} opts.customerId
 * @param {string} opts.jurisdictionId    Canonical jurisdiction.id from business_unit (HUC-ON)
 * @param {string} [opts.label]
 * @param {string} [opts.addressLine1]
 * @param {string} [opts.addressLine2]
 * @param {string} [opts.city]
 * @param {string} [opts.subdivision]     Province/state code (e.g. "ON")
 * @param {string} [opts.postalCode]
 * @param {string} [opts.countryCode]     ISO 3166 code (e.g. "CA")
 * @param {string} [opts.accessNotes]
 * @param {object} [opts.metadata]
 */
export function buildServiceLocationPayload({
  customerId,
  jurisdictionId,
  label,
  addressLine1,
  addressLine2,
  city,
  subdivision,
  postalCode,
  countryCode,
  accessNotes,
  metadata,
}) {
  if (!customerId) throw new Error("buildServiceLocationPayload: customerId required");
  if (!jurisdictionId) throw new Error("buildServiceLocationPayload: jurisdictionId required");

  return {
    customer_id: customerId,
    jurisdiction_id: jurisdictionId,
    label: label ?? null,
    address_line1: addressLine1 ?? null,
    address_line2: addressLine2 ?? null,
    city: city ?? null,
    subdivision: subdivision ?? null,
    postal_code: postalCode ?? null,
    country_code: countryCode ?? null,
    access_notes: accessNotes ?? null,
    latitude: null,
    longitude: null,
    metadata: metadata ?? null,
  };
}

// ── Conversion record ─────────────────────────────────────────────────────────

/**
 * Build a conversion_record INSERT payload.
 * Represents the explicit moment a prospect converts to a customer.
 * Must be created AFTER accepted quote_response and BEFORE job_handoff.
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} opts.serviceRequestId
 * @param {string} opts.opportunityId
 * @param {string} opts.estimateId
 * @param {string} opts.quoteId
 * @param {string} opts.quoteVersionId
 * @param {string} opts.quoteResponseId
 * @param {string} opts.customerId
 * @param {string} opts.contactId
 * @param {string} opts.serviceLocationId
 * @param {object} [opts.metadata]
 * @param {string} [opts.appUserId]
 */
export function buildConversionRecordPayload({
  organizationId,
  businessUnitId,
  serviceRequestId,
  opportunityId,
  estimateId,
  quoteId,
  quoteVersionId,
  quoteResponseId,
  customerId,
  contactId,
  serviceLocationId,
  metadata,
  appUserId,
}) {
  if (!organizationId) throw new Error("buildConversionRecordPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildConversionRecordPayload: businessUnitId required");
  if (!serviceRequestId) throw new Error("buildConversionRecordPayload: serviceRequestId required");
  if (!opportunityId) throw new Error("buildConversionRecordPayload: opportunityId required");
  if (!estimateId) throw new Error("buildConversionRecordPayload: estimateId required");
  if (!quoteId) throw new Error("buildConversionRecordPayload: quoteId required");
  if (!quoteVersionId) throw new Error("buildConversionRecordPayload: quoteVersionId required");
  if (!quoteResponseId) throw new Error("buildConversionRecordPayload: quoteResponseId required");
  if (!customerId) throw new Error("buildConversionRecordPayload: customerId required");
  if (!contactId) throw new Error("buildConversionRecordPayload: contactId required");
  if (!serviceLocationId) throw new Error("buildConversionRecordPayload: serviceLocationId required");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    service_request_id: serviceRequestId,
    opportunity_id: opportunityId,
    estimate_id: estimateId,
    quote_id: quoteId,
    quote_version_id: quoteVersionId,
    quote_response_id: quoteResponseId,
    customer_id: customerId,
    contact_id: contactId,
    service_location_id: serviceLocationId,
    metadata: metadata ?? null,
    created_by_app_user_id: appUserId ?? null,
  };
}

// ── Job handoff (Wave 3 boundary) ─────────────────────────────────────────────

/**
 * Build a job_handoff INSERT payload.
 * This is ONLY the Wave 3 boundary marker — no scheduling or work orders.
 * Must be created AFTER conversion_record and reference it.
 * Does NOT carry top-level customer_id/contact_id/service_location_id — those
 * may be included inside handoff_payload if needed.
 *
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {string} opts.businessUnitId
 * @param {string} opts.conversionRecordId   conversion_record.id
 * @param {string} opts.quoteVersionId       Accepted quote version
 * @param {string} opts.pricingSnapshotId
 * @param {object} [opts.handoffPayload]     Arbitrary payload for Wave 3 (may include IDs)
 * @param {object} [opts.metadata]
 * @param {string} [opts.appUserId]
 */
export function buildJobHandoffPayload({
  organizationId,
  businessUnitId,
  conversionRecordId,
  quoteVersionId,
  pricingSnapshotId,
  handoffPayload,
  metadata,
  appUserId,
}) {
  if (!organizationId) throw new Error("buildJobHandoffPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildJobHandoffPayload: businessUnitId required");
  if (!conversionRecordId) throw new Error("buildJobHandoffPayload: conversionRecordId required");
  if (!quoteVersionId) throw new Error("buildJobHandoffPayload: quoteVersionId required");
  if (!pricingSnapshotId) throw new Error("buildJobHandoffPayload: pricingSnapshotId required");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    conversion_record_id: conversionRecordId,
    quote_version_id: quoteVersionId,
    pricing_snapshot_id: pricingSnapshotId,
    handoff_status: "ready",
    handoff_payload: handoffPayload ?? null,
    metadata: metadata ?? null,
    handed_off_at: new Date().toISOString(),
    created_by_app_user_id: appUserId ?? null,
  };
}
