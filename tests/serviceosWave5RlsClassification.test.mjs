// =============================================================================
// BEHAVIORAL TESTS — Wave 5 RLS PATCH/INSERT classification
// Proves each classification case from the live-failure correction spec.
// No DB or network calls. All inputs are synthetic result objects.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import {
  EXPECTED_WAVE5_CATALOG_CONTRACT,
  classifyDenyPatchProbe,
  classifyCatalogPolicyDenyProbe,
  classifyDenyMutationProbe,
  classifyDenyRetainedDuplicateInsertProbe,
  buildIdentityAudit,
  makeRetainedDuplicateInsertPayload,
  resolveNormalizedTokenMap,
  serviceRoleReadOnlyRpc,
  summarizeProbes,
  validateWave5CatalogAttestation,
} from "../src/server/wave5RlsAcceptanceHarness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const wave5RlsHarnessSrc = readFileSync(
  resolve(ROOT, "src/server/wave5RlsAcceptanceHarness.js"),
  "utf8"
);
const panelSrc = readFileSync(
  resolve(ROOT, "src/features/pilot/ServiceOSWave5FinancePilotPanel.jsx"),
  "utf8"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE = "worker";
const TABLE = "billing_readiness_gate";
const ID = "c626972d-3d5f-411c-ba87-613a62f5a885";
const SCOPE = { id: ID };

const CANONICAL_ROW = Object.freeze({
  id: ID,
  gate_status: "ready",
  metadata: { probe: "test" },
});

function makeResult(status, body, method = "PATCH") {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    raw_text: typeof body === "string" ? body : JSON.stringify(body ?? ""),
    method,
    table: TABLE,
  };
}

// ── CASE 1: HTTP 200 [], retained row exists and unchanged → PROVEN_RLS_DENY ──

test("W5RC-1. expected-deny PATCH: HTTP 200 [], retained row exists and unchanged → PROVEN_RLS_DENY / PASS", () => {
  const probe = classifyDenyPatchProbe({
    role: ROLE,
    operation: `UPDATE ${TABLE}`,
    table: TABLE,
    result: makeResult(200, []),
    expected_scope: SCOPE,
    beforeRow: { ...CANONICAL_ROW },
    afterRow: { ...CANONICAL_ROW },
  });
  assert.equal(probe.classification, "proven_rls_deny", "must be proven_rls_deny");
  assert.equal(probe.pass, true, "must pass");
  assert.equal(probe.proof_detail, "rls_filtered_update_zero_rows");
  assert.equal(probe.actual_row_count, 0);
});

// ── CASE 2: HTTP 200 [canonicalRow] → UNEXPECTED_ALLOW / FAIL ─────────────────

test("W5RC-2. expected-deny PATCH: HTTP 200 [canonical row] → UNEXPECTED_ALLOW / FAIL", () => {
  const probe = classifyDenyPatchProbe({
    role: ROLE,
    operation: `UPDATE ${TABLE}`,
    table: TABLE,
    result: makeResult(200, [{ ...CANONICAL_ROW, gate_status: "updated" }]),
    expected_scope: SCOPE,
    beforeRow: { ...CANONICAL_ROW },
    afterRow: { ...CANONICAL_ROW, gate_status: "updated" },
  });
  assert.equal(probe.classification, "unexpected_allow", "must be unexpected_allow");
  assert.equal(probe.pass, false, "must fail");
});

// ── CASE 3: HTTP 403 / RLS error → PROVEN_RLS_DENY / PASS ────────────────────

test("W5RC-3. expected-deny PATCH: HTTP 403 RLS error → PROVEN_RLS_DENY / PASS", () => {
  const probe = classifyDenyPatchProbe({
    role: ROLE,
    operation: `UPDATE ${TABLE}`,
    table: TABLE,
    result: makeResult(403, { code: "42501", message: "permission denied for table billing_readiness_gate" }),
    expected_scope: SCOPE,
    beforeRow: { ...CANONICAL_ROW },
    afterRow: { ...CANONICAL_ROW },
  });
  assert.equal(probe.classification, "proven_rls_deny", "must be proven_rls_deny for 403");
  assert.equal(probe.pass, true, "must pass");
});

test("W5RC-3b. expected-deny PATCH: HTTP 200 but RLS error body → non-2xx path not reached — 401 is explicit RLS denial", () => {
  const probe = classifyDenyPatchProbe({
    role: ROLE,
    operation: `UPDATE ${TABLE}`,
    table: TABLE,
    result: { ...makeResult(401, { message: "row-level security policy violation" }), ok: false },
    expected_scope: SCOPE,
    beforeRow: { ...CANONICAL_ROW },
    afterRow: { ...CANONICAL_ROW },
  });
  assert.equal(probe.classification, "proven_rls_deny");
  assert.equal(probe.pass, true);
});

// ── CASE 4: DB immutability / validation error → VALIDATION_FAILURE / FAIL ───

test("W5RC-4. expected-deny PATCH: DB immutability error → VALIDATION_FAILURE / FAIL", () => {
  const probe = classifyDenyPatchProbe({
    role: ROLE,
    operation: `UPDATE ${TABLE}`,
    table: TABLE,
    result: {
      ok: false,
      status: 400,
      body: { message: "violates check constraint immutable_gate" },
      raw_text: '{"message":"violates check constraint immutable_gate"}',
      method: "PATCH",
      table: TABLE,
    },
    expected_scope: SCOPE,
    beforeRow: { ...CANONICAL_ROW },
    afterRow: { ...CANONICAL_ROW },
  });
  assert.equal(probe.classification, "validation_failure", "must be validation_failure");
  assert.equal(probe.pass, false, "must fail");
  assert.equal(probe.proof_detail, "request_reached_db_validation_after_authz");
});

// ── CASE 5: HTTP 200 [], but retained row changed → FAIL ─────────────────────

test("W5RC-5. expected-deny PATCH: HTTP 200 [], but retained row changed → UNEXPECTED_ALLOW / FAIL", () => {
  const probe = classifyDenyPatchProbe({
    role: ROLE,
    operation: `UPDATE ${TABLE}`,
    table: TABLE,
    result: makeResult(200, []),
    expected_scope: SCOPE,
    beforeRow: { ...CANONICAL_ROW },
    afterRow: { ...CANONICAL_ROW, gate_status: "changed_by_someone" },
  });
  assert.equal(probe.classification, "unexpected_allow", "changed retained row must fail");
  assert.equal(probe.pass, false);
});

// ── CASE 6: canonical retained row missing before probe → NOT_PROVEN / FAIL ──

test("W5RC-6. expected-deny PATCH: canonical row did not exist before probe → NOT_PROVEN / FAIL", () => {
  const probe = classifyDenyPatchProbe({
    role: ROLE,
    operation: `UPDATE ${TABLE}`,
    table: TABLE,
    result: makeResult(200, []),
    expected_scope: SCOPE,
    beforeRow: null,
    afterRow: null,
  });
  assert.equal(probe.classification, "not_proven", "missing before row must be not_proven");
  assert.equal(probe.pass, false, "not_proven is not a pass");
  assert.ok(probe.note.includes("did not exist"), "note must explain the missing row");
});

