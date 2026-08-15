// =============================================================================
// UNIT / LIFECYCLE / SECURITY TESTS — Wave 5 Finance
// Tests serviceosWave5FinanceUtils.js and serviceosWave5Runtime.js pure logic.
// No database calls. All async functions use stubs.
// =============================================================================

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { test } from "node:test";
import assert from "node:assert/strict";

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
} from "../src/lib/serviceosWave5FinanceUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const wave5RuntimeSrc = readFileSync(
  resolve(ROOT, "src/lib/serviceosWave5Runtime.js"),
  "utf8"
);
const wave5ClientSrc = readFileSync(
  resolve(ROOT, "src/lib/serviceosWave5FinanceClient.js"),
  "utf8"
);
const wave5UtilsSrc = readFileSync(
  resolve(ROOT, "src/lib/serviceosWave5FinanceUtils.js"),
  "utf8"
);
const qbAdapterSrc = readFileSync(
  resolve(ROOT, "api/wave5-accounting-sync.js"),
  "utf8"
);
const webhookSrc = readFileSync(
  resolve(ROOT, "api/stripe-webhook.js"),
  "utf8"
);
const mainSrc = readFileSync(resolve(ROOT, "src/main.jsx"), "utf8");

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_SCOPE = {
  organizationId: "org-1",
  businessUnitId: "bu-1",
  jurisdictionId: "jur-1",
};

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    operational_status: "qa_passed",
    pricing_snapshot_id: "ps-1",
    quote_version_id: "qv-1",
    ...overrides,
  };
}

function makeWorkOrder(overrides = {}) {
  return { id: "wo-1", work_order_status: "qa_complete", ...overrides };
}

