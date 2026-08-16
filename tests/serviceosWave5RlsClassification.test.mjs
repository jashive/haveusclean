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
  classifyDenyPatchProbe,
  classifyDenyMutationProbe,
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

function makeResult(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    raw_text: typeof body === "string" ? body : JSON.stringify(body ?? ""),
    method: "PATCH",
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
    result: makeResult(200, [{ id: "new-id" }]),
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
    result: makeResult(200, []),
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