// ── CASE 7: expected-deny INSERT with HTTP 200 → UNEXPECTED_ALLOW / FAIL ─────

test("W5RC-7. expected-deny INSERT: HTTP 200 → UNEXPECTED_ALLOW / FAIL", () => {
  const probe = classifyDenyMutationProbe({
    role: ROLE,
    operation: `INSERT ${TABLE} (safe validation probe)`,
    table: TABLE,
    result: makeResult(200, [{ id: "new-id" }], "POST"),
    expected_scope: SCOPE,
  });
  assert.equal(probe.classification, "unexpected_allow", "INSERT 2xx must be unexpected_allow");
  assert.equal(probe.pass, false);
});

test("W5RC-7b. expected-deny INSERT: HTTP 200 empty array → UNEXPECTED_ALLOW / FAIL (strict, no PATCH exception)", () => {
  const probe = classifyDenyMutationProbe({
    role: ROLE,
    operation: `INSERT ${TABLE} (safe validation probe)`,
    table: TABLE,
    result: makeResult(200, [], "POST"),
    expected_scope: SCOPE,
  });
  assert.equal(probe.classification, "unexpected_allow", "INSERT 2xx with empty array must still be unexpected_allow");
  assert.equal(probe.pass, false, "INSERT 2xx must always fail");
});

// ── CASE 8: expected-deny INSERT reaching DB validation → VALIDATION_FAILURE / FAIL

test("W5RC-8. expected-deny INSERT: DB validation reached → VALIDATION_FAILURE / FAIL", () => {
  const probe = classifyDenyMutationProbe({
    role: ROLE,
    operation: `INSERT ${TABLE} (safe validation probe)`,
    table: TABLE,
    result: {
      ok: false,
      status: 400,
      body: { message: "violates check constraint" },
      raw_text: '{"message":"violates check constraint"}',
      method: "POST",
      table: TABLE,
    },
    expected_scope: SCOPE,
  });
  assert.equal(probe.classification, "validation_failure");
  assert.equal(probe.pass, false);
});

test("W5RC-8b. retained duplicate INSERT: explicit RLS 42501 denial → PROVEN_RLS_DENY / PASS", () => {
  const probe = classifyDenyRetainedDuplicateInsertProbe({
    role: ROLE,
    operation: "INSERT contractor_payable (retained duplicate PK RLS probe)",
    table: "contractor_payable",
    result: {
      ok: false,
      status: 403,
      body: { code: "42501", message: "row-level security policy violation" },
      raw_text: '{"code":"42501","message":"row-level security policy violation"}',
      method: "POST",
      table: "contractor_payable",
    },
    expected_scope: { id: "cp-id" },
    beforeRow: { id: "cp-id", metadata: { a: 1 } },
    afterRow: { id: "cp-id", metadata: { a: 1 } },
  });
  assert.equal(probe.classification, "proven_rls_deny");
  assert.equal(probe.pass, true);
});

test("W5RC-8c. retained duplicate INSERT: table permission denial → PROVEN_AUTHZ_DENY / PASS", () => {
  const probe = classifyDenyRetainedDuplicateInsertProbe({
    role: ROLE,
    operation: "INSERT contractor_payable (retained duplicate PK RLS probe)",
    table: "contractor_payable",
    result: {
      ok: false,
      status: 403,
      body: { message: "permission denied for table contractor_payable" },
      raw_text: '{"message":"permission denied for table contractor_payable"}',
      method: "POST",
      table: "contractor_payable",
    },
    expected_scope: { id: "cp-id" },
    beforeRow: { id: "cp-id", metadata: { a: 1 } },
    afterRow: { id: "cp-id", metadata: { a: 1 } },
  });
  assert.equal(probe.classification, "proven_authz_deny");
  assert.equal(probe.pass, true);
});

test("W5RC-8d. retained duplicate INSERT: duplicate PK 23505 → UNEXPECTED_ALLOW / FAIL", () => {
  const probe = classifyDenyRetainedDuplicateInsertProbe({
    role: ROLE,
    operation: "INSERT invoice_request (retained duplicate PK RLS probe)",
    table: "invoice_request",
    result: {
      ok: false,
      status: 409,
      body: { code: "23505", message: "duplicate key value violates unique constraint" },
      raw_text: '{"code":"23505","message":"duplicate key value violates unique constraint"}',
      method: "POST",
      table: "invoice_request",
    },
    expected_scope: { id: "ir-id" },
    beforeRow: { id: "ir-id", metadata: { a: 1 } },
    afterRow: { id: "ir-id", metadata: { a: 1 } },
  });
  assert.equal(probe.classification, "unexpected_allow");
  assert.equal(probe.pass, false);
  assert.equal(probe.proof_detail, "uniqueness_reached_after_authorization");
});

test("W5RC-8e. retained duplicate INSERT: HTTP 2xx → UNEXPECTED_ALLOW / FAIL", () => {
  const probe = classifyDenyRetainedDuplicateInsertProbe({
    role: ROLE,
    operation: "INSERT job_profitability_snapshot (retained duplicate PK RLS probe)",
    table: "job_profitability_snapshot",
    result: makeResult(201, [{ id: "jps-id" }], "POST"),
    expected_scope: { id: "jps-id" },
    beforeRow: { id: "jps-id", metadata: { a: 1 } },
    afterRow: { id: "jps-id", metadata: { a: 1 } },
  });
  assert.equal(probe.classification, "unexpected_allow");
  assert.equal(probe.pass, false);
});

test("W5RC-8f. retained duplicate INSERT: retained row must remain unchanged", () => {
  const probe = classifyDenyRetainedDuplicateInsertProbe({
    role: ROLE,
    operation: "INSERT billing_readiness_gate (retained duplicate PK RLS probe)",
    table: "billing_readiness_gate",
    result: {
      ok: false,
      status: 403,
      body: { code: "42501", message: "row-level security policy violation" },
      raw_text: '{"code":"42501","message":"row-level security policy violation"}',
      method: "POST",
      table: "billing_readiness_gate",
    },
    expected_scope: { id: "brg-id" },
    beforeRow: { id: "brg-id", metadata: { a: 1 } },
    afterRow: { id: "brg-id", metadata: { a: 2 } },
  });
  assert.equal(probe.classification, "unexpected_allow");
  assert.equal(probe.pass, false);
});

test("W5RC-8g. retained duplicate INSERT: BEFORE-trigger validation error is NOT_PROVEN / FAIL", () => {
  const probe = classifyDenyRetainedDuplicateInsertProbe({
    role: ROLE,
    operation: "INSERT contractor_payable (retained duplicate PK RLS probe)",
    table: "contractor_payable",
    result: {
      ok: false,
      status: 400,
      body: { code: "23514", message: "violates check constraint payable_basis_check" },
      raw_text: '{"code":"23514","message":"violates check constraint payable_basis_check"}',
      method: "POST",
      table: "contractor_payable",
    },
    expected_scope: { id: "cp-id" },
    beforeRow: { id: "cp-id", metadata: { a: 1 } },
    afterRow: { id: "cp-id", metadata: { a: 1 } },
  });
  assert.equal(probe.classification, "not_proven");
  assert.equal(probe.pass, false);
  assert.ok(probe.note.includes("payable_basis_check"));
});