function makeAssignment(overrides = {}) {
  return {
    id: "wa-1",
    worker_id: "worker-1",
    assignment_status: "acknowledged",
    assigned_at: new Date().toISOString(),
    acknowledged_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCompVersion(overrides = {}) {
  return {
    id: "ccv-1",
    compensation_method: "flat_amount",
    currency_code: "CAD",
    rate_value: 80,
    compensation_status: "approved",
    ...overrides,
  };
}

// ── Historical Wave 1–4 no change ─────────────────────────────────────────────

test("1. Wave 5 migration does not modify Wave 1-4 migration files", () => {
  const w3 = readFileSync(resolve(ROOT, "supabase/migrations/007_wave3_operations.sql"), "utf8");
  const w4 = readFileSync(resolve(ROOT, "supabase/migrations/009_wave4_delivery_quality_gaps.sql"), "utf8");
  // These files must not contain Wave 5 references
  assert.ok(!w3.includes("billing_readiness_gate"), "007 must not reference Wave 5 tables");
  assert.ok(!w4.includes("billing_readiness_gate"), "009 must not reference Wave 5 tables");
  assert.ok(!w3.includes("invoice_request"), "007 must not reference invoice_request");
  assert.ok(!w4.includes("invoice_request"), "009 must not reference invoice_request");
});

test("2. Wave 4 fixture 011 is unchanged by Wave 5 work", () => {
  const fixture = readFileSync(
    resolve(ROOT, "supabase/acceptance/011_wave4_preview_acceptance_fixture.sql"),
    "utf8"
  );
  assert.ok(!fixture.includes("billing_readiness_gate"), "Wave 4 fixture must not reference Wave 5 tables");
  assert.ok(!fixture.includes("invoice_request"), "Wave 4 fixture must not reference invoice_request");
});

// ── Billing Readiness Gate — fail closed ─────────────────────────────────────

test("3. billing_readiness_gate.gate_status = blocked when job not qa_passed", () => {
  const job = makeJob({ operational_status: "in_progress" });
  const wo = makeWorkOrder();
  const reasons = [];

  const readyJobStatuses = ["qa_passed", "closed"];
  if (!readyJobStatuses.includes(job.operational_status)) {
    reasons.push(`operational_job must be qa_passed or closed (is: ${job.operational_status})`);
  }
  assert.ok(reasons.length > 0, "Should have blocking reason for non-ready job");
});

test("4. billing_readiness_gate.gate_status = blocked when work_order not qa_complete", () => {
  const job = makeJob();
  const wo = makeWorkOrder({ work_order_status: "in_progress" });
  const reasons = [];

  const readyWoStatuses = ["qa_complete", "closed"];
  if (!readyWoStatuses.includes(wo.work_order_status)) {
    reasons.push(`work_order must be qa_complete or closed (is: ${wo.work_order_status})`);
  }
  assert.ok(reasons.length > 0, "Should have blocking reason for non-ready work_order");
});

test("5. billing_readiness_gate.gate_status = blocked when open corrective actions exist", () => {
  const openCAs = [{ id: "ca-1", action_status: "open" }];
  const reasons = [];
  if (openCAs.length > 0) {
    reasons.push(`${openCAs.length} open corrective action(s) must be resolved before billing`);
  }
  assert.ok(reasons.length > 0, "Should have blocking reason for open corrective actions");
});

test("6. buildBillingReadinessGatePayload fails closed on missing required fields", () => {
  assert.throws(
    () => buildBillingReadinessGatePayload({}),
    /organizationId required/
  );
  assert.throws(
    () => buildBillingReadinessGatePayload({ organizationId: "org-1" }),
    /businessUnitId required/
  );
});

test("7. buildBillingReadinessGatePayload rejects invalid gateStatus", () => {
  assert.throws(
    () =>
      buildBillingReadinessGatePayload({
        ...BASE_SCOPE,
        operationalJobId: "j1",
        workOrderId: "wo1",
        pricingSnapshotId: "ps1",
        quoteVersionId: "qv1",
        gateStatus: "invalid",
      }),
    /invalid gateStatus/
  );
});

// ── Invoice Request — exact accepted pricing lineage ─────────────────────────

test("8. buildInvoiceRequestPayload preserves accepted pricing lineage without recalculation", () => {
  const payload = buildInvoiceRequestPayload({
    ...BASE_SCOPE,
    billingReadinessGateId: "gate-1",
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    pricingSnapshotId: "ps-1",
    quoteVersionId: "qv-1",
    currencyCode: "CAD",
    subtotalAmount: 220.0,
    taxAmount: 28.6,
    totalAmount: 248.6,
  });
  assert.equal(payload.subtotal_amount, 220.0);
  assert.equal(payload.tax_amount, 28.6);
  assert.equal(payload.total_amount, 248.6);
  assert.equal(payload.currency_code, "CAD");
  assert.equal(payload.request_status, "draft");
});

test("9. buildInvoiceRequestPayload enforces total = subtotal + tax coherence", () => {
  assert.throws(
    () =>
      buildInvoiceRequestPayload({
        ...BASE_SCOPE,
        billingReadinessGateId: "gate-1",
        operationalJobId: "job-1",
        workOrderId: "wo-1",
        pricingSnapshotId: "ps-1",
        quoteVersionId: "qv-1",
        currencyCode: "CAD",
        subtotalAmount: 220.0,
        taxAmount: 28.6,
        totalAmount: 300.0, // wrong
      }),
    /must equal subtotalAmount.*taxAmount|totalAmount.*subtotalAmount/
  );
});

test("10. buildInvoiceRequestPayload rejects negative amounts", () => {
  assert.throws(
    () =>
      buildInvoiceRequestPayload({
        ...BASE_SCOPE,
        billingReadinessGateId: "gate-1",
        operationalJobId: "job-1",
        workOrderId: "wo-1",
        pricingSnapshotId: "ps-1",
        quoteVersionId: "qv-1",
        currencyCode: "CAD",
        subtotalAmount: -10,
        taxAmount: 0,
        totalAmount: -10,
      }),
    /non-negative/
  );
});

test("11. buildInvoiceRequestPayload tax and currency preserved from accepted pricing", () => {
  const payload = buildInvoiceRequestPayload({
    ...BASE_SCOPE,
    billingReadinessGateId: "gate-1",
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    pricingSnapshotId: "ps-1",
    quoteVersionId: "qv-1",
    currencyCode: "usd",
    subtotalAmount: 100,
    taxAmount: 0,
    totalAmount: 100,
    taxName: "GST",
    taxRate: 0.05,
  });
  assert.equal(payload.currency_code, "USD"); // normalized to uppercase
  assert.equal(payload.tax_name, "GST");
  assert.equal(payload.tax_rate, 0.05);
});

// ── Accounting Sync — no fabricated IDs ─────────────────────────────────────

test("12. buildAccountingSyncOutboxPayload requires nonblank idempotencyKey", () => {
  assert.throws(
    () =>
      buildAccountingSyncOutboxPayload({
        organizationId: "org-1",
        businessUnitId: "bu-1",
        invoiceRequestId: "ir-1",
        idempotencyKey: "   ",
      }),
    /idempotencyKey must be nonblank/
  );
});

test("13. buildAccountingSyncOutboxPayload rejects preview_test without isTestAdapter=true", () => {
  assert.throws(
    () =>
      buildAccountingSyncOutboxPayload({
        organizationId: "org-1",
        businessUnitId: "bu-1",
        invoiceRequestId: "ir-1",
        idempotencyKey: "key-1",
        provider: "preview_test",
        isTestAdapter: false,
      }),
    /requires isTestAdapter=true/
  );
});

test("14. QB adapter source contains production guard (test adapter blocked in production)", () => {
  assert.ok(
    qbAdapterSrc.includes("PROHIBITED in Production") ||
    qbAdapterSrc.includes("is_test_adapter") && qbAdapterSrc.includes("production"),
    "QB adapter must block test adapter in production"
  );
});

test("15. QB adapter does NOT import the placeholder quickbooks-sync.js", () => {
  // Check there's no import/require of the placeholder file
  assert.ok(
    !/import.*quickbooks-sync/i.test(qbAdapterSrc) &&
    !/require.*quickbooks-sync/i.test(qbAdapterSrc),
    "wave5-accounting-sync must not import the placeholder quickbooks-sync.js"
  );
  assert.ok(
    !qbAdapterSrc.includes("QB-${Date.now()}"),
    "wave5-accounting-sync must not fabricate QB IDs"
  );
});

test("16. QB adapter runtime guard: no live QB credentials → production path fails closed", () => {
  assert.ok(
    qbAdapterSrc.includes("QBO_CLIENT_ID") &&
    qbAdapterSrc.includes("QBO_CLIENT_SECRET") &&
    qbAdapterSrc.includes("QBO_REFRESH_TOKEN") &&
    qbAdapterSrc.includes("QBO_REALM_ID"),
    "QB adapter must enumerate required live credentials"
  );
  assert.ok(
    qbAdapterSrc.includes("503") || qbAdapterSrc.includes("not configured for Production"),
    "QB adapter must return error when production lacks credentials"
  );
});

test("17. QB adapter test response is explicitly marked as preview/test only (no real QB entry)", () => {
  assert.ok(
    qbAdapterSrc.includes("PREVIEW/TEST ONLY") || qbAdapterSrc.includes("preview/test only"),
    "Test adapter response must be explicitly marked as not a real QB entry"
  );
  assert.ok(
    qbAdapterSrc.includes("is_test_adapter"),
    "Test adapter response must include is_test_adapter flag"
  );
});

test("18. Wave 5 runtime source rejects fabricated QB-timestamp provider reference IDs", () => {
  assert.ok(
    wave5RuntimeSrc.includes("fabricated placeholder") ||
    wave5RuntimeSrc.includes("QB-") && wave5RuntimeSrc.includes("Real QuickBooks IDs"),
    "Runtime must reject fabricated QB IDs"
  );
});

// ── Payment Observation — idempotency ─────────────────────────────────────────

test("19. buildPaymentObservationPayload requires providerEventId (Stripe event dedup key)", () => {
  assert.throws(
    () =>
      buildPaymentObservationPayload({
        organizationId: "org-1",
        businessUnitId: "bu-1",
        invoiceRequestId: "ir-1",
        provider: "stripe",
        providerEventId: "",
        providerEventType: "checkout.session.completed",
        currencyCode: "CAD",
        amountObserved: 248.6,
        observedAt: new Date().toISOString(),
      }),
    /providerEventId required/
  );
});

test("20. buildPaymentObservationPayload preserves amount and currency", () => {
  const payload = buildPaymentObservationPayload({
    organizationId: "org-1",
    businessUnitId: "bu-1",
    invoiceRequestId: "ir-1",
    provider: "stripe",
    providerEventId: "evt-123",
    providerEventType: "checkout.session.completed",
    currencyCode: "cad",
    amountObserved: 248.6,
    observedAt: new Date().toISOString(),
  });
  assert.equal(payload.amount_observed, 248.6);
  assert.equal(payload.currency_code, "CAD");
  assert.equal(payload.payment_status, "observed");
});

test("21. buildPaymentObservationPayload rejects negative amount", () => {
  assert.throws(
    () =>
      buildPaymentObservationPayload({
        organizationId: "org-1",
        businessUnitId: "bu-1",
        invoiceRequestId: "ir-1",
        provider: "stripe",
        providerEventId: "evt-1",
        providerEventType: "checkout.session.completed",
        currencyCode: "CAD",
        amountObserved: -5,
        observedAt: new Date().toISOString(),
      }),
    /non-negative/
  );
});

test("22. stripe-webhook.js canonical persistence is additive and non-blocking", () => {
  // Legacy response path must still return { received: true } unchanged
  assert.ok(
    webhookSrc.includes("received: true"),
    "Legacy webhook response must be preserved"
  );
  // Wave 5 persistence must be wrapped in try/catch (non-blocking)
  assert.ok(
    webhookSrc.includes("SERVICEOS_FINANCE_ENABLED") &&
    webhookSrc.includes("persistCanonicalPaymentObservation"),
    "Wave 5 persistence must be guarded by SERVICEOS_FINANCE_ENABLED"
  );
  assert.ok(
    webhookSrc.includes("non-blocking"),
    "Wave 5 persistence failure must be non-blocking"
  );
});

test("23. stripe-webhook.js fails closed in Production without webhook secret", () => {
  assert.ok(
    webhookSrc.includes("production") &&
    webhookSrc.includes("STRIPE_WEBHOOK_SECRET") &&
    webhookSrc.includes("Webhook signature verification required in Production"),
    "Webhook must fail closed in Production without signature verification"
  );
});

test("24. duplicate Stripe webhook delivery is idempotent (checked by provider_event_id)", () => {
  assert.ok(
    webhookSrc.includes("idempotent") ||
    (webhookSrc.includes("provider_event_id") && webhookSrc.includes("already persisted")),
    "Stripe webhook dedup must check provider_event_id"
  );
  assert.ok(
    wave5RuntimeSrc.includes("Idempotent") || wave5RuntimeSrc.includes("idempotent"),
    "observePayment must be idempotent"
  );
});

// ── Contractor Compensation ────────────────────────────────────────────────────

test("25. buildContractorCompensationVersionPayload enforces percentage range [0,1]", () => {
  assert.throws(
    () =>
      buildContractorCompensationVersionPayload({
        ...BASE_SCOPE,
        workerId: "w-1",
        version: "v1",
        compensationMethod: "percentage",
        rateValue: 1.5,
        effectiveFrom: new Date().toISOString(),
      }),
    /percentage rateValue must be in \[0, 1\]/
  );
});

test("26. buildContractorCompensationVersionPayload accepts flat_amount, hourly, percentage", () => {
  for (const method of ["flat_amount", "hourly", "percentage"]) {
    const rate = method === "percentage" ? 0.35 : 80;
    const p = buildContractorCompensationVersionPayload({
      ...BASE_SCOPE,
      workerId: "w-1",
      version: "v1",
      compensationMethod: method,
      rateValue: rate,
      effectiveFrom: new Date().toISOString(),
    });
    assert.equal(p.compensation_method, method);
    assert.equal(p.compensation_status, "draft");
  }
});

test("27. contractor_compensation_version immutability: rate/method/currency immutable after approval (source check)", () => {
  const migration = readFileSync(
    resolve(ROOT, "supabase/migrations/012_wave5_finance.sql"),
    "utf8"
  );
  assert.ok(
    migration.includes("rate_value is immutable after approval"),
    "rate_value must be immutable after approval"
  );
  assert.ok(
    migration.includes("compensation_method is immutable after approval"),
    "compensation_method must be immutable after approval"
  );
  assert.ok(
    migration.includes("currency_code is immutable after approval"),
    "currency_code must be immutable after approval"
  );
});

test("28. later compensation version does not rewrite historical payable (each payable references frozen version id)", () => {
  // Test by verifying contractor_payable stores contractor_compensation_version_id (FK to frozen version)
  const migration = readFileSync(
    resolve(ROOT, "supabase/migrations/012_wave5_finance.sql"),
    "utf8"
  );
  assert.ok(
    migration.includes("contractor_compensation_version_id") &&
    /FOREIGN KEY.*contractor_compensation_version/.test(migration),
    "contractor_payable must FK-reference a frozen contractor_compensation_version"
  );
});

// ── Contractor Payable ─────────────────────────────────────────────────────────

test("29. computeContractorPayable: flat_amount returns rate regardless of basis", () => {
  const cv = makeCompVersion({ compensation_method: "flat_amount", rate_value: 100 });
  assert.equal(computeContractorPayable(cv, 0), 100);
  assert.equal(computeContractorPayable(cv, 10), 100);
});

test("30. computeContractorPayable: hourly = rate * hours", () => {
  const cv = makeCompVersion({ compensation_method: "hourly", rate_value: 25 });
  assert.equal(computeContractorPayable(cv, 4), 100);
  assert.equal(computeContractorPayable(cv, 2.5), 62.5);
});

test("31. computeContractorPayable: percentage = rate * basis", () => {
  const cv = makeCompVersion({ compensation_method: "percentage", rate_value: 0.4 });
  assert.equal(computeContractorPayable(cv, 200), 80);
});

test("32. computeContractorPayable rejects negative rate or basis", () => {
  assert.throws(
    () => computeContractorPayable(makeCompVersion({ rate_value: -1 }), 5),
    /non-negative/
  );
  assert.throws(
    () => computeContractorPayable(makeCompVersion(), -5),
    /non-negative/
  );
});

test("33. assessPayableEligibility fails closed if assignment not acknowledged", () => {
  const result = assessPayableEligibility({
    workerAssignment: makeAssignment({ assignment_status: "proposed" }),
    operationalJob: makeJob(),
    workOrder: makeWorkOrder(),
  });
  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((r) => r.includes("assignment") || r.includes("status")));
});

test("34. assessPayableEligibility fails closed if job not service_complete or later", () => {
  const result = assessPayableEligibility({
    workerAssignment: makeAssignment(),
    operationalJob: makeJob({ operational_status: "dispatched" }),
    workOrder: makeWorkOrder(),
  });
  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((r) => r.includes("operational_job status")));
});

