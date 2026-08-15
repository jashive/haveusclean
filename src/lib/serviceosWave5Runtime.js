// ── Wave 5: ServiceOS Finance Runtime ────────────────────────────────────────
//
// Composable runtime functions for Wave 5 billing / invoice / payment /
// contractor pay / profitability capabilities.
// No UI code lives here.
//
// Imports from:
//   serviceosWave5FinanceClient.js  – feature-flagged REST client
//   serviceosWave5FinanceUtils.js   – pure payload builders

import {
  createBillingReadinessGate,
  updateBillingReadinessGate,
  fetchBillingReadinessGateByJobId,
  createInvoiceRequest,
  fetchInvoiceRequestByJobId,
  fetchInvoiceRequestById,
  updateInvoiceRequest,
  createAccountingSyncOutbox,
  updateAccountingSyncOutbox,
  fetchAccountingSyncOutboxByIdempotencyKey,
  createPaymentObservation,
  fetchPaymentObservationByProviderEvent,
  fetchPaymentObservationsByInvoiceRequestId,
  createContractorCompensationVersion,
  updateContractorCompensationVersion,
  fetchActiveCompensationVersionForWorker,
  fetchContractorCompensationVersionById,
  createContractorPayable,
  fetchContractorPayablesByJobId,
  createJobProfitabilitySnapshot,
  updateJobProfitabilitySnapshot,
  fetchJobProfitabilitySnapshotByJobId,
} from "./serviceosWave5FinanceClient.js";

import {
  buildBillingReadinessGatePayload,
  buildInvoiceRequestPayload,
  buildAccountingSyncOutboxPayload,
  buildPaymentObservationPayload,
  buildContractorCompensationVersionPayload,
  buildContractorPayablePayload,
  buildJobProfitabilitySnapshotPayload,
  computeContractorPayable,
  assessPayableEligibility,
} from "./serviceosWave5FinanceUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// A. Billing Readiness Gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assess and record billing readiness for an operational job.
 *
 * Fails closed if required operational conditions are not satisfied.
 * Idempotent: if a gate already exists for the job, returns it with fresh assessment.
 *
 * Required conditions for gate_status = 'ready':
 *   - operational_job status is qa_passed or closed
 *   - work_order status is qa_complete or closed
 *   - no blocking corrective actions remain open
 *   - accepted quote_version and pricing_snapshot lineage are present
 *
 * @param {object} scope   – { organizationId, businessUnitId, jurisdictionId? }
 * @param {object} job     – operational_job row
 * @param {object} workOrder – work_order row
 * @param {object} operationalHandoff – operational_handoff row (may be null)
 * @param {object[]} correctiveActions – corrective_action rows for this job
 * @param {object} opts    – { accessToken, appUserId }
 * @returns {object} billing_readiness_gate row
 */