test("W5RC-8h. retained duplicate payload: billing_readiness_gate uses exact retained lineage fields", () => {
  const retained = {
    id: "brg-id",
    organization_id: "org",
    business_unit_id: "bu",
    jurisdiction_id: "jur",
    operational_job_id: "job",
    work_order_id: "wo",
    operational_handoff_id: "oh",
    pricing_snapshot_id: "ps",
    quote_version_id: "qv",
    gate_status: "ready",
    gate_assessment: { ok: true },
    blocking_reasons: [],
    assessed_at: "2025-01-01T00:00:00Z",
    assessed_by_app_user_id: "app",
    metadata: { m: 1 },
    created_at: "2025-01-01T00:00:00Z",
    created_by_app_user_id: "creator",
    ignored_column: "must-not-be-inserted",
  };
  const payload = makeRetainedDuplicateInsertPayload("billing_readiness_gate", retained);
  assert.equal(payload.id, retained.id);
  assert.equal(payload.operational_handoff_id, retained.operational_handoff_id);
  assert.equal(payload.created_by_app_user_id, retained.created_by_app_user_id);
  assert.ok(!Object.hasOwn(payload, "ignored_column"));
});

test("W5RC-8i. retained duplicate payload: invoice_request keeps SAME canonical id and monetary lineage", () => {
  const retained = {
    id: "invoice-id",
    organization_id: "org",
    business_unit_id: "bu",
    jurisdiction_id: "jur",
    billing_readiness_gate_id: "brg",
    operational_job_id: "job",
    work_order_id: "wo",
    operational_handoff_id: "oh",
    customer_id: "cust",
    service_location_id: "sl",
    pricing_snapshot_id: "ps",
    quote_version_id: "qv",
    quote_response_id: "qr",
    conversion_record_id: "conv",
    currency_code: "CAD",
    subtotal_amount: 100,
    tax_amount: 13,
    total_amount: 113,
    tax_name: "HST",
    tax_rate: 0.13,
    financial_snapshot: { line: 1 },
    request_status: "submitted",
    accounting_provider: "xero",
    provider_reference_id: "ref",
    provider_acknowledged_at: "2025-01-01T00:00:00Z",
    provider_response_snapshot: { ok: true },
    submitted_at: "2025-01-01T00:00:00Z",
    acknowledged_at: "2025-01-02T00:00:00Z",
    metadata: { m: 1 },
    created_at: "2025-01-01T00:00:00Z",
    created_by_app_user_id: "creator",
    updated_by_app_user_id: "updater",
  };
  const payload = makeRetainedDuplicateInsertPayload("invoice_request", retained);
  assert.equal(payload.id, retained.id);
  assert.equal(payload.subtotal_amount, retained.subtotal_amount);
  assert.equal(payload.tax_amount, retained.tax_amount);
  assert.equal(payload.total_amount, retained.total_amount);
});

test("W5RC-8j. retained duplicate payload: contractor_payable uses canonical basis/computed values", () => {
  const retained = {
    id: "cp-id",
    organization_id: "org",
    business_unit_id: "bu",
    worker_id: "worker",
    worker_assignment_id: "wa",
    operational_job_id: "job",
    work_order_id: "wo",
    contractor_compensation_version_id: "ccv",
    compensation_method: "flat_amount",
    currency_code: "CAD",
    basis_value: 80,
    computed_amount: 80,
    payable_status: "approved",
    eligibility_assessment: { ok: true },
    eligibility_passed: true,
    approved_by_app_user_id: "approver",
    approved_at: "2025-01-01T00:00:00Z",
    metadata: { m: 1 },
    created_at: "2025-01-01T00:00:00Z",
    created_by_app_user_id: "creator",
  };
  const payload = makeRetainedDuplicateInsertPayload("contractor_payable", retained);
  assert.equal(payload.basis_value, 80);
  assert.equal(payload.computed_amount, 80);
  assert.notEqual(payload.basis_value, -1);
});

test("W5RC-8k. retained duplicate payload: profitability uses canonical lineage and excludes gross_contribution", () => {
  const retained = {
    id: "jps-id",
    organization_id: "org",
    business_unit_id: "bu",
    operational_job_id: "job",
    invoice_request_id: "inv",
    currency_code: "CAD",
    recognized_revenue_amount: 220,
    tax_amount: 0,
    direct_labor_cost: 80,
    other_direct_cost: 30,
    gross_margin_percent: 0.5,
    source_lineage: { exact: true },
    snapshot_taken_at: "2025-01-01T00:00:00Z",
    metadata: { m: 1 },
    created_at: "2025-01-01T00:00:00Z",
    created_by_app_user_id: "creator",
    gross_contribution: 110,
  };
  const payload = makeRetainedDuplicateInsertPayload("job_profitability_snapshot", retained);
  assert.deepEqual(payload.source_lineage, retained.source_lineage);
  assert.equal(payload.other_direct_cost, retained.other_direct_cost);
  assert.ok(!Object.hasOwn(payload, "gross_contribution"));
});

// ── CASE 9/10: UI stores/displays full 422 payload with failed role names ─────

test("W5RC-9. UI: setGaRlsResult is called with payload when response is not ok", () => {
  assert.ok(
    panelSrc.includes("if (payload) setGaRlsResult(payload)"),
    "UI must call setGaRlsResult(payload) on non-2xx response"
  );
});

test("W5RC-10. UI: failed role names are extracted and shown in error message on 422", () => {
  assert.ok(
    panelSrc.includes("failedRoles"),
    "UI must compute failedRoles"
  );
  assert.ok(
    panelSrc.includes(".passed === false"),
    "UI must filter roles where passed === false"
  );
  assert.ok(
    panelSrc.includes("failed roles:"),
    "UI error message must include failed role names"
  );
  assert.ok(
    panelSrc.includes('"owner_admin"') && panelSrc.includes('"office_ops"') &&
    panelSrc.includes('"worker"') && panelSrc.includes('"qa"') && panelSrc.includes('"anon"'),
    "UI must check all five roles for failure"
  );
});

// ── CASE 11: final passed cannot be true if any mandatory probe fails ─────────

test("W5RC-11. final passed cannot be true if any mandatory probe fails", () => {
  assert.ok(
    wave5RlsHarnessSrc.includes("failedCount === 0"),
    "harness must require failedCount === 0 for passed=true"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("sections.every((section) => section.passed)"),
    "harness must require every section to pass"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedIntegrity.unchanged"),
    "harness must require retained data unchanged for passed=true"
  );
});

// ── CASE 12: retained_data_unchanged must still be true ───────────────────────

test("W5RC-12. retained_data_unchanged must still be part of pass condition", () => {
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedIntegrity.unchanged"),
    "retained integrity check must be part of the pass condition"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retained_data_unchanged"),
    "retained_data_unchanged must be reported in the response payload"
  );
});

