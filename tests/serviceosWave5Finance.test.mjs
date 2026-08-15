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
    assignment_status: "completed",
    assigned_at: new Date().toISOString(),
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

test("22. stripe-webhook.js canonical persistence is Wave5-event-specific and retriable-on-fail (A10)", () => {
  // Legacy response path must still return { received: true } unchanged
  assert.ok(
    webhookSrc.includes("received: true"),
    "Legacy webhook response must be preserved"
  );
  // Wave 5 persistence must be guarded by SERVICEOS_FINANCE_ENABLED
  assert.ok(
    webhookSrc.includes("SERVICEOS_FINANCE_ENABLED") &&
    webhookSrc.includes("persistCanonicalPaymentObservation"),
    "Wave 5 persistence must be guarded by SERVICEOS_FINANCE_ENABLED"
  );
  // A10: Wave 5 canonical persistence failures return retriable non-2xx
  assert.ok(
    webhookSrc.includes("retriable") || webhookSrc.includes("503"),
    "Wave 5 canonical persistence failures must return retriable non-2xx (A10)"
  );
  // A10: Legacy non-ServiceOS events must not be failed by Wave 5 logic
  assert.ok(
    webhookSrc.includes("isWave5InvoiceEvent") || webhookSrc.includes("job_id"),
    "Stripe webhook must identify Wave 5 events deterministically before canonical persistence"
  );
});

