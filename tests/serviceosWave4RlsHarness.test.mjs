// =============================================================================
// UNIT TESTS — Wave 4 RLS Acceptance Harness
// Tests the harness source without executing real DB operations.
// =============================================================================

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const harnessSrc = readFileSync(
  resolve(ROOT, "api/wave4-rls-acceptance-harness.js"),
  "utf8"
);
const stripeSrc = readFileSync(resolve(ROOT, "api/stripe-webhook.js"), "utf8");
const qbSrc = readFileSync(resolve(ROOT, "api/wave5-accounting-sync.js"), "utf8");
const mainSrc = readFileSync(resolve(ROOT, "src/main.jsx"), "utf8");

// ── Harness: source-level safety checks ───────────────────────────────────────

test("W4H-1. Wave 4 harness is Preview/test only — hard fail guard for production", () => {
  assert.ok(
    harnessSrc.includes("PROHIBITED in Production") ||
      harnessSrc.includes("preview") && harnessSrc.includes("production"),
    "Harness must explicitly prohibit production execution"
  );
  assert.ok(
    harnessSrc.includes("getEnvironment") || harnessSrc.includes("SERVICEOS_ENVIRONMENT"),
    "Harness must check SERVICEOS_ENVIRONMENT"
  );
});

test("W4H-2. Harness feature flag defaults OFF — requires explicit SERVICEOS_W4_RLS_HARNESS_ENABLED=true", () => {
  assert.ok(
    harnessSrc.includes("SERVICEOS_W4_RLS_HARNESS_ENABLED"),
    "Harness must check SERVICEOS_W4_RLS_HARNESS_ENABLED"
  );
  assert.ok(
    harnessSrc.includes("=== \"true\"") || harnessSrc.includes("=== 'true'"),
    "Harness feature flag must require explicit true value"
  );
});

test("W4H-3. No test passwords in harness source", () => {
  // No hardcoded passwords or credential values
  assert.ok(
    !/@[a-zA-Z0-9._%+-]+:[a-zA-Z0-9]{8,}/.test(harnessSrc),
    "Harness must not contain hardcoded credentials"
  );
  assert.ok(
    !harnessSrc.includes("password123") && !harnessSrc.includes("test1234"),
    "Harness must not contain example plaintext passwords"
  );
});

test("W4H-4. No test passwords in client bundle (no VITE_* credential vars)", () => {
  // Harness credentials must never use VITE_* prefix (would be exposed in client bundle)
  assert.ok(
    !harnessSrc.includes("VITE_SERVICEOS_W4_RLS"),
    "Harness credentials must NOT use VITE_* prefix (would expose to client bundle)"
  );
  assert.ok(
    !mainSrc.includes("VITE_SERVICEOS_W4_RLS"),
    "Client bundle must not include Wave 4 RLS credentials via VITE_*"
  );
});

test("W4H-5. Harness uses env var credentials only — no hardcoded identities", () => {
  assert.ok(
    harnessSrc.includes("SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL"),
    "Harness must reference SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL env var"
  );
  assert.ok(
    harnessSrc.includes("SERVICEOS_W4_RLS_WORKER_EMAIL"),
    "Harness must reference SERVICEOS_W4_RLS_WORKER_EMAIL env var"
  );
  assert.ok(
    harnessSrc.includes("SERVICEOS_W4_RLS_QA_EMAIL"),
    "Harness must reference SERVICEOS_W4_RLS_QA_EMAIL env var"
  );
  assert.ok(
    harnessSrc.includes("SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD"),
    "Harness must reference SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD env var"
  );
  assert.ok(
    harnessSrc.includes("SERVICEOS_W4_RLS_WORKER_PASSWORD"),
    "Harness must reference SERVICEOS_W4_RLS_WORKER_PASSWORD env var"
  );
  assert.ok(
    harnessSrc.includes("SERVICEOS_W4_RLS_QA_PASSWORD"),
    "Harness must reference SERVICEOS_W4_RLS_QA_PASSWORD env var"
  );
});

test("W4H-6. Each role uses its own authenticated access token (no service_role bypass)", () => {
  assert.ok(
    harnessSrc.includes("signInWithPassword") || harnessSrc.includes("grant_type=password"),
    "Harness must authenticate each role with password-based Supabase auth"
  );
  assert.ok(
    !harnessSrc.includes("SUPABASE_SERVICE_ROLE_KEY") ||
      harnessSrc.includes("SUPABASE_SERVICE_ROLE_KEY") === false,
    "Harness role probes must use user access tokens, not service role key"
  );
  // Explicitly: the service_role key is NOT referenced in the harness (probes use user tokens)
  assert.ok(
    !harnessSrc.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "Harness must not use SUPABASE_SERVICE_ROLE_KEY for role probes"
  );
});

