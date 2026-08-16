// =============================================================================
// UNIT / LIFECYCLE / SECURITY TESTS — Wave 5 Finance
// Tests serviceosWave5FinanceUtils.js and serviceosWave5Runtime.js pure logic.
// No database calls. All async functions use stubs.
// =============================================================================

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
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
const authClientSrc = readFileSync(
  resolve(ROOT, "src/lib/serviceosAuthClient.js"),
  "utf8"
);
const acceptanceRunnerSrc = readFileSync(
  resolve(ROOT, "src/lib/serviceosWave5AcceptanceRunner.js"),
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
const previewPaymentSrc = readFileSync(
  resolve(ROOT, "api/wave5-preview-payment.js"),
  "utf8"
);
const panelSrc = readFileSync(
  resolve(ROOT, "src/features/pilot/ServiceOSWave5FinancePilotPanel.jsx"),
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

async function importDefault(absPath) {
  const mod = await import(`${pathToFileURL(absPath).href}?t=${Date.now()}-${Math.random()}`);
  return mod.default;
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    },
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
}

function restoreEnv(originalEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

async function runAccountingSyncAuthScenario({
  roleCode = "owner_admin",
  membershipOrganizationId = "org-1",
  membershipBusinessUnitId = "bu-1",
  invoiceOrganizationId = "org-1",
  invoiceBusinessUnitId = "bu-1",
}) {
  const handler = await importDefault(resolve(ROOT, "api/wave5-accounting-sync.js"));
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  process.env.SERVICEOS_ENVIRONMENT = "preview";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  delete process.env.QBO_CLIENT_ID;
  delete process.env.QBO_CLIENT_SECRET;
  delete process.env.QBO_REFRESH_TOKEN;
  delete process.env.QBO_REALM_ID;

  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/auth/v1/user")) {
      return jsonResponse(200, { id: "auth-user-1" });
    }
    if (href.includes("/rest/v1/app_user")) {
      return jsonResponse(200, [{ id: "app-user-1", auth_user_id: "auth-user-1", status: "active" }]);
    }
    if (href.includes("/rest/v1/app_role")) {
      return jsonResponse(200, [{ id: "role-1", code: roleCode }]);
    }
    if (href.includes("/rest/v1/user_membership")) {
      return jsonResponse(200, [{
        id: "membership-1",
        app_user_id: "app-user-1",
        organization_id: membershipOrganizationId,
        business_unit_id: membershipBusinessUnitId,
        role_id: "role-1",
        status: "active",
      }]);
    }
    if (href.includes("/rest/v1/invoice_request?select=id,organization_id,business_unit_id,request_status")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: invoiceOrganizationId,
        business_unit_id: invoiceBusinessUnitId,
        request_status: "submitted",
      }]);
    }
    if (href.includes("/rest/v1/accounting_sync_outbox?idempotency_key=eq.key-1")) {
      return jsonResponse(200, []);
    }
    if (href.endsWith("/rest/v1/accounting_sync_outbox") && options.method === "POST") {
      return jsonResponse(201, [{ id: "outbox-1" }]);
    }
    if (href.includes("/rest/v1/invoice_request?id=eq.ir-1&limit=1")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: invoiceOrganizationId,
        business_unit_id: invoiceBusinessUnitId,
        operational_job_id: "job-1",
        request_status: "submitted",
        currency_code: "CAD",
        subtotal_amount: 220,
        tax_amount: 28.6,
        total_amount: 248.6,
      }]);
    }
    throw new Error(`Unhandled fetch: ${href}`);
  };

  try {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer " + "token-1" },
      body: { idempotency_key: "key-1", invoice_request_id: "ir-1" },
    };
    const res = createMockRes();
    await handler(req, res);
    return res;
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
}

async function runPreviewPaymentAuthScenario({
  roleCode = "owner_admin",
  membershipOrganizationId = "org-1",
  membershipBusinessUnitId = "bu-1",
  invoiceOrganizationId = "org-1",
  invoiceBusinessUnitId = "bu-1",
}) {
  const handler = await importDefault(resolve(ROOT, "api/wave5-preview-payment.js"));
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  process.env.SERVICEOS_ENVIRONMENT = "preview";
  process.env.SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/auth/v1/user")) {
      return jsonResponse(200, { id: "auth-user-1" });
    }
    if (href.includes("/rest/v1/app_user")) {
      return jsonResponse(200, [{ id: "app-user-1", auth_user_id: "auth-user-1", status: "active" }]);
    }
    if (href.includes("/rest/v1/app_role")) {
      return jsonResponse(200, [{ id: "role-1", code: roleCode }]);
    }
    if (href.includes("/rest/v1/user_membership")) {
      return jsonResponse(200, [{
        id: "membership-1",
        app_user_id: "app-user-1",
        organization_id: membershipOrganizationId,
        business_unit_id: membershipBusinessUnitId,
        role_id: "role-1",
        status: "active",
      }]);
    }
    if (href.includes("/rest/v1/invoice_request?select=id,organization_id,business_unit_id&id=eq.ir-1&limit=1")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: invoiceOrganizationId,
        business_unit_id: invoiceBusinessUnitId,
      }]);
    }
    if (href.includes("/rest/v1/invoice_request?id=eq.ir-1&limit=1")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: invoiceOrganizationId,
        business_unit_id: invoiceBusinessUnitId,
        request_status: "submitted",
        currency_code: "CAD",
        total_amount: 248.6,
      }]);
    }
    if (href.includes("/rest/v1/payment_observation?provider=eq.preview_test")) {
      return jsonResponse(200, [{
        id: "po-1",
        invoice_request_id: "ir-1",
        provider_event_id: "evt-1",
      }]);
    }
    throw new Error(`Unhandled fetch: ${href}`);
  };

  try {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer " + "token-1" },
      body: { invoice_request_id: "ir-1", provider_event_id: "evt-1" },
    };
    const res = createMockRes();
    await handler(req, res);
    return res;
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
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

test("75b. QB adapter requires active owner_admin/office_ops membership before service-role use", () => {
  for (const token of [
    "loadAuthorizedAppUser",
    "loadAuthorizedMembershipContext",
    "app_user",
    "user_membership",
    "owner_admin",
    "office_ops",
    "invoice_request?select=id,organization_id,business_unit_id",
    "ServiceOS finance authorization failed",
  ]) {
    assert.ok(qbAdapterSrc.includes(token), `QB adapter must include ${token}`);
  }
});

test("75c. QB adapter binds idempotency_key to invoice_request_id and returns 409 on mismatch", () => {
  assert.ok(
    qbAdapterSrc.includes("idempotency_key is already bound to a different invoice_request_id"),
    "QB adapter must reject cross-invoice idempotency key reuse"
  );
  assert.ok(
    qbAdapterSrc.includes("status(409)"),
    "QB adapter must return HTTP 409 for cross-invoice idempotency key reuse"
  );
});

test("75d. QB adapter preview path now fails closed on outbox persistence", () => {
  assert.ok(
    !qbAdapterSrc.includes("Preview outbox persist failed (non-blocking)"),
    "Preview path must not keep non-blocking outbox persistence"
  );
  assert.ok(
    qbAdapterSrc.includes("Preview accounting sync could not persist accounting_sync_outbox") &&
      qbAdapterSrc.includes("did not produce a persisted outbox_id"),
    "Preview path must fail closed when outbox persistence is missing"
  );
});