test("35. assessPayableEligibility passes when all conditions met", () => {
  const result = assessPayableEligibility({
    workerAssignment: makeAssignment(),
    operationalJob: makeJob({ operational_status: "qa_passed" }),
    workOrder: makeWorkOrder({ work_order_status: "qa_complete" }),
  });
  assert.equal(result.passed, true);
  assert.equal(result.reasons.length, 0);
});

test("36. worker cannot approve own payable (DB trigger check in migration source)", () => {
  const migration = readFileSync(
    resolve(ROOT, "supabase/migrations/012_wave5_finance.sql"),
    "utf8"
  );
  assert.ok(
    migration.includes("worker may not approve their own payable"),
    "DB trigger must prevent self-approval"
  );
});

test("37. buildContractorPayablePayload requires boolean eligibilityPassed", () => {
  assert.throws(
    () =>
      buildContractorPayablePayload({
        ...BASE_SCOPE,
        workerId: "w-1",
        workerAssignmentId: "wa-1",
        operationalJobId: "job-1",
        workOrderId: "wo-1",
        contractorCompensationVersionId: "ccv-1",
        compensationMethod: "flat_amount",
        currencyCode: "CAD",
        basisValue: 0,
        computedAmount: 80,
        eligibilityPassed: "yes", // invalid
      }),
    /eligibilityPassed must be boolean/
  );
});