test("W4H-7. Harness reports missing identities rather than creating them", () => {
  assert.ok(
    harnessSrc.includes("missing_identities"),
    "Harness must report missing identities"
  );
  assert.ok(
    !harnessSrc.includes("createUser") && !harnessSrc.includes("signUp"),
    "Harness must not automatically create auth users"
  );
  assert.ok(
    harnessSrc.includes("DO NOT create auth users") ||
      harnessSrc.includes("explicit authorization"),
    "Harness must document that user creation requires explicit authorization"
  );
});

test("W4H-8. Harness output contract includes all required fields", () => {
  assert.ok(harnessSrc.includes("contract_version"), "Contract must include contract_version");
  assert.ok(harnessSrc.includes("wave4-rls-acceptance-v1"), "Contract version must be wave4-rls-acceptance-v1");
  assert.ok(harnessSrc.includes('"office_ops"') || harnessSrc.includes("office_ops"), "Contract must include office_ops");
  assert.ok(harnessSrc.includes('"worker"') || harnessSrc.includes("worker"), "Contract must include worker");
  assert.ok(harnessSrc.includes('"qa"') || harnessSrc.includes("qa"), "Contract must include qa");
  assert.ok(harnessSrc.includes("passed"), "Contract must include top-level passed field");
});

test("W4H-9. Deny assertions treat HTTP permission/RLS denial correctly (not hard error)", () => {
  assert.ok(
    harnessSrc.includes("401") || harnessSrc.includes("403"),
    "Harness must treat HTTP 401/403 as successful deny"
  );
  assert.ok(
    harnessSrc.includes("rls_deny_empty_result") || harnessSrc.includes("empty"),
    "Harness must handle RLS deny-via-empty-result for SELECT operations"
  );
});

test("W4H-10. Successful unauthorized mutation is a hard FAIL", () => {
  assert.ok(
    harnessSrc.includes("expected: \"deny\"") || harnessSrc.includes("expected: 'deny'"),
    "Harness must label deny probes with expected=deny"
  );
  assert.ok(
    harnessSrc.includes("!actual_ok") || harnessSrc.includes("!result.ok"),
    "Harness must fail when a deny-expected operation succeeds (actual_ok=true)"
  );
});

test("W4H-11. No cleanup or deletion of Wave 3/4 retained evidence", () => {
  // The harness must not DELETE any Wave 3/4 records
  assert.ok(
    !harnessSrc.includes('"method": "DELETE"') ||
      harnessSrc.includes("id=eq.00000000"),
    "Harness DELETE probes use non-existent sentinel ID — no real records affected"
  );
  assert.ok(
    harnessSrc.includes("No cleanup") || harnessSrc.includes("no cleanup") ||
      harnessSrc.includes("retained evidence"),
    "Harness must document that no cleanup/deletion occurs"
  );
});

test("W4H-12. Harness probes cover office_ops, worker, and qa roles", () => {
  assert.ok(harnessSrc.includes("probeOfficeOps"), "Harness must probe office_ops");
  assert.ok(harnessSrc.includes("probeWorker"), "Harness must probe worker");
  assert.ok(harnessSrc.includes("probeQa"), "Harness must probe QA");
});

test("W4H-13. Harness correctly identifies Wave 4 tables under test", () => {
  assert.ok(
    harnessSrc.includes("work_order_governance_link"),
    "Harness must probe work_order_governance_link"
  );
  assert.ok(
    harnessSrc.includes("work_order_wave4_applicability"),
    "Harness must probe work_order_wave4_applicability"
  );
  assert.ok(
    harnessSrc.includes("qa_inspection"),
    "Harness must probe qa_inspection"
  );
  assert.ok(
    harnessSrc.includes("corrective_action"),
    "Harness must probe corrective_action"
  );
});

test("W4H-14. Harness declares runtime acceptance still must be executed separately", () => {
  assert.ok(
    harnessSrc.includes("Runtime acceptance still must determine") ||
      harnessSrc.includes("runtime acceptance"),
    "Harness must state that runtime acceptance execution is still pending"
  );
});