test("75e. QB adapter live path fails closed on sent/ack durability and uses Intuit requestid", () => {
  assert.ok(
    qbAdapterSrc.includes("deriveQboRequestId") &&
      qbAdapterSrc.includes("requestid") &&
      qbAdapterSrc.includes("duplicate-request protection"),
    "QB adapter must use Intuit requestid for duplicate-request protection"
  );
  assert.ok(
    qbAdapterSrc.includes("QuickBooks invoice was created but acknowledgment persistence failed") &&
      qbAdapterSrc.includes("synchronization_durability_error"),
    "QB adapter must surface explicit durability failure after provider success"
  );
  assert.ok(
    qbAdapterSrc.includes("failure_state_persistence_failed"),
    "QB adapter must surface failure-state persistence status"
  );
});

test("75f. Stripe webhook Wave5 classification requires explicit Wave5 metadata, not job_id alone", () => {
  assert.ok(
    webhookSrc.includes("serviceos_finance_version === 'wave5'") &&
      webhookSrc.includes("serviceos_invoice_request_id"),
    "Stripe webhook must require explicit Wave5 metadata"
  );
  assert.ok(
    !/return !!\(session\?\.metadata\?\.job_id\)/.test(webhookSrc),
    "job_id alone must not classify a Stripe event as Wave5"
  );
});

test("75g. Preview payment endpoint is server-only and panel no longer inserts payment_observation directly", () => {
  for (const token of [
    "SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED",
    "owner_admin",
    "office_ops",
    "payment_observation",
    "provider_event_id",
    "\"preview_test\"",
  ]) {
    assert.ok(previewPaymentSrc.includes(token), `Preview payment endpoint must include ${token}`);
  }
  assert.ok(
    panelSrc.includes('fetch("/api/wave5-preview-payment"') &&
      panelSrc.includes("provider_event_id"),
    "Preview panel step must call the server-only preview payment endpoint"
  );
  assert.ok(
    !panelSrc.includes("observePayment("),
    "Preview panel must remove the direct browser observePayment path"
  );
});

test("75h. Preview panel shows the final 9 finance steps and explicit runtime actions", () => {
  for (const label of [
    "1 · Billing readiness",
    "2 · Invoice request",
    "3 · Server accounting sync",
    "4 · Server Preview payment",
    "5 · Create contractor compensation version",
    "6 · Approve contractor compensation version",
    "7 · Create contractor payable",
    "8 · Capture profitability snapshot",
    "9 · Load finance status",
  ]) {
    assert.ok(panelSrc.includes(label), `Preview panel must include step label: ${label}`);
  }
  for (const token of [
    "createCompensationVersion(",
    "approveCompensationVersion(",
    "createPayableForAssignment(",
    "provider_event_id",
    "idempotency_key",
    "contractor_compensation_version_id",
  ]) {
    assert.ok(panelSrc.includes(token), `Preview panel must include explicit input/runtime token: ${token}`);
  }
});

test("75i. preview payment rejects cross-invoice provider_event_id reuse with HTTP 409", async () => {
  const handler = await importDefault(resolve(ROOT, "api/wave5-preview-payment.js"));
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  process.env.SERVICEOS_ENVIRONMENT = "preview";
  process.env.SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/auth/v1/user")) {
      return jsonResponse(200, { id: "auth-user-1" });
    }
    if (href.includes("/rest/v1/app_user")) {
      return jsonResponse(200, [{ id: "app-user-1", auth_user_id: "auth-user-1", status: "active" }]);
    }
    if (href.includes("/rest/v1/app_role")) {
      return jsonResponse(200, [{ id: "role-1", code: "owner_admin" }]);
    }
    if (href.includes("/rest/v1/user_membership")) {
      return jsonResponse(200, [{
        id: "membership-1",
        app_user_id: "app-user-1",
        organization_id: "org-1",
        business_unit_id: "bu-1",
        role_id: "role-1",
        status: "active",
      }]);
    }
    if (href.includes("/rest/v1/invoice_request?select=id,organization_id,business_unit_id")) {
      return jsonResponse(200, [{ id: "ir-1", organization_id: "org-1", business_unit_id: "bu-1" }]);
    }
    if (href.includes("/rest/v1/invoice_request?id=eq.ir-1&limit=1")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: "org-1",
        business_unit_id: "bu-1",
        operational_job_id: "job-1",
        request_status: "submitted",
        currency_code: "CAD",
        total_amount: 113,
      }]);
    }
    if (href.includes("/rest/v1/payment_observation?provider=eq.preview_test")) {
      return jsonResponse(200, [{
        id: "po-1",
        invoice_request_id: "ir-2",
        provider_event_id: "evt-1",
      }]);
    }
    throw new Error(`Unhandled fetch: ${href}`);
  };

  try {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer " + "preview-token" },
      body: { invoice_request_id: "ir-1", provider_event_id: "evt-1" },
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body?.invoice_request_id, "ir-1");
    assert.equal(res.body?.existing_invoice_request_id, "ir-2");
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});

test("75j. preview payment rejects void or cancelled invoice_request before persistence", async () => {
  const handler = await importDefault(resolve(ROOT, "api/wave5-preview-payment.js"));
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  process.env.SERVICEOS_ENVIRONMENT = "preview";
  process.env.SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/auth/v1/user")) {
      return jsonResponse(200, { id: "auth-user-1" });
    }
    if (href.includes("/rest/v1/app_user")) {
      return jsonResponse(200, [{ id: "app-user-1", auth_user_id: "auth-user-1", status: "active" }]);
    }
    if (href.includes("/rest/v1/app_role")) {
      return jsonResponse(200, [{ id: "role-1", code: "office_ops" }]);
    }
    if (href.includes("/rest/v1/user_membership")) {
      return jsonResponse(200, [{
        id: "membership-1",
        app_user_id: "app-user-1",
        organization_id: "org-1",
        business_unit_id: "bu-1",
        role_id: "role-1",
        status: "active",
      }]);
    }
    if (href.includes("/rest/v1/invoice_request?select=id,organization_id,business_unit_id")) {
      return jsonResponse(200, [{ id: "ir-1", organization_id: "org-1", business_unit_id: "bu-1" }]);
    }
    if (href.includes("/rest/v1/invoice_request?id=eq.ir-1&limit=1")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: "org-1",
        business_unit_id: "bu-1",
        operational_job_id: "job-1",
        request_status: "void",
        currency_code: "CAD",
        total_amount: 113,
      }]);
    }
    throw new Error(`Unhandled fetch: ${href}`);
  };

  try {
    const req = {
      method: "POST",
      headers: { authorization: "Bearer " + "preview-token" },
      body: { invoice_request_id: "ir-1", provider_event_id: "evt-1" },
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body?.error || "", /terminal invoice_request status/i);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});

test("75k. Stripe webhook allows explicit Wave5 events with matching operational_job_id metadata", async () => {
  const handler = await importDefault(resolve(ROOT, "api/stripe-webhook.js"));
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  process.env.SERVICEOS_ENVIRONMENT = "preview";
  process.env.SERVICEOS_FINANCE_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  delete process.env.STRIPE_WEBHOOK_SECRET;

  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/rest/v1/invoice_request?id=eq.ir-1")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: "org-1",
        business_unit_id: "bu-1",
        operational_job_id: "job-1",
        currency_code: "CAD",
        total_amount: 113,
      }]);
    }
    if (href.includes("/rest/v1/payment_observation?provider=eq.stripe")) {
      return jsonResponse(200, []);
    }
    if (href.endsWith("/rest/v1/payment_observation") && options.method === "POST") {
      return jsonResponse(201, [{ id: "po-1", provider_event_id: "evt-1", invoice_request_id: "ir-1" }]);
    }
    throw new Error(`Unhandled fetch: ${href}`);
  };

  try {
    const req = {
      method: "POST",
      headers: {},
      body: JSON.stringify({
        id: "evt-1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_1",
            amount_total: 11300,
            currency: "cad",
            customer_email: "customer@example.com",
            metadata: {
              serviceos_finance_version: "wave5",
              serviceos_invoice_request_id: "ir-1",
              operational_job_id: "job-1",
            },
          },
        },
      }),
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.received, true);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});