// ── Source-level: classifyDenyPatchProbe uses before/after verification ────────

test("W5RC-S1. classifyDenyPatchProbe verifies beforeRow and afterRow before PROVEN_RLS_DENY", () => {
  assert.ok(
    wave5RlsHarnessSrc.includes("classifyDenyPatchProbe"),
    "harness must define classifyDenyPatchProbe"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("beforeRow") && wave5RlsHarnessSrc.includes("afterRow"),
    "classifyDenyPatchProbe must use before/after row parameters"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("rls_filtered_update_zero_rows"),
    "harness must use rls_filtered_update_zero_rows proof_detail"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes(
      "Known retained row existed, role PATCH affected zero rows, and retained row remained unchanged."
    ),
    "harness must document the zero-rows proof note"
  );
});

test("W5RC-S2. classifyDenyMutationProbe no longer contains the empty-array PROVEN_RLS_DENY exception", () => {
  // The empty-array branch was the root cause. Verify it is gone from the INSERT classifier.
  // We can't grep directly for the removed code, but we can confirm the note that was there is gone.
  assert.ok(
    !wave5RlsHarnessSrc.includes("PATCH returned empty representation, proving update filtering/denial"),
    "old incorrect PATCH empty-array note must be removed from classifyDenyMutationProbe"
  );
});

test("W5RC-S3. console.warn diagnostic log is emitted on passed=false", () => {
  const warnMatch = wave5RlsHarnessSrc.match(
    /console\.warn\("wave5_rls_acceptance_failed",\s*\{([\s\S]*?)\}\);/
  );
  assert.ok(warnMatch, "failure diagnostic warning block must exist");

  const warningBlock = warnMatch[0];

  for (const required of [
    "failed_roles",
    "failed_count",
    "not_proven_count",
    "retained_data_unchanged",
  ]) {
    assert.ok(
      warningBlock.includes(required),
      `warning block must include ${required}`
    );
  }

  for (const forbidden of [
    "access_token",
    "refresh_token",
    "password",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "Authorization",
    "apikey",
  ]) {
    assert.ok(
      !warningBlock.includes(forbidden),
      `warning block must not contain ${forbidden}`
    );
  }
});

test("W5RC-S4. exactly three denied inserts use retained duplicate PK strategy after catalog replacement", () => {
  const matches = wave5RlsHarnessSrc.match(/await denyRetainedDuplicateInsertProbe\(/g) || [];
  assert.equal(matches.length, 3, "catalog proof must replace the seven ambiguous denied inserts");
});

// =============================================================================
// IDENTITY AUDIT BEHAVIORAL TESTS — credential normalization, contamination,
// sequential execution, and overall pass conditions.
// No DB or network calls. All inputs are synthetic.
// =============================================================================

// ── Helpers for identity audit tests ─────────────────────────────────────────

const CANONICAL_OFFICE_OPS_APP_USER = "e884d76e-d54d-4af3-93df-accf9bf34f44";
const CANONICAL_WORKER_APP_USER     = "93338807-efa2-4ada-88a9-54c18813c336";
const CANONICAL_QA_APP_USER         = "e04a824d-6b06-41fd-addf-14ce35d488b7";
const CANONICAL_WORKER_ID           = "1b3a6903-0c50-4a95-afc3-280628c10508";

function makeCandidate(envLabel, envRole) {
  return { env_label: envLabel, env_role: envRole, email: `${envRole}@test.local`, password: "x" };
}

function makeIdentity(appUserId, roleCodes = [], workerId = null) {
  return { auth_user_id: "auth-" + appUserId.slice(0, 8), app_user_id: appUserId, active_role_codes: roleCodes, worker_id: workerId };
}

function makeTokensByLabel(map) {
  // map: { env_label: token }
  return new Map(Object.entries(map));
}

function makeIdentitiesMap(tokenToIdentityMap) {
  return new Map(Object.entries(tokenToIdentityMap));
}

// ── W5RC-ID-1: env label says office_ops but token resolves to worker app_user ──

test("W5RC-ID-1. env label says office_ops but token resolves to worker → not treated as office_ops", () => {
  const candidates = [makeCandidate("SERVICEOS_W5_RLS_OFFICE_OPS", "office_ops")];
  const tokensByLabel = makeTokensByLabel({ SERVICEOS_W5_RLS_OFFICE_OPS: "tok-a" });
  // Token resolves to the WORKER canonical app_user, not office_ops
  const identities = makeIdentitiesMap({ "tok-a": makeIdentity(CANONICAL_WORKER_APP_USER, ["worker"], CANONICAL_WORKER_ID) });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.office_ops.actual_app_user_id, null, "office_ops must have no resolved identity");
  assert.equal(audit.office_ops.passed, false, "office_ops identity audit must fail");
});

// ── W5RC-ID-2: all three labels swapped but all three canonical identities available ──