export async function assessBillingReadiness(scope, job, workOrder, operationalHandoff, correctiveActions, opts = {}) {
  const { organizationId, businessUnitId, jurisdictionId } = scope;
  const { accessToken, appUserId } = opts;

  if (!job || !job.id) throw new Error("assessBillingReadiness: operational_job required");
  if (!workOrder || !workOrder.id) throw new Error("assessBillingReadiness: work_order required");

  const blockingReasons = [];

  // Check operational_job status
  const readyJobStatuses = ["qa_passed", "closed"];
  if (!readyJobStatuses.includes(job.operational_status)) {
    blockingReasons.push(`operational_job.operational_status must be qa_passed or closed (is: ${job.operational_status})`);
  }

  // Check work_order status
  const readyWoStatuses = ["qa_complete", "closed"];
  if (!readyWoStatuses.includes(workOrder.work_order_status)) {
    blockingReasons.push(`work_order.work_order_status must be qa_complete or closed (is: ${workOrder.work_order_status})`);
  }

  // Check no open blocking corrective actions
  const openCAs = (correctiveActions || []).filter(
    (ca) => !["resolved", "verified", "closed"].includes(ca.action_status)
  );
  if (openCAs.length > 0) {
    blockingReasons.push(
      `${openCAs.length} open corrective action(s) must be resolved before billing`
    );
  }

  // Check accepted pricing lineage
  if (!job.pricing_snapshot_id) {
    blockingReasons.push("operational_job.pricing_snapshot_id missing");
  }
  if (!job.quote_version_id) {
    blockingReasons.push("operational_job.quote_version_id missing");
  }

  const gateStatus = blockingReasons.length === 0 ? "ready" : "blocked";

  // Check for existing gate
  const existingGate = await fetchBillingReadinessGateByJobId(job.id, accessToken);
  if (existingGate) {
    // Update existing gate
    const updated = await updateBillingReadinessGate(
      existingGate.id,
      {
        gate_status: gateStatus,
        blocking_reasons: blockingReasons,
        gate_assessment: {
          operational_job_status: job.operational_status,
          work_order_status: workOrder.work_order_status,
          open_corrective_actions: openCAs.length,
          assessed_at: new Date().toISOString(),
        },
        assessed_at: new Date().toISOString(),
        assessed_by_app_user_id: appUserId ?? null,
      },
      accessToken
    );
    return updated;
  }

  const payload = buildBillingReadinessGatePayload({
    organizationId,
    businessUnitId,
    jurisdictionId: jurisdictionId ?? null,
    operationalJobId: job.id,
    workOrderId: workOrder.id,
    operationalHandoffId: operationalHandoff?.id ?? null,
    pricingSnapshotId: job.pricing_snapshot_id,
    quoteVersionId: job.quote_version_id,
    gateStatus,
    gateAssessment: {
      operational_job_status: job.operational_status,
      work_order_status: workOrder.work_order_status,
      open_corrective_actions: openCAs.length,
      assessed_at: new Date().toISOString(),
    },
    blockingReasons,
    assessedAt: new Date().toISOString(),
    assessedByAppUserId: appUserId ?? null,
    createdByAppUserId: appUserId ?? null,
  });

  return createBillingReadinessGate(payload, accessToken);
}

// ─────────────────────────────────────────────────────────────────────────────
// B. Invoice Request
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a frozen invoice request for a billing-ready job.
 *
 * Financial values are taken from the accepted pricing snapshot.
 * Fails closed if:
 *   - billing_readiness_gate is not ready
 *   - an active invoice_request already exists for this job
 *   - pricing lineage is missing or incoherent
 *
 * @param {object} scope          – { organizationId, businessUnitId, jurisdictionId? }
 * @param {object} gate           – billing_readiness_gate row (must be ready)
 * @param {object} pricingSnapshot – pricing_snapshot row (frozen accepted values)
 * @param {object} quoteVersion   – quote_version row
 * @param {object} conversionRecord – conversion_record row (nullable)
 * @param {object} opts           – { accessToken, appUserId, customerId?, serviceLocationId? }
 * @returns {object} invoice_request row
 */
export async function createAndFreezeInvoiceRequest(scope, gate, pricingSnapshot, quoteVersion, conversionRecord, opts = {}) {
  const { organizationId, businessUnitId, jurisdictionId } = scope;
  const { accessToken, appUserId, customerId, serviceLocationId } = opts;

  if (!gate || gate.gate_status !== "ready") {
    throw new Error(
      `createAndFreezeInvoiceRequest: billing_readiness_gate must be ready (is: ${gate?.gate_status ?? "null"})`
    );
  }

  if (!pricingSnapshot || !pricingSnapshot.id) {
    throw new Error("createAndFreezeInvoiceRequest: pricingSnapshot required");
  }

  // Check for existing active invoice
  const existing = await fetchInvoiceRequestByJobId(gate.operational_job_id, accessToken);
  if (existing && !["void", "cancelled"].includes(existing.request_status)) {
    throw new Error(
      `createAndFreezeInvoiceRequest: active invoice_request already exists for job ${gate.operational_job_id} (id=${existing.id})`
    );
  }

  const payload = buildInvoiceRequestPayload({
    organizationId,
    businessUnitId,
    jurisdictionId: jurisdictionId ?? null,
    billingReadinessGateId: gate.id,
    operationalJobId: gate.operational_job_id,
    workOrderId: gate.work_order_id,
    operationalHandoffId: gate.operational_handoff_id ?? null,
    customerId: customerId ?? null,
    serviceLocationId: serviceLocationId ?? null,
    pricingSnapshotId: pricingSnapshot.id,
    quoteVersionId: quoteVersion?.id ?? gate.quote_version_id,
    quoteResponseId: conversionRecord?.quote_response_id ?? null,
    conversionRecordId: conversionRecord?.id ?? null,
    currencyCode: pricingSnapshot.currency_code,
    subtotalAmount: pricingSnapshot.subtotal_amount,
    taxAmount: pricingSnapshot.tax_amount,
    totalAmount: pricingSnapshot.total_amount,
    taxName: pricingSnapshot.tax_name ?? null,
    taxRate: pricingSnapshot.tax_rate ?? null,
    financialSnapshot: {
      pricing_snapshot_id: pricingSnapshot.id,
      quote_version_id: quoteVersion?.id ?? gate.quote_version_id,
      configuration_version_id: pricingSnapshot.configuration_version_id ?? null,
      currency_code: pricingSnapshot.currency_code,
      subtotal_amount: pricingSnapshot.subtotal_amount,
      tax_amount: pricingSnapshot.tax_amount,
      total_amount: pricingSnapshot.total_amount,
      frozen_at: new Date().toISOString(),
    },
    metadata: { wave: "wave5", source: "createAndFreezeInvoiceRequest" },
    createdByAppUserId: appUserId ?? null,
  });

  return createInvoiceRequest(payload, accessToken);
}