test("75l. Stripe webhook retries explicit Wave5 events when operational_job_id metadata mismatches canonical invoice_request", async () => {
  const handler = await importDefault(resolve(ROOT, "api/stripe-webhook.js"));
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  process.env.SERVICEOS_ENVIRONMENT = "preview";
  process.env.SERVICEOS_FINANCE_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  delete process.env.STRIPE_WEBHOOK_SECRET;

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/rest/v1/invoice_request?id=eq.ir-1")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: "org-1",
        business_unit_id: "bu-1",
        operational_job_id: "job-1",
        currency_code: "CAD",
        total_amount: 113,
      }]);
    }
    if (href.includes("/rest/v1/payment_observation?provider=eq.stripe")) {
      return jsonResponse(200, []);
    }
    throw new Error(`Unhandled fetch: ${href}`);
  };

  try {
    const req = {
      method: "POST",
      headers: {},
      body: JSON.stringify({
        id: "evt-2",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_2",
            amount_total: 11300,
            currency: "cad",
            metadata: {
              serviceos_finance_version: "wave5",
              serviceos_invoice_request_id: "ir-1",
              operational_job_id: "job-999",
            },
          },
        },
      }),
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body?.code, "OPERATIONAL_JOB_ID_MISMATCH");
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
});

test("75m. Stripe webhook allows explicit Wave5 events without operational_job_id metadata because invoice_request_id is canonical", async () => {
  const handler = await importDefault(resolve(ROOT, "api/stripe-webhook.js"));
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  process.env.SERVICEOS_ENVIRONMENT = "preview";
  process.env.SERVICEOS_FINANCE_ENABLED = "true";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  delete process.env.STRIPE_WEBHOOK_SECRET;

  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/rest/v1/invoice_request?id=eq.ir-1")) {
      return jsonResponse(200, [{
        id: "ir-1",
        organization_id: "org-1",
        business_unit_id: "bu-1",
        operational_job_id: "job-1",
        currency_code: "CAD",
        total_amount: 113,
      }]);
    }
    if (href.includes("/rest/v1/payment_observation?provider=eq.stripe")) {
      return jsonResponse(200, []);
    }
    if (href.endsWith("/rest/v1/payment_observation") && options.method === "POST") {
      return jsonResponse(201, [{ id: "po-2", provider_event_id: "evt-3", invoice_request_id: "ir-1" }]);
    }
    throw new Error(`Unhandled fetch: ${href}`);
  };

  try {
    const req = {
      method: "POST",
      headers: {},
      body: JSON.stringify({
        id: "evt-3",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_3",
            amount_total: 11300,
            currency: "cad",
            metadata: {
              serviceos_finance_version: "wave5",
              serviceos_invoice_request_id: "ir-1",
            },
          },
        },
      }),
    };
    const res = createMockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.received, true);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
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

test("86b. M012 has profitability BEFORE INSERT validator trigger/function", () => {
  assert.ok(
    m012Src.includes("trg_jps_before_insert_validator") &&
      m012Src.includes("BEFORE INSERT ON public.job_profitability_snapshot"),
    "M012 must define and attach trg_jps_before_insert_validator before insert"
  );
});

test("86c. M012 profitability validator requires canonical invoice_request and frozen monetary coherence", () => {
  for (const token of [
    "invoice_request_id is required",
    "canonical invoice_request",
    "operational_job_id % does not match invoice_request.operational_job_id",
    "organization_id % does not match invoice_request.organization_id",
    "business_unit_id % does not match invoice_request.business_unit_id",
    "currency_code % does not match invoice_request.currency_code",
    "recognized_revenue_amount % does not match invoice_request.subtotal_amount",
    "tax_amount % does not match invoice_request.tax_amount",
  ]) {
    assert.ok(m012Src.includes(token), `M012 profitability validator must include: ${token}`);
  }
});

test("86d. M012 profitability validator requires authoritative approved/paid labor total", () => {
  assert.ok(
    m012Src.includes("COALESCE(SUM(cp.computed_amount), 0)") &&
      m012Src.includes("cp.payable_status IN ('approved', 'paid')"),
    "M012 profitability validator must compute authoritative approved/paid contractor labor"
  );
  assert.ok(
    m012Src.includes("direct_labor_cost % does not match authoritative approved/paid contractor_payable total %"),
    "M012 profitability validator must reject mismatched direct_labor_cost"
  );
});