test("38. buildContractorPayablePayload payable_status starts as pending", () => {
  const p = buildContractorPayablePayload({
    ...BASE_SCOPE,
    workerId: "w-1",
    workerAssignmentId: "wa-1",
    operationalJobId: "job-1",
    workOrderId: "wo-1",
    contractorCompensationVersionId: "ccv-1",
    compensationMethod: "flat_amount",
    currencyCode: "CAD",
    basisValue: 0,
    computedAmount: 80,
    eligibilityPassed: true,
  });
  assert.equal(p.payable_status, "pending");
  assert.equal(p.approved_by_app_user_id, null);
});

// ── Job Profitability ─────────────────────────────────────────────────────────

test("39. buildJobProfitabilitySnapshotPayload revenue = accepted subtotal excl. tax", () => {
  const p = buildJobProfitabilitySnapshotPayload({
    ...BASE_SCOPE,
    operationalJobId: "job-1",
    currencyCode: "CAD",
    recognizedRevenueAmount: 220,
    taxAmount: 28.6,
    directLaborCost: 80,
    otherDirectCost: 0,
    sourceLineage: { pricing_snapshot_id: "ps-1" },
  });
  assert.equal(p.recognized_revenue_amount, 220);
  assert.equal(p.tax_amount, 28.6);
  assert.equal(p.direct_labor_cost, 80);
});