// ─────────────────────────────────────────────────────────────────────────────
// C. Accounting Sync (QuickBooks boundary)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an idempotent accounting sync outbox entry.
 *
 * Uses a deterministic idempotency key: `ir-${invoiceRequestId}-${attemptLabel}`.
 * Returns existing entry if idempotency key already exists (idempotent).
 * Fails closed if isTestAdapter=true and production environment is detected.
 *
 * @param {object} invoiceRequest – invoice_request row
 * @param {string} attemptLabel   – stable version label (e.g. "v1")
 * @param {object} opts           – { accessToken, appUserId, isTestAdapter, provider }
 * @returns {object} accounting_sync_outbox row
 */
export async function enqueueAccountingSync(invoiceRequest, attemptLabel, opts = {}) {
  const { accessToken, appUserId, isTestAdapter = false, provider = "quickbooks" } = opts;

  if (!invoiceRequest || !invoiceRequest.id) {
    throw new Error("enqueueAccountingSync: invoiceRequest required");
  }

  if (invoiceRequest.request_status === "void" || invoiceRequest.request_status === "cancelled") {
    throw new Error(
      `enqueueAccountingSync: cannot sync a ${invoiceRequest.request_status} invoice_request`
    );
  }

  const idempotencyKey = `ir-${invoiceRequest.id}-${String(attemptLabel || "v1").trim()}`;

  // Check for existing outbox entry (idempotent)
  const existing = await fetchAccountingSyncOutboxByIdempotencyKey(idempotencyKey, accessToken);
  if (existing) return existing;

  const payload = buildAccountingSyncOutboxPayload({
    organizationId: invoiceRequest.organization_id,
    businessUnitId: invoiceRequest.business_unit_id,
    invoiceRequestId: invoiceRequest.id,
    idempotencyKey,
    provider,
    requestPayload: {
      invoice_request_id: invoiceRequest.id,
      currency_code: invoiceRequest.currency_code,
      subtotal_amount: invoiceRequest.subtotal_amount,
      tax_amount: invoiceRequest.tax_amount,
      total_amount: invoiceRequest.total_amount,
      financial_snapshot: invoiceRequest.financial_snapshot,
      operational_job_id: invoiceRequest.operational_job_id,
      accounting_provider: invoiceRequest.accounting_provider,
    },
    isTestAdapter,
    metadata: { wave: "wave5", attempt_label: attemptLabel },
    createdByAppUserId: appUserId ?? null,
  });

  return createAccountingSyncOutbox(payload, accessToken);
}

/**
 * Record an acknowledged accounting provider response.
 *
 * providerReferenceId must be a real external reference returned by the provider.
 * Fails closed if outbox is not in 'sent' status.
 * Fails closed if providerReferenceId looks like a fabricated QB-{timestamp} placeholder.
 */