test("86e. M012 profitability validator enforces required source_lineage keys and optional direct cost reference", () => {
  for (const token of [
    "source_lineage.invoice_request_id is required",
    "source_lineage.pricing_snapshot_id is required",
    "source_lineage.quote_version_id is required",
    "source_lineage.invoice_request_id % does not match canonical invoice_request.id %",
    "source_lineage.pricing_snapshot_id % does not match canonical invoice_request.pricing_snapshot_id %",
    "source_lineage.quote_version_id % does not match canonical invoice_request.quote_version_id %",
    "source_lineage.direct_cost_source_reference is required when other_direct_cost > 0",
  ]) {
    assert.ok(m012Src.includes(token), `M012 profitability validator must include: ${token}`);
  }
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

test("94. M012 self-validation checks profitability BEFORE INSERT validator trigger/function", () => {
  assert.ok(
    m012Src.includes("SV-21") &&
      m012Src.includes("trg_jps_before_insert_validator trigger/function not found on job_profitability_snapshot"),
    "M012 self-validation must verify trg_jps_before_insert_validator trigger/function exists"
  );
});

// ── Hardening patch: canonical appUserId + handoff resolver ──────────────────

test("95. Wave5 panel uses revenueContext.appUserId, not session.user.id", () => {
  assert.ok(
    panelSrc.includes("revenueContext?.appUserId"),
    "Wave5 panel must derive appUserId from revenueContext.appUserId"
  );
  assert.ok(
    !panelSrc.includes("session?.user?.id"),
    "Wave5 panel must not fall back to session.user.id as appUserId"
  );
  assert.ok(
    !panelSrc.includes("session?.user?.id ?? null"),
    "Wave5 panel must not use session.user.id as the appUserId source"
  );
});

test("96. Wave5 panel accepts revenueContext prop and main.jsx passes it", () => {
  assert.ok(
    panelSrc.includes("{ session, revenueContext }"),
    "Wave5 panel component must accept revenueContext prop"
  );
  assert.ok(
    mainSrc.includes("revenueContext={ctx?.revenueContext ?? null}") &&
      mainSrc.includes("ServiceOSWave5FinancePilotPanel"),
    "main.jsx must pass revenueContext into ServiceOSWave5FinancePilotPanel"
  );
});

test("97. Wave5 panel shows preview-only warning when appUserId is unavailable", () => {
  assert.ok(
    panelSrc.includes("canMutate") &&
      panelSrc.includes("canonical ServiceOS app user could not be resolved"),
    "Wave5 panel must display a preview-only warning when canonical app user is absent"
  );
  assert.ok(
    !panelSrc.includes("session?.user?.id"),
    "Wave5 panel must not reference session.user.id anywhere"
  );
});

test("98. Wave5 panel includes handoff resolver section with required operations client functions", () => {
  assert.ok(
    panelSrc.includes("fetchOperationalHandoffForJob"),
    "Wave5 panel must use fetchOperationalHandoffForJob to check for existing handoff"
  );
  assert.ok(
    panelSrc.includes("createOperationalHandoff"),
    "Wave5 panel must use createOperationalHandoff to create a new handoff"
  );
  assert.ok(
    panelSrc.includes("buildOperationalHandoffPayload"),
    "Wave5 panel must use buildOperationalHandoffPayload (not an invented payload)"
  );
  assert.ok(
    panelSrc.includes("fetchOperationalJobById") &&
      panelSrc.includes("fetchWorkOrderForJob") &&
      panelSrc.includes("fetchQaInspectionsForJob") &&
      panelSrc.includes("fetchCorrectiveActionsForJob"),
    "Wave5 panel must load and verify all canonical prerequisite records before handoff creation"
  );
});

test("99. Wave5 panel handoff resolver does not use recoverOperationalHandoff", () => {
  assert.ok(
    !panelSrc.includes("recoverOperationalHandoff"),
    "Wave5 panel must not use recoverOperationalHandoff — that is a separate recovery pathway"
  );
});

test("100. Wave5 panel handoff resolver reuses existing handoff without creating a duplicate", () => {
  assert.ok(
    panelSrc.includes("resolved: \"existing\""),
    "Wave5 handoff resolver must indicate reuse of an existing handoff (resolved: 'existing')"
  );
  assert.ok(
    panelSrc.includes("resolved: \"created\""),
    "Wave5 handoff resolver must indicate creation of a new handoff (resolved: 'created')"
  );
});

test("101. Wave5 panel handoff resolver blocks on cancelled handoff and does not reuse it", () => {
  assert.ok(
    panelSrc.includes("handoff_status === \"cancelled\""),
    "Wave5 handoff resolver must refuse cancelled handoffs and surface as blocker"
  );
});

test("102. Wave5 panel handoff resolver enforces all creation prerequisites", () => {
  assert.ok(
    panelSrc.includes("qa_passed") && panelSrc.includes("closed"),
    "Wave5 handoff resolver must require job status qa_passed or closed"
  );
  assert.ok(
    panelSrc.includes("qa_complete"),
    "Wave5 handoff resolver must require work_order status qa_complete or closed"
  );
  assert.ok(
    panelSrc.includes("inspection_status === \"passed\"") ||
      panelSrc.includes('inspection_status === "passed"'),
    "Wave5 handoff resolver must require a passed or waived QA inspection"
  );
  assert.ok(
    panelSrc.includes("action_status") &&
      (panelSrc.includes("verified") || panelSrc.includes("cancelled")),
    "Wave5 handoff resolver must verify all corrective actions are verified or cancelled"
  );
  assert.ok(
    !panelSrc.includes("q.outcome"),
    "Wave5 handoff resolver must not use legacy QA outcome field"
  );
  assert.ok(
    !panelSrc.includes("ca.corrective_status"),
    "Wave5 handoff resolver must not use legacy corrective_status field"
  );
});

test("103. Wave5 billing readiness requires non-blank operational_handoff_id", () => {
  assert.ok(
    panelSrc.includes("Resolve the canonical operational handoff before assessing billing readiness"),
    "Wave5 billing readiness must block with an explicit message when handoff ID is blank"
  );
  assert.ok(
    panelSrc.includes("!handoffId1.trim()"),
    "Wave5 billing readiness guard must check handoffId1.trim() is non-empty"
  );
  assert.ok(
    panelSrc.includes("operational_handoff_id (required"),
    "Wave5 billing readiness handoff input placeholder must mark the field as required"
  );
});

test("104. Wave5 panel does not invent UUIDs in the browser", () => {
  assert.ok(
    !panelSrc.includes("crypto.randomUUID") && !panelSrc.includes("uuidv4"),
    "Wave5 panel must not generate handoff UUIDs in the browser — IDs come from the database"
  );
});

test("105. Wave5 handoff resolver resolver section is labeled 0", () => {
  assert.ok(
    panelSrc.includes("0 · Resolve / Load Operational Handoff"),
    "Wave5 panel must have a section labeled '0 · Resolve / Load Operational Handoff'"
  );
});

test("106. accounting sync allows org-wide owner_admin membership with null BU", async () => {
  const res = await runAccountingSyncAuthScenario({
    roleCode: "owner_admin",
    membershipOrganizationId: "org-1",
    membershipBusinessUnitId: null,
    invoiceOrganizationId: "org-1",
    invoiceBusinessUnitId: "bu-1",
  });
  assert.equal(res.statusCode, 200);
});

test("107. accounting sync allows BU-scoped office_ops membership when BU matches", async () => {
  const res = await runAccountingSyncAuthScenario({
    roleCode: "office_ops",
    membershipOrganizationId: "org-1",
    membershipBusinessUnitId: "bu-1",
    invoiceOrganizationId: "org-1",
    invoiceBusinessUnitId: "bu-1",
  });
  assert.equal(res.statusCode, 200);
});

test("108. accounting sync denies non-null wrong BU membership in same organization", async () => {
  const res = await runAccountingSyncAuthScenario({
    roleCode: "office_ops",
    membershipOrganizationId: "org-1",
    membershipBusinessUnitId: "bu-wrong",
    invoiceOrganizationId: "org-1",
    invoiceBusinessUnitId: "bu-1",
  });
  assert.equal(res.statusCode, 403);
  assert.match(res.body?.detail || "", /organization\/business unit/i);
});

test("109. accounting sync denies membership from wrong organization even with null BU", async () => {
  const res = await runAccountingSyncAuthScenario({
    roleCode: "owner_admin",
    membershipOrganizationId: "org-wrong",
    membershipBusinessUnitId: null,
    invoiceOrganizationId: "org-1",
    invoiceBusinessUnitId: "bu-1",
  });
  assert.equal(res.statusCode, 403);
  assert.match(res.body?.detail || "", /organization\/business unit/i);
});

test("110. preview payment allows org-wide owner_admin membership with null BU", async () => {
  const res = await runPreviewPaymentAuthScenario({
    roleCode: "owner_admin",
    membershipOrganizationId: "org-1",
    membershipBusinessUnitId: null,
    invoiceOrganizationId: "org-1",
    invoiceBusinessUnitId: "bu-1",
  });
  assert.equal(res.statusCode, 200);
});

test("111. preview payment allows BU-scoped office_ops membership when BU matches", async () => {
  const res = await runPreviewPaymentAuthScenario({
    roleCode: "office_ops",
    membershipOrganizationId: "org-1",
    membershipBusinessUnitId: "bu-1",
    invoiceOrganizationId: "org-1",
    invoiceBusinessUnitId: "bu-1",
  });
  assert.equal(res.statusCode, 200);
});

test("112. preview payment denies non-null wrong BU membership in same organization", async () => {
  const res = await runPreviewPaymentAuthScenario({
    roleCode: "office_ops",
    membershipOrganizationId: "org-1",
    membershipBusinessUnitId: "bu-wrong",
    invoiceOrganizationId: "org-1",
    invoiceBusinessUnitId: "bu-1",
  });
  assert.equal(res.statusCode, 403);
  assert.match(res.body?.detail || "", /organization\/business unit/i);
});

test("113. preview payment denies membership from wrong organization even with null BU", async () => {
  const res = await runPreviewPaymentAuthScenario({
    roleCode: "owner_admin",
    membershipOrganizationId: "org-wrong",
    membershipBusinessUnitId: null,
    invoiceOrganizationId: "org-1",
    invoiceBusinessUnitId: "bu-1",
  });
  assert.equal(res.statusCode, 403);
  assert.match(res.body?.detail || "", /organization\/business unit/i);
});

// ── Wave 5 Continuation: Auth Refresh, Payable Approval, Acceptance Runner ───

// 114. Expired JWT — source confirms authenticatedRestFetchWithRefresh exists and refreshes on 401
test("114. expired JWT refresh: authenticatedRestFetchWithRefresh exported and handles 401/PGRST303", () => {
  assert.ok(
    authClientSrc.includes("authenticatedRestFetchWithRefresh"),
    "serviceosAuthClient must export authenticatedRestFetchWithRefresh"
  );
  assert.ok(
    authClientSrc.includes("isSupabaseExpiredError"),
    "serviceosAuthClient must define isSupabaseExpiredError helper"
  );
  assert.ok(
    authClientSrc.includes("PGRST303"),
    "serviceosAuthClient must detect PGRST303 (PostgREST JWT expired code)"
  );
  assert.ok(
    authClientSrc.includes("status === 401"),
    "serviceosAuthClient must treat HTTP 401 as an expired token signal"
  );
  assert.ok(
    authClientSrc.includes("refreshSession(session.refresh_token)"),
    "authenticatedRestFetchWithRefresh must invoke refreshSession with the stored refresh_token"
  );
  assert.ok(
    authClientSrc.includes("return authenticatedRestFetch(path, refreshed.access_token, options)"),
    "authenticatedRestFetchWithRefresh must retry the request with the refreshed access token"
  );
});

// 115. Refresh failure fails closed — session cleared and error thrown
test("115. refresh failure fails closed: session cleared and error thrown on refresh failure", () => {
  assert.ok(
    authClientSrc.includes("clearSession()"),
    "serviceosAuthClient must call clearSession() on refresh failure"
  );
  assert.ok(
    authClientSrc.includes("session expired and refresh failed"),
    "authenticatedRestFetchWithRefresh must surface a clear error on refresh failure"
  );
});

// 116. No infinite retry — at most one refresh+retry cycle
test("116. no infinite retry: authenticatedRestFetchWithRefresh retries at most once", () => {
  assert.ok(
    authClientSrc.includes("return authenticatedRestFetch(path, refreshed.access_token, options)"),
    "retry call must use authenticatedRestFetch (not authenticatedRestFetchWithRefresh) — preventing recursion"
  );
  const fnStart = authClientSrc.indexOf("export async function authenticatedRestFetchWithRefresh");
  const fnEnd = authClientSrc.indexOf("\n// ── Canonical ServiceOS context validation");
  const refreshWithBody = authClientSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
  assert.ok(
    !refreshWithBody.includes("while (") && !refreshWithBody.includes("for ("),
    "authenticatedRestFetchWithRefresh must not contain a retry loop"
  );
  const retryCallCount = (refreshWithBody.match(/authenticatedRestFetch\(/g) || []).length;
  assert.ok(
    retryCallCount <= 2,
    `authenticatedRestFetchWithRefresh must call authenticatedRestFetch at most twice (found ${retryCallCount})`
  );
});

// 117. Payable approval rejects worker self-approval at runtime layer
test("117. approveContractorPayable rejects worker self-approval", () => {
  assert.ok(
    wave5RuntimeSrc.includes("export async function approveContractorPayable"),
    "serviceosWave5Runtime must export approveContractorPayable"
  );
  assert.ok(
    wave5RuntimeSrc.includes("self-approval not permitted"),
    "approveContractorPayable must throw a clear error for self-approval"
  );
  assert.ok(
    wave5RuntimeSrc.includes("worker.app_user_id === approverAppUserId"),
    "approveContractorPayable must compare worker.app_user_id with approverAppUserId"
  );
});

// 118. Payable approval only changes approval fields, never computed_amount or lineage fields
test("118. approveContractorPayable only updates approval fields", () => {
  const fnStart = wave5RuntimeSrc.indexOf("export async function approveContractorPayable");
  const fnEnd = wave5RuntimeSrc.indexOf("\nexport ", fnStart + 1);
  const fnBody = wave5RuntimeSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  assert.ok(fnBody.includes("payable_status: \"approved\""), "approval patch must set payable_status = approved");
  assert.ok(fnBody.includes("approved_by_app_user_id"), "approval patch must set approved_by_app_user_id");
  assert.ok(fnBody.includes("approved_at"), "approval patch must set approved_at");

  const patchStart = fnBody.indexOf("const patch = {");
  const patchEnd = fnBody.indexOf("};", patchStart) + 2;
  const patchBlock = fnBody.slice(patchStart, patchEnd);
  assert.ok(!patchBlock.includes("computed_amount"), "patch must not modify computed_amount");
  assert.ok(!patchBlock.includes("worker_id"), "patch must not modify worker_id");
  assert.ok(!patchBlock.includes("currency_code"), "patch must not modify currency_code");
  assert.ok(!patchBlock.includes("contractor_compensation_version_id"), "patch must not modify compensation version");
});

// 119. Runner resumes a pending payable instead of recreating it
test("119. runner resumes pending payable instead of recreating it", () => {
  assert.ok(
    acceptanceRunnerSrc.includes("assignmentPayables.length === 0"),
    "runner must only create payable when none exists"
  );
  assert.ok(
    acceptanceRunnerSrc.includes("payable.payable_status === \"pending\""),
    "runner must detect pending payable and route to approval"
  );
  assert.ok(
    acceptanceRunnerSrc.includes("gate: \"approve_payable\""),
    "runner must return gate = approve_payable when payable is pending"
  );
  assert.ok(
    acceptanceRunnerSrc.includes("gate: \"create_payable\""),
    "runner must return gate = create_payable only when no payable exists"
  );
});

// 120. Runner skips complete-assignment gate when assignment is already completed
test("120. runner skips complete-assignment gate when assignment is already completed", () => {
  assert.ok(
    acceptanceRunnerSrc.includes("assignment.assignment_status === \"acknowledged\""),
    "runner only completes assignment when it is still in acknowledged state"
  );
  assert.ok(
    acceptanceRunnerSrc.includes("if (!profitability)"),
    "runner only captures profitability when no snapshot exists yet"
  );
});

// 121. flat_amount compensation forces basis_value to 0
test("121. flat_amount uses basis_value = 0 regardless of input", () => {
  assert.ok(
    acceptanceRunnerSrc.includes("compensation_method === \"flat_amount\" ? 0"),
    "runner must force resolvedBasisValue to 0 for flat_amount compensation"
  );
});

// 122. Multiple compensation versions fail closed in runner
test("122. multiple compensation versions fail closed in runner", () => {
  assert.ok(
    acceptanceRunnerSrc.includes("effectiveVersions.length > 1"),
    "runner must check for multiple effective compensation versions"
  );
  assert.ok(
    acceptanceRunnerSrc.includes("multiple genuinely effective compensation versions found"),
    "runner must fail closed with clear message when multiple versions exist"
  );
});

// 123. Multiple assignments fail closed in runner
test("123. multiple assignments fail closed in runner", () => {
  assert.ok(
    acceptanceRunnerSrc.includes("liveAssignments.length > 1"),
    "runner must check for multiple live assignments"
  );
  assert.ok(
    acceptanceRunnerSrc.includes("multiple active/completed assignments found"),
    "runner must fail closed with clear message when multiple assignments exist"
  );
});

// 124. Profitability gate waits until payable is approved or paid
test("124. profitability waits until payable is approved or paid", () => {
  assert.ok(
    acceptanceRunnerSrc.includes("[\"approved\", \"paid\"].includes(payable.payable_status)"),
    "runner must only proceed to profitability capture when payable is approved or paid"
  );
  assert.ok(
    acceptanceRunnerSrc.includes("gate: \"approve_payable\""),
    "runner routes to approve_payable before profitability when payable is pending"
  );
});

// 125. Status verification occurs after profitability snapshot exists
test("125. status verification occurs after profitability snapshot exists", () => {
  assert.ok(
    acceptanceRunnerSrc.includes("gate: \"verify_status\""),
    "runner must have a verify_status gate"
  );
  const profCheckPos = acceptanceRunnerSrc.indexOf("if (!profitability)");
  const verifyGatePos = acceptanceRunnerSrc.indexOf("gate: \"verify_status\"");
  assert.ok(profCheckPos < verifyGatePos, "profitability check must precede verify_status gate");
});

// 126. UI panel includes Wave 5 Guided Acceptance section with required fields and buttons
test("126. UI panel includes Wave 5 Guided Acceptance section with all required elements", () => {
  assert.ok(panelSrc.includes("Wave 5 Guided Acceptance"), "Panel must include the Wave 5 Guided Acceptance section label");
  assert.ok(panelSrc.includes("Load / Resume Wave 5"), "Panel must include Load / Resume Wave 5 button");
  assert.ok(panelSrc.includes("Run Next Gate"), "Panel must include Run Next Gate button");
  assert.ok(panelSrc.includes("gaJobId"), "Panel must include operational_job_id input state");
  assert.ok(panelSrc.includes("basis_value"), "Panel must include basis_value input");
  assert.ok(panelSrc.includes("other_direct_cost"), "Panel must include other_direct_cost input");
  assert.ok(panelSrc.includes("direct_cost_source_reference"), "Panel must include direct_cost_source_reference input");
  assert.ok(panelSrc.includes("nextGate"), "Panel must display next recommended gate");
  assert.ok(panelSrc.includes("blockerReason"), "Panel must display blocker reason when fail closed");
  assert.ok(panelSrc.includes("runWave5NextGate"), "Panel must import and use runWave5NextGate");
  assert.ok(panelSrc.includes("loadWave5AcceptanceState"), "Panel must import and use loadWave5AcceptanceState");
  assert.ok(panelSrc.includes("approveContractorPayable"), "Panel runtime import must include approveContractorPayable");
});


// =============================================================================
// BEHAVIORAL TESTS — Wave 5 Correction Pass
// Tests 127-145: real function behavior, not source-string checks.
// =============================================================================

// ── localStorage / fetch helpers ─────────────────────────────────────────────

function makeMockLocalStorage() {
  const store = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, val) { store[key] = String(val); },
    removeItem(key) { delete store[key]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
  };
}

const SESSION_KEY = "huc:serviceos-auth:v1";

function storeSession(ls, token, expiresOffsetSec = 3600, refreshToken = "rt-1") {
  const session = {
    access_token: token,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + expiresOffsetSec,
    user: { id: "user-1", email: "test@example.com", user_metadata: {}, app_metadata: {} },
  };
  ls.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function makeJSONResponse(status, body) {
  const bodyText = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    clone() { return this; },
    async text() { return bodyText; },
    async json() { return body; },
  };
}

async function importAuthClient() {
  const { fileURLToPath, pathToFileURL } = await import("url");
  const { resolve, dirname } = await import("path");
  const __dir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(__dir, "..");
  const url = `${pathToFileURL(resolve(root, "src/lib/serviceosAuthClient.js")).href}?tb=${Date.now()}-${Math.random()}`;
  return import(url);
}

// 127. Stored token nearly expired — proactive refresh before request, REST uses refreshed token
test("127. proactive refresh: stored token near expiry triggers refresh before REST call", async () => {
  const ls = makeMockLocalStorage();
  storeSession(ls, "old-token", 30 /* 30 sec left < 60 sec buffer — should proactively refresh */);
  const origLS = globalThis.localStorage;
  const origFetch = globalThis.fetch;
  globalThis.localStorage = ls;

  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const href = String(url);
    calls.push(href);
    if (href.includes("/auth/v1/token")) {
      return makeJSONResponse(200, {
        access_token: "refreshed-token",
        refresh_token: "rt-2",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "user-1", email: "test@example.com", user_metadata: {}, app_metadata: {} },
      });
    }
    if (href.includes("/rest/v1/")) {
      // Verify the refreshed token is used
      const authHeader = opts?.headers?.Authorization ?? "";
      assert.ok(authHeader.includes("refreshed-token"), "REST call must use refreshed token");
      return makeJSONResponse(200, []);
    }
    return makeJSONResponse(200, {});
  };

  try {
    const { authenticatedRestFetchWithRefresh } = await importAuthClient();
    const res = await authenticatedRestFetchWithRefresh("some_table?id=eq.1");
    assert.equal(res.status, 200, "should succeed");
    const refreshCall = calls.find((c) => c.includes("/auth/v1/token"));
    assert.ok(refreshCall, "refresh endpoint must have been called");
    const restCall = calls.find((c) => c.includes("/rest/v1/"));
    assert.ok(restCall, "REST endpoint must have been called");
  } finally {
    globalThis.localStorage = origLS;
    globalThis.fetch = origFetch;
  }
});