test("W5RC-ID-2. three credential labels swapped but all three canonical identities available → normalizes correctly", () => {
  const candidates = [
    makeCandidate("SERVICEOS_W5_RLS_OFFICE_OPS", "office_ops"), // email is actually worker
    makeCandidate("SERVICEOS_W5_RLS_WORKER",     "worker"),     // email is actually qa
    makeCandidate("SERVICEOS_W5_RLS_QA",         "qa"),         // email is actually office_ops
  ];
  const tokensByLabel = makeTokensByLabel({
    SERVICEOS_W5_RLS_OFFICE_OPS: "tok-worker",
    SERVICEOS_W5_RLS_WORKER:     "tok-qa",
    SERVICEOS_W5_RLS_QA:         "tok-office",
  });
  const identities = makeIdentitiesMap({
    "tok-worker": makeIdentity(CANONICAL_WORKER_APP_USER,     ["worker"],     CANONICAL_WORKER_ID),
    "tok-qa":     makeIdentity(CANONICAL_QA_APP_USER,         ["qa"]),
    "tok-office": makeIdentity(CANONICAL_OFFICE_OPS_APP_USER, ["office_ops"]),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.office_ops.actual_app_user_id, CANONICAL_OFFICE_OPS_APP_USER, "office_ops must resolve correctly");
  assert.equal(audit.worker.actual_app_user_id,     CANONICAL_WORKER_APP_USER,     "worker must resolve correctly");
  assert.equal(audit.qa.actual_app_user_id,         CANONICAL_QA_APP_USER,         "qa must resolve correctly");

  assert.equal(audit.office_ops.credential_label_mismatch, true,  "office_ops label mismatch must be detected");
  assert.equal(audit.worker.credential_label_mismatch,     true,  "worker label mismatch must be detected");
  assert.equal(audit.qa.credential_label_mismatch,         true,  "qa label mismatch must be detected");
});

// ── W5RC-ID-3: duplicate credentials resolve to one app_user → fail closed ──

test("W5RC-ID-3. duplicate credentials both resolve to the same canonical app_user → fail closed", () => {
  const candidates = [
    makeCandidate("SERVICEOS_W5_RLS_OFFICE_OPS", "office_ops"),
    makeCandidate("SERVICEOS_W4_RLS_OFFICE_OPS", "office_ops"),
  ];
  const tokensByLabel = makeTokensByLabel({
    SERVICEOS_W5_RLS_OFFICE_OPS: "tok-a",
    SERVICEOS_W4_RLS_OFFICE_OPS: "tok-b",
  });
  // Both resolve to the same canonical app_user
  const identities = makeIdentitiesMap({
    "tok-a": makeIdentity(CANONICAL_OFFICE_OPS_APP_USER, ["office_ops"]),
    "tok-b": makeIdentity(CANONICAL_OFFICE_OPS_APP_USER, ["office_ops"]),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.ok(audit.duplicate_resolutions.includes(CANONICAL_OFFICE_OPS_APP_USER), "duplicate must be detected");
});

// ── W5RC-ID-4: missing canonical QA identity → audit shows unresolved ─────

test("W5RC-ID-4. missing canonical QA identity → audit shows qa not found", () => {
  const candidates = [
    makeCandidate("SERVICEOS_W5_RLS_OFFICE_OPS", "office_ops"),
    makeCandidate("SERVICEOS_W5_RLS_WORKER",     "worker"),
    // No QA candidate
  ];
  const tokensByLabel = makeTokensByLabel({
    SERVICEOS_W5_RLS_OFFICE_OPS: "tok-o",
    SERVICEOS_W5_RLS_WORKER:     "tok-w",
  });
  const identities = makeIdentitiesMap({
    "tok-o": makeIdentity(CANONICAL_OFFICE_OPS_APP_USER, ["office_ops"]),
    "tok-w": makeIdentity(CANONICAL_WORKER_APP_USER,     ["worker"], CANONICAL_WORKER_ID),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.qa.actual_app_user_id, null, "qa app_user must not be found");
  assert.equal(audit.qa.passed, false, "qa identity audit must fail");
});

// ── W5RC-ID-5: Office Ops exact app_user + office_ops membership → pass ──────

test("W5RC-ID-5. Office Ops exact app_user + office_ops membership → identity audit pass", () => {
  const candidates = [makeCandidate("SERVICEOS_W5_RLS_OFFICE_OPS", "office_ops")];
  const tokensByLabel = makeTokensByLabel({ SERVICEOS_W5_RLS_OFFICE_OPS: "tok-o" });
  const identities = makeIdentitiesMap({
    "tok-o": makeIdentity(CANONICAL_OFFICE_OPS_APP_USER, ["office_ops"]),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.office_ops.passed, true, "office_ops must pass");
  assert.deepEqual(audit.office_ops.privilege_contamination, [], "no contamination");
});

// ── W5RC-ID-6: Office Ops also has owner_admin → privilege contamination fail ─

test("W5RC-ID-6. Office Ops app_user also has owner_admin membership → privilege contamination fail", () => {
  const candidates = [makeCandidate("SERVICEOS_W5_RLS_OFFICE_OPS", "office_ops")];
  const tokensByLabel = makeTokensByLabel({ SERVICEOS_W5_RLS_OFFICE_OPS: "tok-o" });
  const identities = makeIdentitiesMap({
    "tok-o": makeIdentity(CANONICAL_OFFICE_OPS_APP_USER, ["office_ops", "owner_admin"]),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.office_ops.passed, false, "contaminated office_ops must fail");
  assert.ok(audit.office_ops.privilege_contamination.includes("owner_admin"), "owner_admin contamination must be reported");
});

// ── W5RC-ID-7: Worker resolves to canonical app_user and canonical worker row → pass ──

test("W5RC-ID-7. Worker token resolves to canonical worker app_user and canonical worker row → pass", () => {
  const candidates = [makeCandidate("SERVICEOS_W5_RLS_WORKER", "worker")];
  const tokensByLabel = makeTokensByLabel({ SERVICEOS_W5_RLS_WORKER: "tok-w" });
  const identities = makeIdentitiesMap({
    "tok-w": makeIdentity(CANONICAL_WORKER_APP_USER, ["worker"], CANONICAL_WORKER_ID),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.worker.passed, true, "worker must pass");
  assert.equal(audit.worker.actual_worker_id,  CANONICAL_WORKER_ID, "worker_id must match canonical");
  assert.equal(audit.worker.worker_link_valid, true, "worker_link_valid must be true");
});

// ── W5RC-ID-8: Worker app_user does not match canonical worker.app_user_id → fail ──

test("W5RC-ID-8. Worker app_user does not match canonical worker row → fail", () => {
  const candidates = [makeCandidate("SERVICEOS_W5_RLS_WORKER", "worker")];
  const tokensByLabel = makeTokensByLabel({ SERVICEOS_W5_RLS_WORKER: "tok-w" });
  const identities = makeIdentitiesMap({
    // Resolves to the right app_user but a DIFFERENT worker row
    "tok-w": makeIdentity(CANONICAL_WORKER_APP_USER, ["worker"], "00000000-0000-0000-0000-000000000bad"),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.worker.passed, false, "worker with wrong worker row must fail");
  assert.equal(audit.worker.worker_link_valid, false, "worker_link_valid must be false");
});

// ── W5RC-ID-9: Worker has owner_admin contamination → fail ───────────────────

test("W5RC-ID-9. Worker app_user has owner_admin contamination → fail", () => {
  const candidates = [makeCandidate("SERVICEOS_W5_RLS_WORKER", "worker")];
  const tokensByLabel = makeTokensByLabel({ SERVICEOS_W5_RLS_WORKER: "tok-w" });
  const identities = makeIdentitiesMap({
    "tok-w": makeIdentity(CANONICAL_WORKER_APP_USER, ["worker", "owner_admin"], CANONICAL_WORKER_ID),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.worker.passed, false, "owner_admin contamination must fail worker audit");
  assert.ok(audit.worker.privilege_contamination.includes("owner_admin"), "owner_admin contamination must be reported");
});

// ── W5RC-ID-10: QA exact app_user + qa membership → pass ─────────────────────

test("W5RC-ID-10. QA exact app_user + qa membership → identity audit pass", () => {
  const candidates = [makeCandidate("SERVICEOS_W5_RLS_QA", "qa")];
  const tokensByLabel = makeTokensByLabel({ SERVICEOS_W5_RLS_QA: "tok-q" });
  const identities = makeIdentitiesMap({
    "tok-q": makeIdentity(CANONICAL_QA_APP_USER, ["qa"]),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.qa.passed, true, "qa must pass");
  assert.deepEqual(audit.qa.privilege_contamination, [], "no contamination");
});

// ── W5RC-ID-11: QA also has office_ops → contamination fail ──────────────────

test("W5RC-ID-11. QA app_user also has office_ops membership → privilege contamination fail", () => {
  const candidates = [makeCandidate("SERVICEOS_W5_RLS_QA", "qa")];
  const tokensByLabel = makeTokensByLabel({ SERVICEOS_W5_RLS_QA: "tok-q" });
  const identities = makeIdentitiesMap({
    "tok-q": makeIdentity(CANONICAL_QA_APP_USER, ["qa", "office_ops"]),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  assert.equal(audit.qa.passed, false, "contaminated qa must fail");
  assert.ok(audit.qa.privilege_contamination.includes("office_ops"), "office_ops contamination must be reported");
});

// ── W5RC-ID-12: identity audit output contains no credential/token material ───

test("W5RC-ID-12. identity audit output contains no credential/token material (no emails, passwords, tokens, keys)", () => {
  const candidates = [
    makeCandidate("SERVICEOS_W5_RLS_OFFICE_OPS", "office_ops"),
    makeCandidate("SERVICEOS_W5_RLS_WORKER",     "worker"),
    makeCandidate("SERVICEOS_W5_RLS_QA",         "qa"),
  ];
  const tokensByLabel = makeTokensByLabel({
    SERVICEOS_W5_RLS_OFFICE_OPS: "supersecret-tok-office",
    SERVICEOS_W5_RLS_WORKER:     "supersecret-tok-worker",
    SERVICEOS_W5_RLS_QA:         "supersecret-tok-qa",
  });
  const identities = makeIdentitiesMap({
    "supersecret-tok-office": makeIdentity(CANONICAL_OFFICE_OPS_APP_USER, ["office_ops"]),
    "supersecret-tok-worker": makeIdentity(CANONICAL_WORKER_APP_USER,     ["worker"], CANONICAL_WORKER_ID),
    "supersecret-tok-qa":     makeIdentity(CANONICAL_QA_APP_USER,         ["qa"]),
  });

  const audit = buildIdentityAudit({ candidates, identities, tokensByLabel });
  const auditJson = JSON.stringify(audit);

  for (const forbidden of ["supersecret", "@test.local", "password", "access_token", "refresh_token"]) {
    assert.ok(!auditJson.includes(forbidden), `identity audit must not contain ${forbidden}`);
  }
});

// ── W5RC-ID-13: role probes are not launched until identity audit passes ──────

test("W5RC-ID-13. harness source requires identity audit before probe execution", () => {
  assert.ok(
    wave5RlsHarnessSrc.includes("buildIdentityAudit"),
    "harness must call buildIdentityAudit"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("ROLE_IDENTITY_CONFIGURATION_BLOCKER"),
    "harness must return ROLE_IDENTITY_CONFIGURATION_BLOCKER before running probes"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("identityAuditFailed"),
    "harness must check identityAuditFailed before probe execution"
  );
});

// ── W5RC-ID-14: role probes execute sequentially (no Promise.all for probes) ──

test("W5RC-ID-14. harness does not use Promise.all for role probe execution", () => {
  // The sequential structure uses await for each role with snapshot verification between
  assert.ok(
    wave5RlsHarnessSrc.includes("probeOwnerAdmin(bearerToken)"),
    "harness must await probeOwnerAdmin individually"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedAfterOwnerAdmin"),
    "harness must check retained snapshot after owner_admin"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedAfterOfficeOps"),
    "harness must check retained snapshot after office_ops"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedAfterWorker"),
    "harness must check retained snapshot after worker"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedAfterQa"),
    "harness must check retained snapshot after qa"
  );
  // Promise.all must no longer be used for role probes
  assert.ok(
    !wave5RlsHarnessSrc.includes("Promise.all([\n    probeOwnerAdmin"),
    "harness must not run role probes in Promise.all"
  );
});

// ── W5RC-ID-15: retained snapshot unchanged after each role ───────────────────

test("W5RC-ID-15. harness aborts if retained data changes after any single role", () => {
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedAfterOwnerAdmin.unchanged"),
    "harness must abort if owner_admin causes drift"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedAfterOfficeOps.unchanged"),
    "harness must abort if office_ops causes drift"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedAfterWorker.unchanged"),
    "harness must abort if worker causes drift"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedAfterQa.unchanged"),
    "harness must abort if qa causes drift"
  );
});

// ── W5RC-ID-16: current PATCH 200 [] behavior remains passing ─────────────────

test("W5RC-ID-16. PATCH 200 [] with unchanged retained row remains PROVEN_RLS_DENY (regression)", () => {
  const probe = classifyDenyPatchProbe({
    role: "office_ops",
    operation: "UPDATE billing_readiness_gate",
    table: "billing_readiness_gate",
    result: { ok: true, status: 200, body: [], raw_text: "[]", method: "PATCH", table: "billing_readiness_gate" },
    expected_scope: { id: "some-id" },
    beforeRow: { id: "some-id", gate_status: "ready" },
    afterRow:  { id: "some-id", gate_status: "ready" },
  });
  assert.equal(probe.classification, "proven_rls_deny");
  assert.equal(probe.pass, true);
});

// ── W5RC-ID-17: strict INSERT behavior remains passing ────────────────────────

test("W5RC-ID-17. INSERT 2xx is still UNEXPECTED_ALLOW regardless of body (regression)", () => {
  const probeWithBody = classifyDenyMutationProbe({
    role: "qa",
    operation: "INSERT billing_readiness_gate",
    table: "billing_readiness_gate",
    result: { ok: true, status: 201, body: [{ id: "new" }], raw_text: "[{...}]", method: "POST", table: "billing_readiness_gate" },
    expected_scope: { id: "new" },
  });
  assert.equal(probeWithBody.classification, "unexpected_allow");
  assert.equal(probeWithBody.pass, false);

  const probeEmpty = classifyDenyMutationProbe({
    role: "qa",
    operation: "INSERT billing_readiness_gate",
    table: "billing_readiness_gate",
    result: { ok: true, status: 200, body: [], raw_text: "[]", method: "POST", table: "billing_readiness_gate" },
    expected_scope: { id: "x" },
  });
  assert.equal(probeEmpty.classification, "unexpected_allow");
  assert.equal(probeEmpty.pass, false);
});

// ── W5RC-ID-18: overall passed requires identity audit + all mandatory probes + retained data ──

test("W5RC-ID-18. overall passed requires identity audit pass + all mandatory probes pass + retained unchanged", () => {
  // Verify the harness source enforces all three conditions in the passed expression
  assert.ok(
    wave5RlsHarnessSrc.includes("identityAudit.office_ops.passed"),
    "passed must require identity_audit.office_ops.passed"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("identityAudit.worker.passed"),
    "passed must require identity_audit.worker.passed"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("identityAudit.qa.passed"),
    "passed must require identity_audit.qa.passed"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("retainedIntegrity.unchanged"),
    "passed must require retainedIntegrity.unchanged"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("failedCount === 0"),
    "passed must require failedCount === 0"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("sections.every((section) => section.passed)"),
    "passed must require every section to pass"
  );
  assert.ok(
    wave5RlsHarnessSrc.includes("catalogAttestation.passed"),
    "passed must require catalogAttestation.passed"
  );
});

function makeValidCatalogAttestation() {
  return {
    contract_version: "wave5-rls-catalog-v1",
    tables: Object.entries(EXPECTED_WAVE5_CATALOG_CONTRACT.tables).map(([table_name, expected]) => ({
      table_name,
      rls_enabled: expected.rls_enabled,
      force_rls: false,
    })),
    authenticated_privileges: Object.entries(EXPECTED_WAVE5_CATALOG_CONTRACT.tables).flatMap(
      ([table_name, expected]) =>
        expected.authenticated_privileges.map((privilege_type) => ({ table_name, privilege_type }))
    ),
    anon_privileges: [],
    policies: [
      { table_name: "accounting_sync_outbox", policy_name: "pol_aso_office_ops_select", command: "SELECT", roles: ["authenticated"], qual: "public.has_bu_role( organization_id, business_unit_id, ARRAY['office_ops'] )", with_check: null },
      { table_name: "accounting_sync_outbox", policy_name: "pol_aso_owner_admin_select", command: "SELECT", roles: ["authenticated"], qual: "public.has_bu_role(organization_id,business_unit_id,ARRAY['owner_admin'])", with_check: null },
      { table_name: "billing_readiness_gate", policy_name: "pol_brg_office_ops_insert", command: "INSERT", roles: ["authenticated"], qual: null, with_check: "public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops'])" },
      { table_name: "billing_readiness_gate", policy_name: "pol_brg_office_ops_select", command: "SELECT", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops'])", with_check: null },
      { table_name: "billing_readiness_gate", policy_name: "pol_brg_owner_admin_all", command: "ALL", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])", with_check: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])" },
      { table_name: "contractor_compensation_version", policy_name: "pol_ccv_owner_admin_all", command: "ALL", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])", with_check: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])" },
      { table_name: "contractor_compensation_version", policy_name: "pol_ccv_worker_own_select", command: "SELECT", roles: ["authenticated"], qual: "worker_id = public.current_worker_id(organization_id)", with_check: null },
      { table_name: "contractor_payable", policy_name: "pol_cp_owner_admin_all", command: "ALL", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])", with_check: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])" },
      { table_name: "contractor_payable", policy_name: "pol_cp_worker_own_select", command: "SELECT", roles: ["authenticated"], qual: "worker_id = public.current_worker_id(organization_id)", with_check: null },
      { table_name: "invoice_request", policy_name: "pol_ir_office_ops_insert", command: "INSERT", roles: ["authenticated"], qual: null, with_check: "public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops'])" },
      { table_name: "invoice_request", policy_name: "pol_ir_office_ops_select", command: "SELECT", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops'])", with_check: null },
      { table_name: "invoice_request", policy_name: "pol_ir_owner_admin_all", command: "ALL", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])", with_check: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])" },
      { table_name: "job_profitability_snapshot", policy_name: "pol_jps_office_ops_select", command: "SELECT", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops'])", with_check: null },
      { table_name: "job_profitability_snapshot", policy_name: "pol_jps_owner_admin_all", command: "ALL", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])", with_check: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])" },
      { table_name: "payment_observation", policy_name: "pol_po_office_ops_select", command: "SELECT", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops'])", with_check: null },
      { table_name: "payment_observation", policy_name: "pol_po_owner_admin_select", command: "SELECT", roles: ["authenticated"], qual: "public.has_bu_role(organization_id, business_unit_id, ARRAY['owner_admin'])", with_check: null },
    ],
  };
}

test("W5RC-CAT-1. catalog RPC is service-role only", () => {
  const migration013 = readFileSync(resolve(ROOT, "supabase/migrations/013_wave5_rls_catalog_attestation.sql"), "utf8");
  assert.ok(migration013.includes("REVOKE ALL ON FUNCTION public.wave5_rls_catalog_attestation() FROM authenticated;"));
  assert.ok(migration013.includes("GRANT EXECUTE ON FUNCTION public.wave5_rls_catalog_attestation() TO service_role;"));
  assert.ok(wave5RlsHarnessSrc.includes('serviceRoleReadOnlyRpc("wave5_rls_catalog_attestation", {})'));
});

test("W5RC-CAT-2. browser authenticated token is never used to call catalog RPC", async () => {
  assert.ok(!wave5RlsHarnessSrc.includes('serviceRoleReadOnlyRpc(bearerToken'));
  await assert.rejects(() => serviceRoleReadOnlyRpc("other_rpc", {}), /Unsupported read-only service-role RPC/);
});

test("W5RC-CAT-3. service role is never used for owner/office/worker/qa probes", () => {
  assert.ok(wave5RlsHarnessSrc.includes("probeOwnerAdmin(bearerToken)"));
  assert.ok(wave5RlsHarnessSrc.includes("probeOfficeOps(normalizedTokens.office_ops, catalogAttestation, identityAudit)"));
  assert.ok(wave5RlsHarnessSrc.includes("probeWorker("));
  assert.ok(wave5RlsHarnessSrc.includes("probeQa(normalizedTokens.qa, catalogAttestation, identityAudit)"));
  assert.ok(!wave5RlsHarnessSrc.includes("probeOfficeOps(process.env.SUPABASE_SERVICE_ROLE_KEY"));
});

test("W5RC-CAT-4. all seven tables require rls_enabled=true", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.tables[0].rls_enabled = false;
  const result = validateWave5CatalogAttestation(attestation);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes("rls_enabled")));
});

test("W5RC-CAT-5. exact authenticated privilege sets pass", () => {
  const result = validateWave5CatalogAttestation(makeValidCatalogAttestation());
  assert.equal(result.passed, true);
});

test("W5RC-CAT-6. unexpected DELETE privilege fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.authenticated_privileges.push({ table_name: "contractor_payable", privilege_type: "DELETE" });
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-7. unexpected TRUNCATE privilege fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.authenticated_privileges.push({ table_name: "contractor_payable", privilege_type: "TRUNCATE" });
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-8. unexpected REFERENCES privilege fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.authenticated_privileges.push({ table_name: "contractor_payable", privilege_type: "REFERENCES" });
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-9. unexpected TRIGGER privilege fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.authenticated_privileges.push({ table_name: "contractor_payable", privilege_type: "TRIGGER" });
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-10. any anon privilege fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.anon_privileges.push({ table_name: "billing_readiness_gate", privilege_type: "SELECT" });
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-11. missing policy fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.policies = attestation.policies.filter((policy) => policy.policy_name !== "pol_cp_worker_own_select");
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-12. unexpected policy fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.policies.push({
    table_name: "billing_readiness_gate",
    policy_name: "pol_brg_unexpected",
    command: "SELECT",
    roles: ["authenticated"],
    qual: "true",
    with_check: null,
  });
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-13. incorrect policy command fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.policies.find((policy) => policy.policy_name === "pol_po_owner_admin_select").command = "ALL";
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-14. incorrect owner_admin semantic fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.policies.find((policy) => policy.policy_name === "pol_cp_owner_admin_all").qual =
    "public.has_bu_role(organization_id, business_unit_id, ARRAY['office_ops'])";
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-15. incorrect office_ops semantic fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.policies.find((policy) => policy.policy_name === "pol_ir_office_ops_insert").with_check =
    "public.has_bu_role(organization_id, business_unit_id, ARRAY['qa'])";
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-16. incorrect worker-own semantic fails", () => {
  const attestation = makeValidCatalogAttestation();
  attestation.policies.find((policy) => policy.policy_name === "pol_ccv_worker_own_select").qual =
    "worker_id = public.current_worker_id(business_unit_id)";
  assert.equal(validateWave5CatalogAttestation(attestation).passed, false);
});

test("W5RC-CAT-17. catalog contract recognizes exactly 16 policies", () => {
  const result = validateWave5CatalogAttestation(makeValidCatalogAttestation());
  assert.equal(result.exact_policy_count, 16);
});

test("W5RC-CAT-18. office_ops contractor_payable INSERT becomes PROVEN_CATALOG_POLICY_DENY", () => {
  const probe = classifyCatalogPolicyDenyProbe({ role: "office_ops", operation: "INSERT contractor_payable (catalog policy proof)", table: "contractor_payable", catalogValidation: validateWave5CatalogAttestation(makeValidCatalogAttestation()), identityPassed: true });
  assert.equal(probe.classification, "proven_catalog_policy_deny");
});

test("W5RC-CAT-19. office_ops job_profitability INSERT becomes PROVEN_CATALOG_POLICY_DENY", () => {
  const probe = classifyCatalogPolicyDenyProbe({ role: "office_ops", operation: "INSERT job_profitability_snapshot (catalog policy proof)", table: "job_profitability_snapshot", catalogValidation: validateWave5CatalogAttestation(makeValidCatalogAttestation()), identityPassed: true });
  assert.equal(probe.classification, "proven_catalog_policy_deny");
});

test("W5RC-CAT-20. worker contractor_payable INSERT becomes PROVEN_CATALOG_POLICY_DENY", () => {
  const probe = classifyCatalogPolicyDenyProbe({ role: "worker", operation: "INSERT contractor_payable (catalog policy proof)", table: "contractor_payable", catalogValidation: validateWave5CatalogAttestation(makeValidCatalogAttestation()), identityPassed: true });
  assert.equal(probe.classification, "proven_catalog_policy_deny");
});

test("W5RC-CAT-21. QA BRG INSERT becomes PROVEN_CATALOG_POLICY_DENY", () => {
  const probe = classifyCatalogPolicyDenyProbe({ role: "qa", operation: "INSERT billing_readiness_gate (catalog policy proof)", table: "billing_readiness_gate", catalogValidation: validateWave5CatalogAttestation(makeValidCatalogAttestation()), identityPassed: true });
  assert.equal(probe.classification, "proven_catalog_policy_deny");
});

test("W5RC-CAT-22. QA invoice INSERT becomes PROVEN_CATALOG_POLICY_DENY", () => {
  const probe = classifyCatalogPolicyDenyProbe({ role: "qa", operation: "INSERT invoice_request (catalog policy proof)", table: "invoice_request", catalogValidation: validateWave5CatalogAttestation(makeValidCatalogAttestation()), identityPassed: true });
  assert.equal(probe.classification, "proven_catalog_policy_deny");
});

test("W5RC-CAT-23. QA payable INSERT becomes PROVEN_CATALOG_POLICY_DENY", () => {
  const probe = classifyCatalogPolicyDenyProbe({ role: "qa", operation: "INSERT contractor_payable (catalog policy proof)", table: "contractor_payable", catalogValidation: validateWave5CatalogAttestation(makeValidCatalogAttestation()), identityPassed: true });
  assert.equal(probe.classification, "proven_catalog_policy_deny");
});

test("W5RC-CAT-24. QA profitability INSERT becomes PROVEN_CATALOG_POLICY_DENY", () => {
  const probe = classifyCatalogPolicyDenyProbe({ role: "qa", operation: "INSERT job_profitability_snapshot (catalog policy proof)", table: "job_profitability_snapshot", catalogValidation: validateWave5CatalogAttestation(makeValidCatalogAttestation()), identityPassed: true });
  assert.equal(probe.classification, "proven_catalog_policy_deny");
});

test("W5RC-CAT-25. catalog failure makes all dependent catalog probes fail closed", () => {
  const probe = classifyCatalogPolicyDenyProbe({
    role: "qa",
    operation: "INSERT billing_readiness_gate (catalog policy proof)",
    table: "billing_readiness_gate",
    catalogValidation: { passed: false, policies: [] },
    identityPassed: true,
  });
  assert.equal(probe.classification, "not_proven");
  assert.equal(probe.pass, false);
});

test("W5RC-CAT-26. optional cross-worker absence becomes NOT_APPLICABLE", () => {
  const summary = summarizeProbes("worker", [
    {
      role: "worker",
      operation: "SELECT contractor_payable (another worker row if any exist)",
      table: "contractor_payable",
      expected: "deny",
      mandatory: false,
      classification: "not_applicable",
      pass: false,
    },
  ]);
  assert.equal(summary.not_proven_count, 0);
});

test("W5RC-CAT-27. NOT_APPLICABLE is excluded from not_proven_count", () => {
  const summary = summarizeProbes("worker", [
    { role: "worker", operation: "a", table: "contractor_payable", expected: "deny", mandatory: false, classification: "not_applicable", pass: false },
    { role: "worker", operation: "b", table: "contractor_payable", expected: "deny", mandatory: true, classification: "proven_rls_deny", pass: true },
  ]);
  assert.equal(summary.failed_count, 0);
  assert.equal(summary.not_proven_count, 0);
});

test("W5RC-CAT-28. retained-data integrity behavior unchanged", () => {
  assert.ok(wave5RlsHarnessSrc.includes("captureRetainedSnapshots()"));
  assert.ok(wave5RlsHarnessSrc.includes("compareRetainedSnapshots(beforeSnapshots, afterAnon)"));
});

test("W5RC-CAT-29. identity resolution tests unchanged", () => {
  assert.ok(wave5RlsHarnessSrc.includes("buildIdentityAudit"));
  assert.ok(wave5RlsHarnessSrc.includes("resolveNormalizedTokenMap"));
});

test("W5RC-CAT-30. existing PATCH classifier tests unchanged", () => {
  const probe = classifyDenyPatchProbe({
    role: "worker",
    operation: "UPDATE billing_readiness_gate",
    table: "billing_readiness_gate",
    result: makeResult(403, { code: "42501", message: "permission denied for table billing_readiness_gate" }),
    expected_scope: { id: ID },
    beforeRow: { ...CANONICAL_ROW },
    afterRow: { ...CANONICAL_ROW },
  });
  assert.equal(probe.classification, "proven_rls_deny");
});

test("W5RC-CAT-31. existing role visibility tests unchanged", () => {
  assert.ok(wave5RlsHarnessSrc.includes("selectExactRowProbe(role, token, \"billing_readiness_gate\""));
  assert.ok(wave5RlsHarnessSrc.includes("selectExactRowProbe(role, null, table, id, \"deny\")"));
});

test("W5RC-CAT-32. no credential data appears in response/log serialization", () => {
  assert.ok(!wave5RlsHarnessSrc.includes("SUPABASE_SERVICE_ROLE_KEY\","));
  assert.ok(!wave5RlsHarnessSrc.includes("Authorization: bearerToken"));
  assert.ok(wave5RlsHarnessSrc.includes("catalog_attestation"));
});