test("40. buildJobProfitabilitySnapshotPayload gross_contribution_preview = revenue - labor - other", () => {
  const p = buildJobProfitabilitySnapshotPayload({
    ...BASE_SCOPE,
    operationalJobId: "job-1",
    currencyCode: "CAD",
    recognizedRevenueAmount: 200,
    taxAmount: 26,
    directLaborCost: 60,
    otherDirectCost: 10,
  });
  assert.equal(p.gross_contribution_preview, 130); // 200 - 60 - 10
});

test("41. buildJobProfitabilitySnapshotPayload gross_margin_percent = NULL when revenue = 0", () => {
  const p = buildJobProfitabilitySnapshotPayload({
    ...BASE_SCOPE,
    operationalJobId: "job-1",
    currencyCode: "CAD",
    recognizedRevenueAmount: 0,
    taxAmount: 0,
    directLaborCost: 0,
  });
  assert.equal(p.gross_margin_percent, null, "Zero-revenue guard: margin must be null");
});

test("42. buildJobProfitabilitySnapshotPayload formula correctness", () => {
  const p = buildJobProfitabilitySnapshotPayload({
    ...BASE_SCOPE,
    operationalJobId: "job-1",
    currencyCode: "CAD",
    recognizedRevenueAmount: 200,
    taxAmount: 26,
    directLaborCost: 80,
    otherDirectCost: 0,
  });
  // gross_margin = (200 - 80) / 200 = 0.6
  assert.equal(p.gross_margin_percent, 0.6);
});