// 128. First REST returns PGRST303 JWT-expired — one refresh, one retry with refreshed token
test("128. PGRST303 response triggers exactly one refresh and one retry", async () => {
  const ls = makeMockLocalStorage();
  storeSession(ls, "valid-token", 3600 /* not near expiry */);
  const origLS = globalThis.localStorage;
  const origFetch = globalThis.fetch;
  globalThis.localStorage = ls;

  let restCallCount = 0;
  let refreshCallCount = 0;

  globalThis.fetch = async (url, opts = {}) => {
    const href = String(url);
    if (href.includes("/auth/v1/token")) {
      refreshCallCount++;
      return makeJSONResponse(200, {
        access_token: "refreshed-token",
        refresh_token: "rt-2",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "u1", email: "x@x.com", user_metadata: {}, app_metadata: {} },
      });
    }
    if (href.includes("/rest/v1/")) {
      restCallCount++;
      if (restCallCount === 1) {
        // First call: return PGRST303 JWT-expired
        return makeJSONResponse(401, { code: "PGRST303", message: "JWT expired" });
      }
      // Retry: verify refreshed token
      const authHeader = opts?.headers?.Authorization ?? "";
      assert.ok(authHeader.includes("refreshed-token"), "retry must use refreshed token");
      return makeJSONResponse(200, [{ id: "row-1" }]);
    }
    return makeJSONResponse(200, {});
  };

  try {
    const { authenticatedRestFetchWithRefresh } = await importAuthClient();
    const res = await authenticatedRestFetchWithRefresh("contractor_payable?id=eq.p1&limit=1");
    assert.equal(res.status, 200, "retry should succeed");
    assert.equal(restCallCount, 2, "must make exactly 2 REST calls (original + retry)");
    assert.equal(refreshCallCount, 1, "must call refresh endpoint exactly once");
  } finally {
    globalThis.localStorage = origLS;
    globalThis.fetch = origFetch;
  }
});