// ── Stripe webhook: A8/A9 checks ──────────────────────────────────────────────

test("W4H-15. Stripe webhook fails closed when SERVICEOS_ENVIRONMENT is missing/unknown (A8)", () => {
  assert.ok(
    stripeSrc.includes("SERVICEOS_ENVIRONMENT is not set") ||
      stripeSrc.includes("not a recognized value"),
    "Stripe webhook must fail closed when SERVICEOS_ENVIRONMENT is missing/unknown"
  );
  assert.ok(
    stripeSrc.includes("503") || stripeSrc.includes("fail-closed") ||
      stripeSrc.includes("FAIL CLOSED"),
    "Stripe webhook must return non-2xx for missing environment"
  );
});

test("W4H-16. Stripe webhook requires BOTH secret AND signature in production (A9)", () => {
  assert.ok(
    stripeSrc.includes("stripe-signature header is required in Production"),
    "Stripe webhook must require stripe-signature in production"
  );
  assert.ok(
    stripeSrc.includes("STRIPE_WEBHOOK_SECRET is required in Production"),
    "Stripe webhook must require STRIPE_WEBHOOK_SECRET in production"
  );
});

test("W4H-17. Stripe webhook returns retriable non-2xx for canonical persistence failures (A10)", () => {
  assert.ok(
    stripeSrc.includes("retriable") || stripeSrc.includes("503"),
    "Stripe webhook must return retriable non-2xx for canonical persistence failures"
  );
  assert.ok(
    stripeSrc.includes("CURRENCY_MISMATCH") || stripeSrc.includes("AMOUNT_MISMATCH"),
    "Stripe webhook must detect currency/amount mismatch"
  );
  assert.ok(
    stripeSrc.includes("SUPABASE_CONFIG_MISSING"),
    "Stripe webhook must detect missing Supabase config"
  );
});

test("W4H-18. Stripe webhook does not fail legacy non-Wave5 events due to missing lineage (A10)", () => {
  assert.ok(
    stripeSrc.includes("Legacy non-ServiceOS payment event") ||
      stripeSrc.includes("no job_id metadata"),
    "Stripe webhook must not fail legacy payment events due to missing Wave 5 lineage"
  );
});

// ── QB adapter: A6/A7/A8 checks ──────────────────────────────────────────────

test("W4H-19. QB adapter fails closed when SERVICEOS_ENVIRONMENT is missing/unknown (A8)", () => {
  assert.ok(
    qbSrc.includes("SERVICEOS_ENVIRONMENT is not set") ||
      qbSrc.includes("not a recognized value"),
    "QB adapter must fail closed when SERVICEOS_ENVIRONMENT is missing/unknown"
  );
});

test("W4H-20. QB adapter loads canonical monetary values from DB — not from client request (A6)", () => {
  assert.ok(
    qbSrc.includes("loadCanonicalInvoiceRequest") || qbSrc.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "QB adapter must load canonical invoice from DB via service role"
  );
  assert.ok(
    qbSrc.includes("canonicalCurrency") && qbSrc.includes("canonicalSubtotal"),
    "QB adapter must derive monetary values from canonical DB record"
  );
  // Verify client monetary fields are NOT used
  assert.ok(
    !qbSrc.includes("body.currency_code") && !qbSrc.includes("body.subtotal_amount"),
    "QB adapter must not use client-supplied monetary values"
  );
});

test("W4H-21. QB adapter uses accounting_sync_outbox as durable idempotency store (A7)", () => {
  assert.ok(
    qbSrc.includes("resolveOutboxByIdempotencyKey") || qbSrc.includes("accounting_sync_outbox"),
    "QB adapter must resolve outbox by idempotency key"
  );
  assert.ok(
    qbSrc.includes("acknowledged") && qbSrc.includes("provider_reference_id"),
    "QB adapter must return stored result when outbox is already acknowledged"
  );
  assert.ok(
    qbSrc.includes("idempotent: true"),
    "QB adapter must flag idempotent responses"
  );
});

test("W4H-22. QB preview adapter persists through governed outbox flow (A7)", () => {
  assert.ok(
    qbSrc.includes("is_test_adapter: true") && qbSrc.includes("preview_test"),
    "QB preview adapter must mark is_test_adapter=true and provider=preview_test"
  );
  assert.ok(
    qbSrc.includes("upsertOutboxRow"),
    "QB preview adapter must persist through outbox flow (same governed path)"
  );
});