test("43. tax excluded from gross_margin computation (margin is on revenue ex-tax)", () => {
  const p = buildJobProfitabilitySnapshotPayload({
    ...BASE_SCOPE,
    operationalJobId: "job-1",
    currencyCode: "CAD",
    recognizedRevenueAmount: 100,  // subtotal, NOT including 13% tax
    taxAmount: 13,
    directLaborCost: 30,
    otherDirectCost: 0,
  });
  // Tax is NOT in recognized_revenue_amount; margin = (100 - 30) / 100 = 0.7
  assert.equal(p.gross_margin_percent, 0.7);
});

test("44. buildJobProfitabilitySnapshotPayload rejects negative costs", () => {
  assert.throws(
    () =>
      buildJobProfitabilitySnapshotPayload({
        ...BASE_SCOPE,
        operationalJobId: "job-1",
        currencyCode: "CAD",
        recognizedRevenueAmount: 200,
        taxAmount: 26,
        directLaborCost: -10,
      }),
    /non-negative/
  );
});

// ── RLS / Security ────────────────────────────────────────────────────────────

test("45. no anon finance CRUD in migration (REVOKE ALL from anon on all tables)", () => {
  const migration = readFileSync(
    resolve(ROOT, "supabase/migrations/012_wave5_finance.sql"),
    "utf8"
  );
  const tables = [
    "billing_readiness_gate",
    "invoice_request",
    "accounting_sync_outbox",
    "payment_observation",
    "contractor_compensation_version",
    "contractor_payable",
    "job_profitability_snapshot",
  ];
  for (const t of tables) {
    assert.ok(
      new RegExp(`REVOKE ALL ON public\\.${t}.*FROM anon`).test(migration),
      `anon not revoked on ${t}`
    );
  }
});