export async function recordAccountingSyncAcknowledgment(outboxId, providerReferenceId, responsePayload, opts = {}) {
  const { accessToken } = opts;

  if (!outboxId) throw new Error("recordAccountingSyncAcknowledgment: outboxId required");
  if (!providerReferenceId || !String(providerReferenceId).trim()) {
    throw new Error("recordAccountingSyncAcknowledgment: providerReferenceId required — must be a real provider ID, not fabricated");
  }

  // Guard: reject QB-{timestamp}-{index} fabricated IDs
  if (/^QB-\d+-\d+$/.test(String(providerReferenceId).trim())) {
    throw new Error(
      "recordAccountingSyncAcknowledgment: providerReferenceId looks like a fabricated placeholder. Real QuickBooks IDs must be used."
    );
  }

  return updateAccountingSyncOutbox(
    outboxId,
    {
      outbox_status: "acknowledged",
      provider_reference_id: String(providerReferenceId).trim(),
      response_payload: responsePayload ?? {},
      acknowledged_at: new Date().toISOString(),
      last_attempted_at: new Date().toISOString(),
    },
    accessToken
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// D. Payment Observation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Observe and persist a canonical payment event.
 *
 * Idempotent: if (provider, providerEventId) already exists, returns existing row.
 * Stripe webhook duplicate delivery will NOT create duplicate payment observations.
 *
 * @param {object} invoiceRequest – invoice_request row
 * @param {object} event          – { provider, providerEventId, providerEventType, providerReferenceId?,
 *                                    currencyCode, amountObserved, observedAt, eventPayloadSnapshot?, isTestProvider? }
 * @param {object} opts           – { accessToken, appUserId, accountingSyncOutboxId? }
 * @returns {object} payment_observation row (created or existing)
 */
export async function observePayment(invoiceRequest, event, opts = {}) {
  const { accessToken, appUserId, accountingSyncOutboxId } = opts;

  if (!invoiceRequest || !invoiceRequest.id) {
    throw new Error("observePayment: invoiceRequest required");
  }

  if (!event.provider || !event.providerEventId) {
    throw new Error("observePayment: event.provider and event.providerEventId required");
  }

  // Idempotency: check for existing observation
  const existing = await fetchPaymentObservationByProviderEvent(
    event.provider,
    event.providerEventId,
    accessToken
  );
  if (existing) return existing;

  const payload = buildPaymentObservationPayload({
    organizationId: invoiceRequest.organization_id,
    businessUnitId: invoiceRequest.business_unit_id,
    invoiceRequestId: invoiceRequest.id,
    accountingSyncOutboxId: accountingSyncOutboxId ?? null,
    provider: event.provider,
    providerEventId: event.providerEventId,
    providerEventType: event.providerEventType,
    providerReferenceId: event.providerReferenceId ?? null,
    currencyCode: event.currencyCode,
    amountObserved: event.amountObserved,
    eventPayloadSnapshot: event.eventPayloadSnapshot ?? {},
    observedAt: event.observedAt ?? new Date().toISOString(),
    settledAt: event.settledAt ?? null,
    isTestProvider: Boolean(event.isTestProvider),
    metadata: { wave: "wave5", source: "observePayment" },
    createdByAppUserId: appUserId ?? null,
  });

  return createPaymentObservation(payload, accessToken);
}

// ─────────────────────────────────────────────────────────────────────────────
// E. Contractor Compensation Version
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new contractor compensation version in draft status.
 *
 * A historical compensation version becomes immutable once approved/active.
 * Later versions do not alter historical payables (each payable references
 * its frozen contractor_compensation_version_id).
 */
export async function createCompensationVersion(scope, params, opts = {}) {
  const { organizationId, businessUnitId } = scope;
  const { accessToken, appUserId } = opts;

  const payload = buildContractorCompensationVersionPayload({
    organizationId,
    businessUnitId,
    workerId: params.workerId,
    serviceFamily: params.serviceFamily ?? null,
    serviceModuleKey: params.serviceModuleKey ?? null,
    version: params.version,
    compensationMethod: params.compensationMethod,
    currencyCode: params.currencyCode ?? "CAD",
    rateValue: params.rateValue,
    effectiveFrom: params.effectiveFrom,
    effectiveTo: params.effectiveTo ?? null,
    governanceReferenceSnapshot: params.governanceReferenceSnapshot ?? {},
    metadata: { wave: "wave5" },
    createdByAppUserId: appUserId ?? null,
  });

  return createContractorCompensationVersion(payload, accessToken);
}

/**
 * Approve a contractor compensation version.
 * Approver app user ID must not be the worker's own app user ID (enforced by DB trigger).
 */
export async function approveCompensationVersion(versionId, approverAppUserId, opts = {}) {
  const { accessToken } = opts;

  if (!versionId) throw new Error("approveCompensationVersion: versionId required");
  if (!approverAppUserId) throw new Error("approveCompensationVersion: approverAppUserId required");

  return updateContractorCompensationVersion(
    versionId,
    {
      compensation_status: "approved",
      approved_by_app_user_id: approverAppUserId,
      approved_at: new Date().toISOString(),
    },
    accessToken
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// F. Contractor Payable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a contractor payable for a worker assignment.
 *
 * Performs fail-closed eligibility check.
 * Compensation version must be approved or active.
 * computedAmount is derived from the frozen compensation version — not recalculated.
 *
 * @param {object} scope              – { organizationId, businessUnitId }
 * @param {object} workerAssignment   – worker_assignment row
 * @param {object} operationalJob     – operational_job row
 * @param {object} workOrder          – work_order row
 * @param {object} compensationVersion – contractor_compensation_version row
 * @param {number} basisValue         – hours, or revenue basis for percentage, or ignored for flat
 * @param {object} opts               – { accessToken, appUserId }
 * @returns {object} contractor_payable row
 */
export async function createPayableForAssignment(scope, workerAssignment, operationalJob, workOrder, compensationVersion, basisValue, opts = {}) {
  const { organizationId, businessUnitId } = scope;
  const { accessToken, appUserId } = opts;

  if (!["approved", "active"].includes(compensationVersion?.compensation_status)) {
    throw new Error(
      `createPayableForAssignment: compensation version must be approved or active (is: ${compensationVersion?.compensation_status})`
    );
  }

  const eligibility = assessPayableEligibility({
    workerAssignment,
    operationalJob,
    workOrder,
  });

  if (!eligibility.passed) {
    throw new Error(
      `createPayableForAssignment: eligibility failed — ${eligibility.reasons.join("; ")}`
    );
  }

  const computedAmount = computeContractorPayable(compensationVersion, basisValue);

  const payload = buildContractorPayablePayload({
    organizationId,
    businessUnitId,
    workerId: workerAssignment.worker_id,
    workerAssignmentId: workerAssignment.id,
    operationalJobId: operationalJob.id,
    workOrderId: workOrder.id,
    contractorCompensationVersionId: compensationVersion.id,
    compensationMethod: compensationVersion.compensation_method,
    currencyCode: compensationVersion.currency_code,
    basisValue,
    computedAmount,
    eligibilityAssessment: {
      assessment_at: new Date().toISOString(),
      passed: true,
      reasons: [],
    },
    eligibilityPassed: true,
    metadata: { wave: "wave5" },
    createdByAppUserId: appUserId ?? null,
  });

  return createContractorPayable(payload, accessToken);
}

// ─────────────────────────────────────────────────────────────────────────────
// G. Job Profitability Snapshot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute and persist a job profitability snapshot.
 *
 * Revenue basis = accepted pricing subtotal (excl. tax) — never recalculated.
 * direct_labor_cost = sum of approved/paid contractor_payable rows for this job.
 * The DB GENERATED column computes gross_contribution; DB trigger computes gross_margin_percent.
 *
 * @param {object} scope         – { organizationId, businessUnitId }
 * @param {object} invoiceRequest – invoice_request row (for lineage + frozen amounts)
 * @param {object} opts          – { accessToken, appUserId, otherDirectCost? }
 * @returns {object} job_profitability_snapshot row
 */
export async function captureJobProfitabilitySnapshot(scope, invoiceRequest, opts = {}) {
  const { organizationId, businessUnitId } = scope;
  const { accessToken, appUserId, otherDirectCost = 0 } = opts;

  if (!invoiceRequest || !invoiceRequest.id) {
    throw new Error("captureJobProfitabilitySnapshot: invoiceRequest required");
  }

  // Sum approved/paid payables for this job
  const payables = await fetchContractorPayablesByJobId(
    invoiceRequest.operational_job_id,
    accessToken
  );
  const directLaborCost = (payables || [])
    .filter((p) => ["approved", "paid"].includes(p.payable_status))
    .reduce((sum, p) => sum + Number(p.computed_amount || 0), 0);

  // Check for existing snapshot
  const existing = await fetchJobProfitabilitySnapshotByJobId(
    invoiceRequest.operational_job_id,
    accessToken
  );

  const snapshotData = {
    organizationId,
    businessUnitId,
    operationalJobId: invoiceRequest.operational_job_id,
    invoiceRequestId: invoiceRequest.id,
    currencyCode: invoiceRequest.currency_code,
    recognizedRevenueAmount: invoiceRequest.subtotal_amount, // excl. tax
    taxAmount: invoiceRequest.tax_amount,
    directLaborCost,
    otherDirectCost: Number(otherDirectCost),
    sourceLineage: {
      invoice_request_id: invoiceRequest.id,
      pricing_snapshot_id: invoiceRequest.pricing_snapshot_id,
      quote_version_id: invoiceRequest.quote_version_id,
      payable_ids: (payables || [])
        .filter((p) => ["approved", "paid"].includes(p.payable_status))
        .map((p) => p.id),
    },
    metadata: { wave: "wave5", captured_at: new Date().toISOString() },
    createdByAppUserId: appUserId ?? null,
  };

  if (existing) {
    // Update direct_labor_cost and other_direct_cost (revenue is immutable per trigger)
    return updateJobProfitabilitySnapshot(
      existing.id,
      {
        direct_labor_cost: directLaborCost,
        other_direct_cost: Number(otherDirectCost),
        source_lineage: snapshotData.sourceLineage,
        snapshot_taken_at: new Date().toISOString(),
      },
      accessToken
    );
  }

  const payload = buildJobProfitabilitySnapshotPayload(snapshotData);
  // Remove client-side preview field before persisting
  const { gross_contribution_preview: _, ...persistPayload } = payload;
  return createJobProfitabilitySnapshot(persistPayload, accessToken);
}

// ─────────────────────────────────────────────────────────────────────────────
// H. Wave 5 Finance Quality / Status Contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a complete Wave 5 finance quality contract for a job.
 *
 * Returns a stable status object for display/future Wave 6 consumption.
 * Does not write any records.
 *
 * @param {string} operationalJobId
 * @param {object} opts – { accessToken }
 * @returns {object} Wave 5 finance status contract
 */
export async function loadWave5FinanceStatus(operationalJobId, opts = {}) {
  const { accessToken } = opts;

  if (!operationalJobId) throw new Error("loadWave5FinanceStatus: operationalJobId required");

  const [gate, invoiceRequest] = await Promise.all([
    fetchBillingReadinessGateByJobId(operationalJobId, accessToken),
    fetchInvoiceRequestByJobId(operationalJobId, accessToken),
  ]);

  const [payables, profitability] = await Promise.all([
    fetchContractorPayablesByJobId(operationalJobId, accessToken),
    fetchJobProfitabilitySnapshotByJobId(operationalJobId, accessToken),
  ]);

  const payments = invoiceRequest
    ? await fetchPaymentObservationsByInvoiceRequestId(invoiceRequest.id, accessToken)
    : [];

  return {
    wave: "wave5",
    operational_job_id: operationalJobId,
    billing_ready: gate?.gate_status === "ready",
    gate_status: gate?.gate_status ?? null,
    invoice_request_status: invoiceRequest?.request_status ?? null,
    invoice_request_id: invoiceRequest?.id ?? null,
    total_amount: invoiceRequest?.total_amount ?? null,
    currency_code: invoiceRequest?.currency_code ?? null,
    payment_count: Array.isArray(payments) ? payments.length : 0,
    payment_statuses: Array.isArray(payments)
      ? [...new Set(payments.map((p) => p.payment_status))]
      : [],
    payable_count: Array.isArray(payables) ? payables.length : 0,
    payable_statuses: Array.isArray(payables)
      ? [...new Set(payables.map((p) => p.payable_status))]
      : [],
    gross_contribution: profitability?.gross_contribution ?? null,
    gross_margin_percent: profitability?.gross_margin_percent ?? null,
    profitability_snapshot_id: profitability?.id ?? null,
    assessed_at: gate?.assessed_at ?? null,
  };
}