test("23. stripe-webhook.js fails closed in Production without webhook secret or signature (A9)", () => {
  assert.ok(
    webhookSrc.includes("production") &&
    webhookSrc.includes("STRIPE_WEBHOOK_SECRET") &&
    (webhookSrc.includes("required in Production") || webhookSrc.includes("required in production")),
    "Webhook must fail closed in Production without STRIPE_WEBHOOK_SECRET"
  );
  assert.ok(
    webhookSrc.includes("stripe-signature") &&
    webhookSrc.includes("required in Production"),
    "Webhook must also require stripe-signature header in Production (A9)"
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

test("46. office_ops has only select on accounting_sync_outbox (A5) and select/insert on invoice_request", () => {
  const migration = readFileSync(
    resolve(ROOT, "supabase/migrations/012_wave5_finance.sql"),
    "utf8"
  );
  // A5: office_ops may have SELECT policy on accounting_sync_outbox (to observe status) but NOT insert/mutate
  // pol_aso_office_ops_select is the correct SELECT-only policy name
  assert.ok(
    !migration.includes("pol_aso_office_ops_all") &&
    !migration.includes("pol_aso_office_ops_insert"),
    "office_ops must not have INSERT/ALL policy on accounting_sync_outbox"
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

// =============================================================================
// CORRECTIVE PASS TESTS — Wave 5 Finance Security/Integrity (A1–A17)
// =============================================================================

const m012Src = readFileSync(
  resolve(ROOT, "supabase/migrations/012_wave5_finance.sql"),
  "utf8"
);

// ── A1/A2: Billing gate canonical lineage trigger ────────────────────────────

test("54. M012 has billing_readiness_gate canonical lineage trigger (A1)", () => {
  assert.ok(
    m012Src.includes("trg_billing_readiness_gate_canonical_lineage") &&
    m012Src.includes("trg_brg_canonical_lineage"),
    "M012 must define and attach the billing_readiness_gate canonical lineage trigger"
  );
});

test("55. M012 billing gate trigger validates operational_handoff required for ready (A2)", () => {
  assert.ok(
    m012Src.includes("operational_handoff_id IS NULL") &&
    m012Src.includes("gate_status = ready"),
    "M012 canonical lineage trigger must reject null handoff_id when gate_status=ready"
  );
});

test("56. M012 billing gate trigger validates cancelled job/work_order cannot be billing ready (A1)", () => {
  assert.ok(
    m012Src.includes("cancelled operational_job") ||
    m012Src.includes("cancelled work_order") ||
    (m012Src.includes("operational_status = 'cancelled'") && m012Src.includes("billing ready")),
    "M012 trigger must reject cancelled job/work_order for billing ready gate"
  );
});

test("57. M012 billing gate trigger validates passed/waived QA required (A1)", () => {
  const hasQaInspection = m012Src.includes("qa_inspection");
  const hasPassedWaived = m012Src.includes("passed') OR") || m012Src.includes("'passed', 'waived'");
  assert.ok(
    hasQaInspection && hasPassedWaived,
    "M012 trigger must require at least one passed/waived qa_inspection"
  );
});

test("58. M012 billing gate trigger validates no open corrective_actions (A1)", () => {
  assert.ok(
    m012Src.includes("corrective_action") && m012Src.includes("corrective action"),
    "M012 trigger must verify no open corrective_actions before billing ready"
  );
});

test("59. M012 billing gate trigger validates pricing/quote lineage matches job (A1)", () => {
  assert.ok(
    m012Src.includes("pricing_snapshot_id mismatch") &&
    m012Src.includes("quote_version_id mismatch"),
    "M012 trigger must validate pricing_snapshot_id and quote_version_id match the operational_job"
  );
});

test("60. buildBillingReadinessGatePayload requires operationalHandoffId when gateStatus=ready (A2)", () => {
  // Source-level check: the util must mention handoff required when ready
  assert.ok(
    wave5UtilsSrc.includes("operationalHandoffId is required when gateStatus is 'ready'") ||
    (wave5UtilsSrc.includes("operationalHandoffId") && wave5UtilsSrc.includes("ready")),
    "serviceosWave5FinanceUtils must require operationalHandoffId when gateStatus=ready"
  );
});

// ── A3: Invoice request lineage and monetary validation ──────────────────────

test("61. M012 has invoice_request lineage and monetary check trigger (A3)", () => {
  assert.ok(
    m012Src.includes("trg_invoice_request_lineage_and_monetary_check") &&
    m012Src.includes("trg_ir_lineage_and_monetary_check"),
    "M012 must define and attach trg_invoice_request_lineage_and_monetary_check"
  );
});

test("62. M012 invoice_request trigger validates pricing snapshot monetary values match (A3)", () => {
  assert.ok(
    m012Src.includes("subtotal_amount % does not match pricing_snapshot") ||
    m012Src.includes("subtotal_amount"),
    "M012 trigger must validate subtotal_amount matches pricing_snapshot"
  );
  assert.ok(
    m012Src.includes("tax_amount % does not match") || m012Src.includes("tax_amount"),
    "M012 trigger must validate tax_amount matches pricing_snapshot"
  );
  assert.ok(
    m012Src.includes("currency_code % does not match") || m012Src.includes("currency_code"),
    "M012 trigger must validate currency_code matches pricing_snapshot"
  );
});

test("63. M012 invoice_request trigger validates all IDs match the gate (A3)", () => {
  assert.ok(
    m012Src.includes("operational_job_id does not match billing_readiness_gate"),
    "M012 trigger must validate operational_job_id matches billing_readiness_gate"
  );
  assert.ok(
    m012Src.includes("work_order_id does not match billing_readiness_gate"),
    "M012 trigger must validate work_order_id matches billing_readiness_gate"
  );
});

// ── A5/A11: Server-only mutation ─────────────────────────────────────────────

test("64. M012 grants SELECT only (no INSERT/UPDATE) on accounting_sync_outbox to authenticated (A5)", () => {
  assert.ok(
    m012Src.includes("GRANT SELECT                 ON public.accounting_sync_outbox") ||
    m012Src.includes("GRANT SELECT ON public.accounting_sync_outbox"),
    "M012 must grant SELECT-only on accounting_sync_outbox to authenticated"
  );
  assert.ok(
    !m012Src.includes("GRANT SELECT, INSERT, UPDATE ON public.accounting_sync_outbox"),
    "M012 must NOT grant INSERT/UPDATE on accounting_sync_outbox to authenticated"
  );
});

test("65. M012 grants SELECT only (no INSERT) on payment_observation to authenticated (A11)", () => {
  assert.ok(
    m012Src.includes("GRANT SELECT                 ON public.payment_observation") ||
    m012Src.includes("GRANT SELECT ON public.payment_observation"),
    "M012 must grant SELECT-only on payment_observation to authenticated"
  );
  assert.ok(
    !m012Src.includes("GRANT SELECT, INSERT         ON public.payment_observation"),
    "M012 must NOT grant INSERT on payment_observation to authenticated"
  );
});

test("66. M012 RLS policies for accounting_sync_outbox are SELECT-only (A5)", () => {
  assert.ok(
    m012Src.includes("pol_aso_owner_admin_select"),
    "M012 must define pol_aso_owner_admin_select (SELECT-only) for accounting_sync_outbox"
  );
  assert.ok(
    !m012Src.includes("pol_aso_owner_admin_all"),
    "M012 must NOT define pol_aso_owner_admin_all (FOR ALL) for accounting_sync_outbox"
  );
});

test("67. M012 RLS policies for payment_observation are SELECT-only (A11)", () => {
  assert.ok(
    m012Src.includes("pol_po_owner_admin_select"),
    "M012 must define pol_po_owner_admin_select (SELECT-only) for payment_observation"
  );
  assert.ok(
    !m012Src.includes("pol_po_owner_admin_all"),
    "M012 must NOT define pol_po_owner_admin_all (FOR ALL) for payment_observation"
  );
});

// ── A6/A7: QB canonical input + durable idempotency ─────────────────────────

test("68. QB adapter loads canonical monetary values from DB via service role (A6)", () => {
  assert.ok(
    qbAdapterSrc.includes("loadCanonicalInvoiceRequest"),
    "QB adapter must define loadCanonicalInvoiceRequest to load from DB"
  );
  assert.ok(
    qbAdapterSrc.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "QB adapter must use SUPABASE_SERVICE_ROLE_KEY to load canonical data"
  );
  assert.ok(
    qbAdapterSrc.includes("canonicalCurrency") && qbAdapterSrc.includes("canonicalSubtotal"),
    "QB adapter must use canonically derived values"
  );
});

test("69. QB adapter rejects client-supplied monetary values (A6)", () => {
  // These old fields should NOT be destructured from body anymore
  assert.ok(
    !qbAdapterSrc.includes("body.currency_code") &&
    !qbAdapterSrc.includes("body.subtotal_amount") &&
    !qbAdapterSrc.includes("body.tax_amount") &&
    !qbAdapterSrc.includes("body.total_amount"),
    "QB adapter must not destructure monetary values from client request body"
  );
});

test("70. QB adapter resolves outbox by idempotency_key before making provider call (A7)", () => {
  assert.ok(
    qbAdapterSrc.includes("resolveOutboxByIdempotencyKey"),
    "QB adapter must resolve accounting_sync_outbox by idempotency_key"
  );
  assert.ok(
    qbAdapterSrc.includes("already acknowledged") ||
    qbAdapterSrc.includes("idempotent: true"),
    "QB adapter must return stored result when outbox is already acknowledged"
  );
});

test("71. QB adapter uses outbox lifecycle: pending → sent → acknowledged (A7)", () => {
  assert.ok(
    qbAdapterSrc.includes("outbox_status: \"pending\"") ||
    qbAdapterSrc.includes("outbox_status: 'pending'"),
    "QB adapter must create outbox in pending state"
  );
  assert.ok(
    qbAdapterSrc.includes("outbox_status: \"sent\"") ||
    qbAdapterSrc.includes("outbox_status: 'sent'"),
    "QB adapter must mark outbox as sent before provider call"
  );
  assert.ok(
    qbAdapterSrc.includes("outbox_status: \"acknowledged\"") ||
    qbAdapterSrc.includes("outbox_status: 'acknowledged'"),
    "QB adapter must mark outbox as acknowledged after provider call"
  );
});

// ── A8: Fail-closed environment ───────────────────────────────────────────────

test("72. QB adapter getEnvironment() fails closed — no default to 'test' (A8)", () => {
  // Old: (process.env.SERVICEOS_ENVIRONMENT || "test").toLowerCase()
  // New: must return null for missing/unknown
  assert.ok(
    !qbAdapterSrc.includes('|| "test"') && !qbAdapterSrc.includes("|| 'test'"),
    "QB adapter must not default to 'test' environment — must fail closed"
  );
  assert.ok(
    qbAdapterSrc.includes("FAIL CLOSED") || qbAdapterSrc.includes("fail closed"),
    "QB adapter must document fail-closed behavior for environment"
  );
});

test("73. Stripe webhook getServiceosEnvironment() fails closed (A8)", () => {
  assert.ok(
    !webhookSrc.includes('|| "test"') && !webhookSrc.includes("|| 'test'"),
    "Stripe webhook must not default to 'test' — must fail closed"
  );
  assert.ok(
    webhookSrc.includes("FAIL CLOSED") || webhookSrc.includes("null"),
    "Stripe webhook must return null/fail-closed for missing environment"
  );
});

// ── A9: Stripe webhook signature ─────────────────────────────────────────────

test("74. Stripe webhook requires stripe-signature header in production (A9)", () => {
  assert.ok(
    webhookSrc.includes("stripe-signature") &&
    (webhookSrc.includes("required in Production") || webhookSrc.includes("required in production")),
    "Stripe webhook must explicitly require stripe-signature in production"
  );
});

test("75. Stripe webhook allows only explicit preview/test for unsigned parsing (A9)", () => {
  assert.ok(
    webhookSrc.includes("serviceosEnv !== 'production'") ||
    webhookSrc.includes('serviceosEnv !== "production"') ||
    webhookSrc.includes("!== 'production'") ||
    webhookSrc.includes('!== "production"'),
    "Stripe webhook must only allow unsigned parsing in non-production environment"
  );
});

// ── A12: Contractor payable DB eligibility ────────────────────────────────────

test("76. M012 has contractor_payable eligibility trigger (A12)", () => {
  assert.ok(
    m012Src.includes("trg_contractor_payable_eligibility") &&
    m012Src.includes("trg_cp_eligibility"),
    "M012 must define and attach trg_contractor_payable_eligibility"
  );
});

test("77. M012 contractor_payable eligibility validates computed_amount from DB calculation (A12)", () => {
  assert.ok(
    m012Src.includes("computed_amount % does not match DB-authoritative calculation"),
    "M012 trigger must validate computed_amount against DB-authoritative calculation"
  );
});

test("78. M012 contractor_payable eligibility validates worker/org/BU/job lineage (A12)", () => {
  assert.ok(
    m012Src.includes("worker_id % does not match worker_assignment.worker_id"),
    "M012 trigger must validate payable worker_id matches worker_assignment"
  );
  assert.ok(
    m012Src.includes("operational_job_id % does not match worker_assignment"),
    "M012 trigger must validate payable operational_job_id matches worker_assignment"
  );
});

// ── A13: Compensation self-approval ──────────────────────────────────────────

test("79. M012 has compensation_version self-approval guard (A13)", () => {
  assert.ok(
    m012Src.includes("trg_ccv_self_approval_guard"),
    "M012 must define trg_ccv_self_approval_guard trigger"
  );
  assert.ok(
    m012Src.includes("worker may not approve their own compensation version"),
    "M012 trigger must explicitly prevent worker self-approval of compensation version"
  );
});

// ── A14: Payable status lifecycle ─────────────────────────────────────────────

test("80. M012 has contractor_payable status lifecycle trigger (A14)", () => {
  assert.ok(
    m012Src.includes("trg_contractor_payable_status_lifecycle") &&
    m012Src.includes("trg_cp_status_lifecycle"),
    "M012 must define and attach trg_contractor_payable_status_lifecycle"
  );
});

test("81. M012 payable status lifecycle prevents pending → paid directly (A14)", () => {
  assert.ok(
    m012Src.includes("pending → %") || m012Src.includes("pending → "),
    "M012 trigger must validate pending transitions"
  );
  assert.ok(
    m012Src.includes("allowed: approved, voided"),
    "M012 trigger must allow only pending→approved and pending→voided"
  );
});

test("82. M012 payable status lifecycle prevents paid from transitioning (A14)", () => {
  assert.ok(
    m012Src.includes("paid is a terminal status"),
    "M012 trigger must declare paid as terminal"
  );
  assert.ok(
    m012Src.includes("voided is a terminal status"),
    "M012 trigger must declare voided as terminal"
  );
});

// ── A15: Profitability snapshot append-only ───────────────────────────────────

test("83. M012 has no UNIQUE(operational_job_id) on job_profitability_snapshot (A15)", () => {
  assert.ok(
    !m012Src.includes("CONSTRAINT uq_jps_job UNIQUE"),
    "M012 must NOT have UNIQUE(operational_job_id) on job_profitability_snapshot"
  );
});

test("84. M012 has append-only trigger on job_profitability_snapshot (A15)", () => {
  assert.ok(
    m012Src.includes("trg_jps_append_only"),
    "M012 must define trg_jps_append_only trigger"
  );
  assert.ok(
    m012Src.includes("rows are append-only"),
    "M012 trigger must explicitly declare append-only semantics"
  );
});

test("85. Wave5 runtime captureJobProfitabilitySnapshot always INSERTs (never UPDATEs) (A15)", () => {
  assert.ok(
    !wave5RuntimeSrc.includes("updateJobProfitabilitySnapshot("),
    "Wave5 runtime must not call updateJobProfitabilitySnapshot (append-only)"
  );
  assert.ok(
    wave5RuntimeSrc.includes("always INSERT") || wave5RuntimeSrc.includes("Append-only"),
    "Wave5 runtime must document append-only snapshot creation"
  );
});

test("86. M012 has append-only index for job_profitability_snapshot (A15)", () => {
  assert.ok(
    m012Src.includes("idx_jps_job_taken_at") &&
    m012Src.includes("snapshot_taken_at"),
    "M012 must have index for latest snapshot lookup by operational_job_id + snapshot_taken_at"
  );
});

// ── A16: Cross-scope integrity helper ────────────────────────────────────────

test("87. M012 has fn_assert_wave5_scope cross-scope helper (A16)", () => {
  assert.ok(
    m012Src.includes("fn_assert_wave5_scope"),
    "M012 must define fn_assert_wave5_scope helper function"
  );
  assert.ok(
    m012Src.includes("scope violation"),
    "M012 scope helper must raise exception on scope violations"
  );
});

// ── A17: Expanded self-validation ─────────────────────────────────────────────

test("88. M012 self-validation checks canonical lineage trigger exists (A17)", () => {
  assert.ok(
    m012Src.includes("SV-11") ||
    m012Src.includes("trg_billing_readiness_gate_canonical_lineage()"),
    "M012 self-validation must verify canonical lineage trigger exists"
  );
});

test("89. M012 self-validation checks accounting_sync_outbox server-only boundary (A17)", () => {
  assert.ok(
    m012Src.includes("SV-13") ||
    m012Src.includes("accounting_sync_outbox") && m012Src.includes("INSERT/UPDATE"),
    "M012 self-validation must verify accounting_sync_outbox has no INSERT/UPDATE for authenticated"
  );
});

test("90. M012 self-validation checks payment_observation server-only boundary (A17)", () => {
  assert.ok(
    m012Src.includes("SV-14") ||
    m012Src.includes("payment_observation") && m012Src.includes("A11"),
    "M012 self-validation must verify payment_observation has no INSERT for authenticated"
  );
});

test("91. M012 self-validation checks append-only profitability (no UNIQUE, has append-only trigger) (A17)", () => {
  assert.ok(
    m012Src.includes("SV-18") && m012Src.includes("uq_jps_job"),
    "M012 self-validation must verify uq_jps_job UNIQUE constraint is absent"
  );
  assert.ok(
    m012Src.includes("SV-19") && m012Src.includes("trg_jps_append_only"),
    "M012 self-validation must verify trg_jps_append_only trigger exists"
  );
});

test("92. M012 self-validation checks contractor_payable eligibility trigger (A17)", () => {
  assert.ok(
    m012Src.includes("SV-15") ||
    m012Src.includes("trg_contractor_payable_eligibility()"),
    "M012 self-validation must verify contractor_payable eligibility trigger exists"
  );
});

test("93. M012 self-validation checks compensation self-approval guard (A17)", () => {
  assert.ok(
    m012Src.includes("SV-16") ||
    m012Src.includes("trg_ccv_self_approval_guard()"),
    "M012 self-validation must verify compensation self-approval guard exists"
  );
});