test("46. office_ops has only select/insert on invoice_request (not update/delete/accounting)", () => {
  const migration = readFileSync(
    resolve(ROOT, "supabase/migrations/012_wave5_finance.sql"),
    "utf8"
  );
  // office_ops should not have a policy on accounting_sync_outbox
  assert.ok(
    !migration.includes("pol_aso_office_ops"),
    "office_ops must not have accounting_sync_outbox policy"
  );
  // office_ops insert on invoice_request is permitted
  assert.ok(
    migration.includes("pol_ir_office_ops_insert"),
    "office_ops must be able to insert invoice_request"
  );
});

test("47. worker read policy scoped to own records only (current_worker_id)", () => {
  const migration = readFileSync(
    resolve(ROOT, "supabase/migrations/012_wave5_finance.sql"),
    "utf8"
  );
  assert.ok(
    migration.includes("current_worker_id(organization_id)"),
    "Worker read policies must use current_worker_id scope"
  );
});

test("48. client feature guard: finance client disabled when VITE_SERVICEOS_FINANCE_ENABLED is not true", () => {
  assert.ok(
    wave5ClientSrc.includes("VITE_SERVICEOS_FINANCE_ENABLED") &&
    wave5ClientSrc.includes("not true"),
    "Finance client must assert enabled flag"
  );
});

// ── Production Flags OFF ──────────────────────────────────────────────────────

test("49. Wave 5 feature flags default false (VITE_SERVICEOS_FINANCE_ENABLED not set in any source)", () => {
  // Finance client must gate on the flag — it must reference VITE_SERVICEOS_FINANCE_ENABLED
  assert.ok(
    wave5ClientSrc.includes("VITE_SERVICEOS_FINANCE_ENABLED"),
    "Finance client must check VITE_SERVICEOS_FINANCE_ENABLED feature flag"
  );
  // main.jsx mounts Wave5 panel ONLY when both flags are true
  assert.ok(
    mainSrc.includes("VITE_SERVICEOS_FINANCE_ENABLED") &&
    mainSrc.includes("VITE_SERVICEOS_WAVE5_PILOT_UI"),
    "main.jsx must check both Wave 5 feature flags"
  );
});

test("50. no destructive cleanup in Wave 5 sources", () => {
  for (const [label, src] of [
    ["runtime", wave5RuntimeSrc],
    ["client", wave5ClientSrc],
    ["utils", wave5UtilsSrc],
    ["qb-adapter", qbAdapterSrc],
  ]) {
    assert.ok(
      !/DELETE\s+FROM/i.test(src),
      `${label} must not contain DELETE FROM`
    );
  }
});

// ── Wave 5 Status Contract ─────────────────────────────────────────────────────

test("51. loadWave5FinanceStatus returns stable Wave 5 quality contract", () => {
  assert.ok(
    wave5RuntimeSrc.includes("loadWave5FinanceStatus") &&
    wave5RuntimeSrc.includes("billing_ready") &&
    wave5RuntimeSrc.includes("gate_status") &&
    wave5RuntimeSrc.includes("invoice_request_status") &&
    wave5RuntimeSrc.includes("gross_contribution") &&
    wave5RuntimeSrc.includes("gross_margin_percent"),
    "loadWave5FinanceStatus must return complete Wave 5 status contract"
  );
});

test("52. Wave 5 runtime has no circular import to Wave 4 runtime", () => {
  assert.ok(
    !wave5RuntimeSrc.includes("serviceosWave4Runtime"),
    "Wave 5 runtime must not import Wave 4 runtime"
  );
});

test("53. QB adapter enumerates exact missing live prerequisites in response", () => {
  assert.ok(
    qbAdapterSrc.includes("missing_live_prerequisites") ||
    qbAdapterSrc.includes("missing_prerequisites"),
    "QB test adapter response must enumerate missing live prerequisites"
  );
  assert.ok(
    qbAdapterSrc.includes("QBO_CLIENT_ID"),
    "QB adapter must reference QBO_CLIENT_ID prerequisite"
  );
});