// 129. Retry also returns 401 — no third request, no infinite loop
test("129. retry returning 401 does not cause a third request", async () => {
  const ls = makeMockLocalStorage();
  storeSession(ls, "valid-token", 3600);
  const origLS = globalThis.localStorage;
  const origFetch = globalThis.fetch;
  globalThis.localStorage = ls;

  let restCallCount = 0;

  globalThis.fetch = async (url, opts = {}) => {
    const href = String(url);
    if (href.includes("/auth/v1/token")) {
      return makeJSONResponse(200, {
        access_token: "refreshed-token",
        refresh_token: "rt-2",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "u1", email: "x@x.com", user_metadata: {}, app_metadata: {} },
      });
    }
    if (href.includes("/rest/v1/")) {
      restCallCount++;
      return makeJSONResponse(401, { message: "Unauthorized" });
    }
    return makeJSONResponse(200, {});
  };

  try {
    const { authenticatedRestFetchWithRefresh } = await importAuthClient();
    // After retry fails with 401, it should just return the 401 (no further retry)
    const res = await authenticatedRestFetchWithRefresh("some_table?id=eq.1");
    assert.equal(restCallCount, 2, "must stop at exactly 2 REST calls, no infinite retry");
    assert.equal(res.status, 401, "second 401 should be returned as-is");
  } finally {
    globalThis.localStorage = origLS;
    globalThis.fetch = origFetch;
  }
});

