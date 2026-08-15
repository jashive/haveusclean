// ── Wave 5: ServiceOS Finance Utility Builders ───────────────────────────────
//
// Pure payload builders with no side effects, no DB calls, no feature flags.
// All functions throw on invalid input (fail-closed).
//
// Wave 5 tables:
//   billing_readiness_gate
//   invoice_request
//   accounting_sync_outbox
//   payment_observation
//   contractor_compensation_version
//   contractor_payable
//   job_profitability_snapshot

// ─────────────────────────────────────────────────────────────────────────────
// A. Billing Readiness Gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a billing_readiness_gate payload.
 *
 * The gate captures the operational lineage and status at the moment
 * billing-readiness is assessed.
 */
export function buildBillingReadinessGatePayload({
  organizationId,
  businessUnitId,
  jurisdictionId = null,
  operationalJobId,
  workOrderId,
  operationalHandoffId = null,
  pricingSnapshotId,
  quoteVersionId,
  gateStatus = "pending",
  gateAssessment = {},
  blockingReasons = [],
  assessedAt = null,
  assessedByAppUserId = null,
  metadata = {},
  createdByAppUserId = null,
}) {
  if (!organizationId) throw new Error("buildBillingReadinessGatePayload: organizationId required");
  if (!businessUnitId) throw new Error("buildBillingReadinessGatePayload: businessUnitId required");
  if (!operationalJobId) throw new Error("buildBillingReadinessGatePayload: operationalJobId required");
  if (!workOrderId) throw new Error("buildBillingReadinessGatePayload: workOrderId required");
  if (!pricingSnapshotId) throw new Error("buildBillingReadinessGatePayload: pricingSnapshotId required");
  if (!quoteVersionId) throw new Error("buildBillingReadinessGatePayload: quoteVersionId required");

  const valid = ["pending", "ready", "blocked", "void"];
  if (!valid.includes(gateStatus)) {
    throw new Error(`buildBillingReadinessGatePayload: invalid gateStatus '${gateStatus}'`);
  }

  // A2: operational_handoff_id is required when gate_status = 'ready'
  if (gateStatus === "ready" && !operationalHandoffId) {
    throw new Error(
      "buildBillingReadinessGatePayload: operationalHandoffId is required when gateStatus is 'ready' — " +
      "the handoff is the canonical Wave 4 → Wave 5 boundary"
    );
  }

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    operational_handoff_id: operationalHandoffId,
    pricing_snapshot_id: pricingSnapshotId,
    quote_version_id: quoteVersionId,
    gate_status: gateStatus,
    gate_assessment: gateAssessment,
    blocking_reasons: blockingReasons,
    assessed_at: assessedAt,
    assessed_by_app_user_id: assessedByAppUserId,
    metadata,
    created_by_app_user_id: createdByAppUserId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// B. Invoice Request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an invoice_request payload.
 *
 * Monetary fields are frozen from the accepted pricing snapshot.
 * Do NOT recalculate prices here.
 */
export function buildInvoiceRequestPayload({
  organizationId,
  businessUnitId,
  jurisdictionId = null,
  billingReadinessGateId,
  operationalJobId,
  workOrderId,
  operationalHandoffId = null,
  customerId = null,
  serviceLocationId = null,
  pricingSnapshotId,
  quoteVersionId,
  quoteResponseId = null,
  conversionRecordId = null,
  currencyCode,
  subtotalAmount,
  taxAmount,
  totalAmount,
  taxName = null,
  taxRate = null,
  financialSnapshot = {},
  accountingProvider = null,
  metadata = {},
  createdByAppUserId = null,
}) {
  if (!organizationId) throw new Error("buildInvoiceRequestPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildInvoiceRequestPayload: businessUnitId required");
  if (!billingReadinessGateId) throw new Error("buildInvoiceRequestPayload: billingReadinessGateId required");
  if (!operationalJobId) throw new Error("buildInvoiceRequestPayload: operationalJobId required");
  if (!workOrderId) throw new Error("buildInvoiceRequestPayload: workOrderId required");
  if (!pricingSnapshotId) throw new Error("buildInvoiceRequestPayload: pricingSnapshotId required");
  if (!quoteVersionId) throw new Error("buildInvoiceRequestPayload: quoteVersionId required");
  if (!currencyCode || !String(currencyCode).trim()) throw new Error("buildInvoiceRequestPayload: currencyCode required");

  const sub = Number(subtotalAmount);
  const tax = Number(taxAmount);
  const tot = Number(totalAmount);

  if (!Number.isFinite(sub) || sub < 0) throw new Error("buildInvoiceRequestPayload: subtotalAmount must be non-negative number");
  if (!Number.isFinite(tax) || tax < 0) throw new Error("buildInvoiceRequestPayload: taxAmount must be non-negative number");
  if (!Number.isFinite(tot) || tot < 0) throw new Error("buildInvoiceRequestPayload: totalAmount must be non-negative number");

  // Coherence check: total = subtotal + tax (within 1 cent rounding tolerance)
  if (Math.abs(tot - (sub + tax)) > 0.015) {
    throw new Error(
      `buildInvoiceRequestPayload: totalAmount (${tot}) must equal subtotalAmount (${sub}) + taxAmount (${tax})`
    );
  }

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    billing_readiness_gate_id: billingReadinessGateId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    operational_handoff_id: operationalHandoffId,
    customer_id: customerId,
    service_location_id: serviceLocationId,
    pricing_snapshot_id: pricingSnapshotId,
    quote_version_id: quoteVersionId,
    quote_response_id: quoteResponseId,
    conversion_record_id: conversionRecordId,
    currency_code: String(currencyCode).trim().toUpperCase(),
    subtotal_amount: sub,
    tax_amount: tax,
    total_amount: tot,
    tax_name: taxName,
    tax_rate: taxRate,
    financial_snapshot: financialSnapshot,
    request_status: "draft",
    accounting_provider: accountingProvider,
    metadata,
    created_by_app_user_id: createdByAppUserId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// C. Accounting Sync Outbox
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an accounting_sync_outbox payload.
 *
 * idempotencyKey must be a deterministic stable key (e.g. `ir-${invoiceRequestId}-v1`).
 * is_test_adapter must be explicitly set to true for any test/preview run.
 */
export function buildAccountingSyncOutboxPayload({
  organizationId,
  businessUnitId,
  invoiceRequestId,
  idempotencyKey,
  provider = "quickbooks",
  requestPayload = {},
  isTestAdapter = false,
  metadata = {},
  createdByAppUserId = null,
}) {
  if (!organizationId) throw new Error("buildAccountingSyncOutboxPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildAccountingSyncOutboxPayload: businessUnitId required");
  if (!invoiceRequestId) throw new Error("buildAccountingSyncOutboxPayload: invoiceRequestId required");
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new Error("buildAccountingSyncOutboxPayload: idempotencyKey must be nonblank");
  }

  const validProviders = ["quickbooks", "preview_test"];
  if (!validProviders.includes(provider)) {
    throw new Error(`buildAccountingSyncOutboxPayload: invalid provider '${provider}'`);
  }

  if (provider === "preview_test" && !isTestAdapter) {
    throw new Error(
      "buildAccountingSyncOutboxPayload: provider=preview_test requires isTestAdapter=true"
    );
  }

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    invoice_request_id: invoiceRequestId,
    idempotency_key: String(idempotencyKey).trim(),
    provider,
    outbox_status: "pending",
    request_payload: requestPayload,
    response_payload: null,
    provider_reference_id: null,
    provider_reference_type: null,
    attempt_count: 0,
    last_attempted_at: null,
    acknowledged_at: null,
    is_test_adapter: Boolean(isTestAdapter),
    metadata,
    created_by_app_user_id: createdByAppUserId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// D. Payment Observation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a payment_observation payload.
 *
 * providerEventId must be the canonical immutable event identifier from the provider
 * (e.g. Stripe checkout.session.completed session id).
 * The UNIQUE constraint (provider, providerEventId) prevents duplicate observations.
 */
export function buildPaymentObservationPayload({
  organizationId,
  businessUnitId,
  invoiceRequestId,
  accountingSyncOutboxId = null,
  provider,
  providerEventId,
  providerEventType,
  providerReferenceId = null,
  currencyCode,
  amountObserved,
  eventPayloadSnapshot = {},
  observedAt,
  settledAt = null,
  isTestProvider = false,
  metadata = {},
  createdByAppUserId = null,
}) {
  if (!organizationId) throw new Error("buildPaymentObservationPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildPaymentObservationPayload: businessUnitId required");
  if (!invoiceRequestId) throw new Error("buildPaymentObservationPayload: invoiceRequestId required");
  if (!provider || !String(provider).trim()) throw new Error("buildPaymentObservationPayload: provider required");
  if (!providerEventId || !String(providerEventId).trim()) throw new Error("buildPaymentObservationPayload: providerEventId required");
  if (!providerEventType || !String(providerEventType).trim()) throw new Error("buildPaymentObservationPayload: providerEventType required");
  if (!currencyCode || !String(currencyCode).trim()) throw new Error("buildPaymentObservationPayload: currencyCode required");
  if (!observedAt) throw new Error("buildPaymentObservationPayload: observedAt required");

  const amount = Number(amountObserved);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("buildPaymentObservationPayload: amountObserved must be non-negative number");
  }

  const validProviders = ["stripe", "manual", "preview_test"];
  if (!validProviders.includes(provider)) {
    throw new Error(`buildPaymentObservationPayload: invalid provider '${provider}'`);
  }

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    invoice_request_id: invoiceRequestId,
    accounting_sync_outbox_id: accountingSyncOutboxId,
    provider,
    provider_event_id: String(providerEventId).trim(),
    provider_event_type: String(providerEventType).trim(),
    provider_reference_id: providerReferenceId,
    currency_code: String(currencyCode).trim().toUpperCase(),
    amount_observed: amount,
    payment_status: "observed",
    event_payload_snapshot: eventPayloadSnapshot,
    observed_at: observedAt,
    settled_at: settledAt,
    is_test_provider: Boolean(isTestProvider),
    metadata,
    created_by_app_user_id: createdByAppUserId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// E. Contractor Compensation Version
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a contractor_compensation_version payload.
 *
 * For percentage method: rateValue must be in [0, 1] (e.g. 0.40 = 40%).
 * Historical rows become immutable once status reaches approved/active.
 */
export function buildContractorCompensationVersionPayload({
  organizationId,
  businessUnitId,
  workerId,
  serviceFamily = null,
  serviceModuleKey = null,
  version,
  compensationMethod,
  currencyCode = "CAD",
  rateValue,
  effectiveFrom,
  effectiveTo = null,
  governanceReferenceSnapshot = {},
  metadata = {},
  createdByAppUserId = null,
}) {
  if (!organizationId) throw new Error("buildContractorCompensationVersionPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildContractorCompensationVersionPayload: businessUnitId required");
  if (!workerId) throw new Error("buildContractorCompensationVersionPayload: workerId required");
  if (!version || !String(version).trim()) throw new Error("buildContractorCompensationVersionPayload: version required");
  if (!effectiveFrom) throw new Error("buildContractorCompensationVersionPayload: effectiveFrom required");

  const validMethods = ["flat_amount", "hourly", "percentage"];
  if (!validMethods.includes(compensationMethod)) {
    throw new Error(`buildContractorCompensationVersionPayload: invalid compensationMethod '${compensationMethod}'`);
  }

  const rate = Number(rateValue);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error("buildContractorCompensationVersionPayload: rateValue must be non-negative number");
  }
  if (compensationMethod === "percentage" && rate > 1) {
    throw new Error(
      "buildContractorCompensationVersionPayload: percentage rateValue must be in [0, 1] (e.g. 0.40 for 40%)"
    );
  }

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    worker_id: workerId,
    service_family: serviceFamily,
    service_module_key: serviceModuleKey,
    version: String(version).trim(),
    compensation_method: compensationMethod,
    currency_code: String(currencyCode).trim().toUpperCase(),
    rate_value: rate,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    compensation_status: "draft",
    approved_by_app_user_id: null,
    approved_at: null,
    governance_reference_snapshot: governanceReferenceSnapshot,
    metadata,
    created_by_app_user_id: createdByAppUserId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// F. Contractor Payable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a contractor_payable payload.
 *
 * computedAmount is calculated from the frozen compensation version.
 * Eligibility must have been assessed before calling.
 * Worker approving their own payable is blocked by a DB trigger.
 */
export function buildContractorPayablePayload({
  organizationId,
  businessUnitId,
  workerId,
  workerAssignmentId,
  operationalJobId,
  workOrderId,
  contractorCompensationVersionId,
  compensationMethod,
  currencyCode,
  basisValue,
  computedAmount,
  eligibilityAssessment = {},
  eligibilityPassed,
  metadata = {},
  createdByAppUserId = null,
}) {
  if (!organizationId) throw new Error("buildContractorPayablePayload: organizationId required");
  if (!businessUnitId) throw new Error("buildContractorPayablePayload: businessUnitId required");
  if (!workerId) throw new Error("buildContractorPayablePayload: workerId required");
  if (!workerAssignmentId) throw new Error("buildContractorPayablePayload: workerAssignmentId required");
  if (!operationalJobId) throw new Error("buildContractorPayablePayload: operationalJobId required");
  if (!workOrderId) throw new Error("buildContractorPayablePayload: workOrderId required");
  if (!contractorCompensationVersionId) throw new Error("buildContractorPayablePayload: contractorCompensationVersionId required");

  const validMethods = ["flat_amount", "hourly", "percentage"];
  if (!validMethods.includes(compensationMethod)) {
    throw new Error(`buildContractorPayablePayload: invalid compensationMethod '${compensationMethod}'`);
  }

  const basis = Number(basisValue);
  const computed = Number(computedAmount);

  if (!Number.isFinite(basis) || basis < 0) throw new Error("buildContractorPayablePayload: basisValue must be non-negative");
  if (!Number.isFinite(computed) || computed < 0) throw new Error("buildContractorPayablePayload: computedAmount must be non-negative");
  if (typeof eligibilityPassed !== "boolean") throw new Error("buildContractorPayablePayload: eligibilityPassed must be boolean");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    worker_id: workerId,
    worker_assignment_id: workerAssignmentId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    contractor_compensation_version_id: contractorCompensationVersionId,
    compensation_method: compensationMethod,
    currency_code: String(currencyCode).trim().toUpperCase(),
    basis_value: basis,
    computed_amount: computed,
    payable_status: "pending",
    eligibility_assessment: eligibilityAssessment,
    eligibility_passed: eligibilityPassed,
    approved_by_app_user_id: null,
    approved_at: null,
    metadata,
    created_by_app_user_id: createdByAppUserId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// G. Job Profitability Snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a job_profitability_snapshot payload.
 *
 * recognizedRevenueAmount = accepted pricing subtotal (excl. tax).
 * Do NOT recalculate from pricing here; pass the frozen accepted value.
 * gross_contribution is a GENERATED STORED column in DB.
 * grossMarginPercent is computed here as a preview/client-side value;
 * the DB trigger overrides it with the authoritative computation.
 */
export function buildJobProfitabilitySnapshotPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  invoiceRequestId = null,
  currencyCode,
  recognizedRevenueAmount,
  taxAmount,
  directLaborCost = 0,
  otherDirectCost = 0,
  sourceLineage = {},
  metadata = {},
  createdByAppUserId = null,
}) {
  if (!organizationId) throw new Error("buildJobProfitabilitySnapshotPayload: organizationId required");
  if (!businessUnitId) throw new Error("buildJobProfitabilitySnapshotPayload: businessUnitId required");
  if (!operationalJobId) throw new Error("buildJobProfitabilitySnapshotPayload: operationalJobId required");
  if (!currencyCode || !String(currencyCode).trim()) throw new Error("buildJobProfitabilitySnapshotPayload: currencyCode required");

  const rev = Number(recognizedRevenueAmount);
  const tax = Number(taxAmount);
  const labor = Number(directLaborCost);
  const other = Number(otherDirectCost);

  if (!Number.isFinite(rev) || rev < 0) throw new Error("buildJobProfitabilitySnapshotPayload: recognizedRevenueAmount must be non-negative");
  if (!Number.isFinite(tax) || tax < 0) throw new Error("buildJobProfitabilitySnapshotPayload: taxAmount must be non-negative");
  if (!Number.isFinite(labor) || labor < 0) throw new Error("buildJobProfitabilitySnapshotPayload: directLaborCost must be non-negative");
  if (!Number.isFinite(other) || other < 0) throw new Error("buildJobProfitabilitySnapshotPayload: otherDirectCost must be non-negative");

  // Client-side margin preview (DB trigger computes authoritatively)
  const grossContribution = rev - labor - other;
  const grossMarginPercent = rev === 0 ? null : Number((grossContribution / rev).toFixed(4));

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    invoice_request_id: invoiceRequestId,
    currency_code: String(currencyCode).trim().toUpperCase(),
    recognized_revenue_amount: rev,
    tax_amount: tax,
    direct_labor_cost: labor,
    other_direct_cost: other,
    // gross_contribution is GENERATED in DB; include client-side preview for display
    gross_contribution_preview: grossContribution,
    gross_margin_percent: grossMarginPercent,
    source_lineage: sourceLineage,
    snapshot_taken_at: new Date().toISOString(),
    metadata,
    created_by_app_user_id: createdByAppUserId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// H. Compensation Computation Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute contractor payable amount from a frozen compensation version.
 *
 * @param {object} compensationVersion – { compensation_method, rate_value }
 * @param {number} basisValue          – hours worked, or job revenue (for percentage)
 * @returns {number} computed amount (rounded to 2 decimal places)
 */
export function computeContractorPayable(compensationVersion, basisValue) {
  if (!compensationVersion || !compensationVersion.compensation_method) {
    throw new Error("computeContractorPayable: compensationVersion with compensation_method required");
  }

  const rate = Number(compensationVersion.rate_value);
  const basis = Number(basisValue);

  if (!Number.isFinite(rate) || rate < 0) throw new Error("computeContractorPayable: rate_value must be non-negative");
  if (!Number.isFinite(basis) || basis < 0) throw new Error("computeContractorPayable: basisValue must be non-negative");

  let amount;
  switch (compensationVersion.compensation_method) {
    case "flat_amount":
      amount = rate;
      break;
    case "hourly":
      amount = rate * basis;
      break;
    case "percentage":
      if (rate > 1) throw new Error("computeContractorPayable: percentage rate must be in [0, 1]");
      amount = rate * basis;
      break;
    default:
      throw new Error(`computeContractorPayable: unknown compensation_method '${compensationVersion.compensation_method}'`);
  }

  return Math.round(amount * 100) / 100;
}

/**
 * Assess payable eligibility for a worker assignment.
 * Fails closed if required operational conditions are not satisfied.
 *
 * Returns { passed: boolean, reasons: string[] }.
 */
export function assessPayableEligibility({
  workerAssignment,
  operationalJob,
  workOrder,
}) {
  const reasons = [];

  if (!workerAssignment || !workerAssignment.id) {
    reasons.push("worker_assignment not provided");
  } else {
    if (!["acknowledged", "completed"].includes(workerAssignment.assignment_status)) {
      reasons.push(`worker_assignment status must be acknowledged or completed (is: ${workerAssignment.assignment_status})`);
    }
    if (!workerAssignment.assigned_at) {
      reasons.push("worker_assignment.assigned_at must be set");
    }
    if (!workerAssignment.acknowledged_at) {
      reasons.push("worker_assignment.acknowledged_at must be set");
    }
  }

  if (!operationalJob || !operationalJob.id) {
    reasons.push("operational_job not provided");
  } else {
    const eligibleJobStatuses = ["service_complete", "qa_pending", "qa_passed", "closed"];
    if (!eligibleJobStatuses.includes(operationalJob.operational_status)) {
      reasons.push(`operational_job status must be service_complete, qa_pending, qa_passed, or closed (is: ${operationalJob.operational_status})`);
    }
  }

  if (!workOrder || !workOrder.id) {
    reasons.push("work_order not provided");
  } else {
    const eligibleWoStatuses = ["service_complete", "qa_complete", "closed"];
    if (!eligibleWoStatuses.includes(workOrder.work_order_status)) {
      reasons.push(`work_order status must be service_complete, qa_complete, or closed (is: ${workOrder.work_order_status})`);
    }
  }

  const passed = reasons.length === 0;
  return { passed, reasons };
}