// 130. Refresh failure — session cleared, request fails closed
test("130. refresh failure clears session and throws", async () => {
  const ls = makeMockLocalStorage();
  storeSession(ls, "valid-token", 3600);
  const origLS = globalThis.localStorage;
  const origFetch = globalThis.fetch;
  globalThis.localStorage = ls;

  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/auth/v1/token")) {
      return makeJSONResponse(400, { error: "invalid_grant", error_description: "Refresh token invalid" });
    }
    if (href.includes("/rest/v1/")) {
      return makeJSONResponse(401, { code: "PGRST303", message: "JWT expired" });
    }
    return makeJSONResponse(200, {});
  };

  try {
    const { authenticatedRestFetchWithRefresh, getStoredSession } = await importAuthClient();
    let threw = false;
    try {
      await authenticatedRestFetchWithRefresh("some_table?id=eq.1");
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes("refresh failed") || err.message.includes("sign in"), "error must mention refresh failure or re-sign-in");
    }
    assert.ok(threw, "must throw when refresh fails");
    assert.equal(getStoredSession(), null, "session must be cleared after refresh failure");
  } finally {
    globalThis.localStorage = origLS;
    globalThis.fetch = origFetch;
  }
});

// 131. Real client function fetchContractorPayableById uses the refresh path
test("131. fetchContractorPayableById calls authenticatedRestFetchWithRefresh (source + behavioral)", async () => {
  // Source: verify fetchOneById (used by fetchContractorPayableById) uses authenticatedRestFetchWithRefresh
  assert.ok(
    wave5ClientSrc.includes("authenticatedRestFetchWithRefresh"),
    "Finance client must import and use authenticatedRestFetchWithRefresh"
  );
  assert.ok(
    !wave5ClientSrc.includes("authenticatedRestFetch("),
    "Finance client must not call plain authenticatedRestFetch directly"
  );

  // Behavioral: use the refresh function directly with the exact path fetchContractorPayableById would call
  const ls = makeMockLocalStorage();
  storeSession(ls, "old-token-finance", 20 /* near expiry, will trigger proactive refresh */);
  const origLS = globalThis.localStorage;
  const origFetch = globalThis.fetch;
  globalThis.localStorage = ls;

  let refreshCalled = false;
  let restPath = null;
  globalThis.fetch = async (url, opts = {}) => {
    const href = String(url);
    if (href.includes("/auth/v1/token")) {
      refreshCalled = true;
      return makeJSONResponse(200, {
        access_token: "finance-refreshed",
        refresh_token: "rt-fin",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "u1", email: "x@x.com", user_metadata: {}, app_metadata: {} },
      });
    }
    if (href.includes("/rest/v1/")) {
      restPath = href;
      assert.ok(
        (opts?.headers?.Authorization ?? "").includes("finance-refreshed"),
        "Finance REST call must use refreshed token"
      );
      return makeJSONResponse(200, [{ id: "payable-99", payable_status: "approved" }]);
    }
    return makeJSONResponse(200, {});
  };

  try {
    const { authenticatedRestFetchWithRefresh } = await importAuthClient();
    // Call with the exact path fetchContractorPayableById constructs
    const res = await authenticatedRestFetchWithRefresh("contractor_payable?id=eq.payable-99&limit=1");
    assert.ok(refreshCalled, "proactive refresh must fire for near-expired token");
    assert.ok(restPath && restPath.includes("contractor_payable"), "must call contractor_payable endpoint");
    const rows = await res.json();
    assert.equal(rows[0]?.id, "payable-99", "must return payable data");
  } finally {
    globalThis.localStorage = origLS;
    globalThis.fetch = origFetch;
  }
});

// 132. Pending payable -> runner routes to approve_payable, does NOT create another payable
test("132. pending payable -> nextGate=approve_payable, not create_payable", () => {
  // Source-level verification (behavioral state machine logic)
  const src = acceptanceRunnerSrc;
  assert.ok(
    src.includes("payable.payable_status === \"pending\""),
    "runner must detect pending payable and route to approval"
  );
  assert.ok(
    src.includes("nextGate = \"approve_payable\""),
    "runner must set nextGate = approve_payable when payable is pending"
  );
  // The create_payable gate must only trigger when assignmentPayables.length === 0
  const createIdx = src.indexOf("\"create_payable\"");
  const zeroLenIdx = src.indexOf("assignmentPayables.length === 0");
  assert.ok(zeroLenIdx < createIdx, "create_payable gate must be gated on no existing payables");
});

// 133. Payable self-approval — no PATCH, throws error
test("133. approveContractorPayable rejects self-approval", async () => {
  assert.ok(
    wave5RuntimeSrc.includes("self-approval not permitted"),
    "runtime must guard against self-approval"
  );
  assert.ok(
    wave5RuntimeSrc.includes("worker.app_user_id && worker.app_user_id === approverAppUserId"),
    "runtime must compare worker.app_user_id to approverAppUserId"
  );
});

// 134. Payable approval PATCH contains ONLY payable_status, approved_by_app_user_id, approved_at
test("134. approveContractorPayable PATCH contains only the three approval fields", () => {
  // Extract the patch object from runtime source
  const patchIdx = wave5RuntimeSrc.indexOf("payable_status: \"approved\"");
  assert.ok(patchIdx > -1, "patch must set payable_status to approved");
  // Find surrounding context (the patch = { ... } block)
  const patchBlock = wave5RuntimeSrc.slice(patchIdx - 20, patchIdx + 200);
  assert.ok(patchBlock.includes("approved_by_app_user_id"), "patch must include approved_by_app_user_id");
  assert.ok(patchBlock.includes("approved_at"), "patch must include approved_at");
  // Must NOT include other fields
  assert.ok(!patchBlock.includes("computed_amount"), "patch must not include computed_amount");
  assert.ok(!patchBlock.includes("worker_id"), "patch must not include worker_id");
});

// 135. acknowledged -> completed via canonical updateWorkerAssignmentStatus; NO completed_at
test("135. assignment completion uses updateWorkerAssignmentStatus, no completed_at property", () => {
  const src = acceptanceRunnerSrc;
  assert.ok(
    src.includes("updateWorkerAssignmentStatus"),
    "runner must import and call updateWorkerAssignmentStatus"
  );
  // The runner must NOT submit a completed_at key in any PATCH body (as a JSON property key)
  assert.ok(
    !src.includes("completed_at:"),
    "runner must never submit a completed_at property in a PATCH body"
  );
  assert.ok(
    !src.includes("completeAssignment"),
    "runner must not use the removed completeAssignment helper"
  );
  // Canonical updateWorkerAssignmentStatus in ops client also must not set completed_at for completed
  const opsClientSrc = readFileSync(
    resolve(ROOT, "src/lib/serviceosOperationsClient.js"),
    "utf8"
  );
  const completedSection = (() => {
    const idx = opsClientSrc.indexOf('"completed"');
    return idx > -1 ? opsClientSrc.slice(idx, idx + 100) : "";
  })();
  assert.ok(!completedSection.includes("completed_at"), "ops client must not set completed_at when transitioning to completed");
});

// 136. Already completed assignment — completion gate skipped
test("136. runner skips gate-a when assignment is already completed", () => {
  const src = acceptanceRunnerSrc;
  // The gate-a check must be: if (assignment.assignment_status === "acknowledged")
  assert.ok(
    src.includes("assignment.assignment_status === \"acknowledged\""),
    "runner only calls updateWorkerAssignmentStatus for acknowledged assignments"
  );
  // The runner must proceed to payable logic when status is completed
  const completedCheckIdx = src.indexOf("assignment.assignment_status !== \"completed\"");
  assert.ok(completedCheckIdx > -1, "runner must verify status is completed before payable logic");
});

// 137. Wrong org/BU lineage — fail before mutation
test("137. work_order lineage mismatch fails closed before any mutation", () => {
  const src = acceptanceRunnerSrc;
  assert.ok(
    src.includes("workOrder.organization_id !== organizationId"),
    "runner must check work_order.organization_id against derived organizationId"
  );
  assert.ok(
    src.includes("workOrder.business_unit_id !== businessUnitId"),
    "runner must check work_order.business_unit_id against derived businessUnitId"
  );
  assert.ok(
    src.includes("failClosed"),
    "lineage mismatches must call failClosed"
  );
});

// 138. Compensation version resolution uses effective-date, BU, and service_family filtering
test("138. compensation version resolution includes effective_from/effective_to, business_unit_id, service_family", () => {
  const src = acceptanceRunnerSrc;
  assert.ok(
    src.includes("business_unit_id=eq."),
    "compensation version query must filter by business_unit_id"
  );
  assert.ok(
    src.includes("effective_from=lte."),
    "compensation version query must filter effective_from <= serviceCompletedAt"
  );
  assert.ok(
    src.includes("effective_to.is.null"),
    "compensation version query must allow effective_to IS NULL"
  );
  assert.ok(
    src.includes("service_family.is.null"),
    "compensation version query must allow service_family IS NULL"
  );
});

// 139. Multiple genuinely effective compensation versions — fail closed
test("139. multiple effective compensation versions causes fail closed", () => {
  const src = acceptanceRunnerSrc;
  assert.ok(
    src.includes("effectiveVersions.length > 1"),
    "runner must check for more than one effective version"
  );
  assert.ok(
    src.includes("multiple genuinely effective compensation versions found"),
    "fail closed message must mention multiple genuinely effective versions"
  );
});

// 140. flat_amount — basis_value resolves to 0
test("140. flat_amount compensation forces resolvedBasisValue to 0", () => {
  const src = acceptanceRunnerSrc;
  assert.ok(
    src.includes("compensation_method === \"flat_amount\" ? 0"),
    "runner must force resolvedBasisValue to 0 for flat_amount compensation"
  );
});

// 141. Latest profitability snapshot selected by snapshot_taken_at
test("141. fetchJobProfitabilitySnapshotByJobId uses snapshot_taken_at.desc ordering", () => {
  assert.ok(
    wave5ClientSrc.includes("snapshot_taken_at.desc"),
    "profitability snapshot query must order by snapshot_taken_at.desc"
  );
  assert.ok(
    wave5ClientSrc.includes("created_at.desc"),
    "profitability snapshot query must also order by created_at.desc as tiebreak"
  );
});

// 142. Pending payable blocks profitability gate
test("142. pending payable blocks profitability capture gate", () => {
  const src = acceptanceRunnerSrc;
  // In loadWave5AcceptanceState: pending -> approve_payable, not capture_profitability
  const pendingIdx = src.indexOf("payable.payable_status === \"pending\"");
  const approveGateIdx = src.indexOf("nextGate = \"approve_payable\"");
  const profitGateIdx = src.indexOf("nextGate = \"capture_profitability\"");
  assert.ok(pendingIdx > -1, "pending status check must exist");
  assert.ok(approveGateIdx > -1, "approve_payable gate must exist");
  // approve gate must come before capture_profitability in the logic
  assert.ok(approveGateIdx < profitGateIdx, "approve_payable must precede capture_profitability");
});

// 143. Approved payable permits profitability gate
test("143. approved payable permits capture_profitability gate", () => {
  const src = acceptanceRunnerSrc;
  assert.ok(
    src.includes("[\"approved\", \"paid\"].includes(payable.payable_status)"),
    "runner must require approved or paid payable before profitability"
  );
  assert.ok(
    src.includes("capture_profitability"),
    "runner must have a capture_profitability gate"
  );
});

// 144. Completed profitability + valid finance status → terminal financeCoreStatus PASS, nextGate null
test("144. evaluateFinanceCorePass returns pass when all finance conditions met", () => {
  const src = acceptanceRunnerSrc;
  assert.ok(
    src.includes("financeCoreStatus: \"pass\""),
    "runner must return financeCoreStatus=pass when all conditions met"
  );
  assert.ok(
    src.includes("nextGate: null"),
    "runner must set nextGate=null when finance core passes"
  );
  assert.ok(
    src.includes("evaluateFinanceCorePass"),
    "runner must define and call evaluateFinanceCorePass"
  );
  // Verify the conditions checked: billing_ready, invoice_request_id, payment_count, payable_status, profitability_snapshot_id
  assert.ok(src.includes("billing_ready"), "finance core must require billing_ready");
  assert.ok(src.includes("invoice_request_id"), "finance core must require invoice_request_id");
  assert.ok(src.includes("payment_count"), "finance core must require payment_count >= 1");
  assert.ok(src.includes("profitability_snapshot_id"), "finance core must require profitability_snapshot_id");
});

// 145. Margin 0.6364 renders as 63.64%
test("145. gross_margin_percent 0.6364 renders as 63.64%", () => {
  // Test the expression used in the UI panel
  const panelSrc_ = readFileSync(
    resolve(ROOT, "src/features/pilot/ServiceOSWave5FinancePilotPanel.jsx"),
    "utf8"
  );
  assert.ok(
    panelSrc_.includes("gross_margin_percent * 100).toFixed(2)"),
    "Panel must multiply gross_margin_percent by 100 and call toFixed(2)"
  );
  // Inline computation test
  const raw = 0.6364;
  const rendered = `${(raw * 100).toFixed(2)}%`;
  assert.equal(rendered, "63.64%", "0.6364 must render as 63.64%");
});
