// =============================================================================
// UNIT TESTS — Wave 4 RLS Acceptance Harness / Wave 5 server-only sync
// Source-level contract checks only. No live DB operations are executed.
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
const previewPaymentSrc = readFileSync(resolve(ROOT, "api/wave5-preview-payment.js"), "utf8");
const panelSrc = readFileSync(resolve(ROOT, "src/features/pilot/ServiceOSWave5FinancePilotPanel.jsx"), "utf8");
const mainSrc = readFileSync(resolve(ROOT, "src/main.jsx"), "utf8");

// ── Harness: source-level safety checks ───────────────────────────────────────

test("W4H-1. Wave 4 harness is Preview/test only — hard fail guard for production", () => {
  assert.ok(
    harnessSrc.includes("PROHIBITED in Production") ||
      (harnessSrc.includes("preview") && harnessSrc.includes("production")),
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
    harnessSrc.includes('=== "true"') || harnessSrc.includes("=== 'true'"),
    "Harness feature flag must require explicit true value"
  );
});

test("W4H-3. No test passwords in harness source or client bundle", () => {
  assert.ok(
    !/@[a-zA-Z0-9._%+-]+:[a-zA-Z0-9]{8,}/.test(harnessSrc),
    "Harness must not contain hardcoded credentials"
  );
  assert.ok(
    !harnessSrc.includes("password123") && !harnessSrc.includes("test1234"),
    "Harness must not contain example plaintext passwords"
  );
  assert.ok(
    !harnessSrc.includes("VITE_SERVICEOS_W4_RLS") && !mainSrc.includes("VITE_SERVICEOS_W4_RLS"),
    "Wave 4 RLS credentials must never use VITE_*"
  );
});

test("W4H-4. Harness uses env var credentials only — no hardcoded identities", () => {
  for (const key of [
    "SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL",
    "SERVICEOS_W4_RLS_WORKER_EMAIL",
    "SERVICEOS_W4_RLS_QA_EMAIL",
    "SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD",
    "SERVICEOS_W4_RLS_WORKER_PASSWORD",
    "SERVICEOS_W4_RLS_QA_PASSWORD",
  ]) {
    assert.ok(harnessSrc.includes(key), `Harness must reference ${key}`);
  }
});

test("W4H-5. Each authenticated role uses its own access token; anon uses apikey only", () => {
  assert.ok(
    harnessSrc.includes("signInWithPassword") || harnessSrc.includes("grant_type=password"),
    "Harness must authenticate each role with password-based Supabase auth"
  );
  assert.ok(
    !harnessSrc.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "Harness role probes must not use service role credentials"
  );
  assert.ok(
    harnessSrc.includes("SUPABASE_ANON_KEY"),
    "Harness must reference SUPABASE_ANON_KEY"
  );
  assert.ok(
    harnessSrc.includes("apikey: anonKey"),
    "Harness auth and REST probes must send the anon key as apikey"
  );
  assert.ok(
    harnessSrc.includes("probeAnon(") && harnessSrc.includes("work_order"),
    "Harness must include an anonymous probe with no bearer token"
  );
});

test("W4H-6. Harness reports missing identities rather than creating them", () => {
  assert.ok(harnessSrc.includes("missing_identities"), "Harness must report missing identities");
  assert.ok(
    !harnessSrc.includes("createUser") && !harnessSrc.includes("signUp"),
    "Harness must not automatically create auth users"
  );
  assert.ok(
    harnessSrc.includes("DO NOT create auth users"),
    "Harness must document that user creation requires explicit authorization"
  );
});

test("W4H-7. Harness output contract is authoritative v2 and includes anon + proof counts", () => {
  assert.ok(harnessSrc.includes("wave4-rls-acceptance-v2"), "Contract version must be v2");
  for (const field of [
    "office_ops",
    "worker",
    "qa",
    "anon",
    "passed",
    "proven_count",
    "failed_count",
    "not_proven_count",
    "environment",
    "run_at",
  ]) {
    assert.ok(harnessSrc.includes(field), `Contract must include ${field}`);
  }
});

test("W4H-8. Harness locks to retained Wave 4 acceptance scope IDs", () => {
  for (const id of [
    "e1100000-0000-0000-0000-00000000000e",
    "e1100000-0000-0000-0000-000000000011",
    "e1100000-0000-0000-0000-000000000010",
    "1b3a6903-0c50-4a95-afc3-280628c10508",
    "e1100000-0000-0000-0000-000000000012",
  ]) {
    assert.ok(harnessSrc.includes(id), `Harness must reference retained fixture ID ${id}`);
  }
});

test("W4H-9. Harness deny classification distinguishes proven RLS from validation/not_proven/transport", () => {
  for (const value of [
    "proven_rls_deny",
    "unexpected_allow",
    "validation_failure",
    "not_proven",
    "transport_failure",
    "db_immutability_proof",
    "proven_authz_deny",
  ]) {
    assert.ok(harnessSrc.includes(value), `Harness must include deny classification ${value}`);
  }
});

test("W4H-10. Harness allow proofs require retained-scope rows — not generic limit=5 reads", () => {
  assert.ok(
    harnessSrc.includes("Allow proof requires") || harnessSrc.includes("retained expected fixture row/scope"),
    "Harness must document retained-scope allow proof semantics"
  );
  assert.ok(
    !harnessSrc.includes("?limit=5"),
    "Harness must not use unfiltered ?limit=5 reads as acceptance proof"
  );
});

test("W4H-11. Harness no longer uses invented cross-org UUIDs or sentinel DELETE IDs", () => {
  assert.ok(
    !harnessSrc.includes("00000000-0000-0000-0000-000000000099"),
    "Harness must not use invented cross-org UUID probes"
  );
  assert.ok(
    !harnessSrc.includes("00000000-0000-0000-0000-000000000000"),
    "Harness must not use non-existent sentinel DELETE IDs as proof"
  );
});

test("W4H-12. Harness pass/fail requires mandatory proof and reports optional not_proven separately", () => {
  assert.ok(
    harnessSrc.includes("mandatory_not_proven_count"),
    "Harness must report mandatory not_proven separately"
  );
  assert.ok(
    harnessSrc.includes("sections.every((section) => section.passed)"),
    "Harness must derive top-level pass from per-section mandatory proofs"
  );
  assert.ok(
    harnessSrc.includes("optional_not_proven_count"),
    "Harness must report optional not_proven separately"
  );
});

test("W4H-13. Harness declares runtime acceptance still must be executed separately", () => {
  assert.ok(
    harnessSrc.includes("Runtime acceptance still must determine") ||
      harnessSrc.includes("must NOT be executed here"),
    "Harness must state that runtime acceptance execution is still pending"
  );
});

// ── Stripe webhook: A8/A9 checks ──────────────────────────────────────────────

test("W4H-14. Stripe webhook fails closed when SERVICEOS_ENVIRONMENT is missing/unknown (A8)", () => {
  assert.ok(
    stripeSrc.includes("SERVICEOS_ENVIRONMENT is not set") || stripeSrc.includes("not a recognized value"),
    "Stripe webhook must fail closed when SERVICEOS_ENVIRONMENT is missing/unknown"
  );
  assert.ok(
    stripeSrc.includes("503") || stripeSrc.includes("fail-closed") || stripeSrc.includes("FAIL CLOSED"),
    "Stripe webhook must return non-2xx for missing environment"
  );
});

test("W4H-15. Stripe webhook requires BOTH secret AND signature in production (A9)", () => {
  assert.ok(
    stripeSrc.includes("stripe-signature header is required in Production"),
    "Stripe webhook must require stripe-signature in production"
  );
  assert.ok(
    stripeSrc.includes("STRIPE_WEBHOOK_SECRET is required in Production"),
    "Stripe webhook must require STRIPE_WEBHOOK_SECRET in production"
  );
});

// ── QB adapter / server-only sync checks ──────────────────────────────────────

test("W4H-16. QB adapter loads canonical monetary values from DB and uses durable idempotency (A6/A7)", () => {
  assert.ok(qbSrc.includes("loadCanonicalInvoiceRequest"), "QB adapter must load canonical invoice_request from DB");
  assert.ok(qbSrc.includes("SUPABASE_SERVICE_ROLE_KEY"), "QB adapter must use service role for canonical DB reads");
  assert.ok(qbSrc.includes("resolveOutboxByIdempotencyKey"), "QB adapter must resolve accounting_sync_outbox by idempotency_key");
  assert.ok(
    qbSrc.includes("idempotent: true") || qbSrc.includes("already acknowledged"),
    "QB adapter must return stored results for acknowledged idempotent requests"
  );
});

test("W4H-17. QB adapter rejects client monetary inputs and fails closed on environment (A6/A8)", () => {
  assert.ok(
    !qbSrc.includes("body.currency_code") &&
      !qbSrc.includes("body.subtotal_amount") &&
      !qbSrc.includes("body.tax_amount") &&
      !qbSrc.includes("body.total_amount"),
    "QB adapter must not trust client-supplied monetary values"
  );
  assert.ok(
    !qbSrc.includes('|| "test"') && !qbSrc.includes("|| 'test'"),
    "QB adapter must not default the environment to test"
  );
});

test("W4H-18. QB adapter now requires ServiceOS bearer auth for server-only sync", () => {
  for (const token of [
    "extractBearerToken",
    "/auth/v1/user",
    "SUPABASE_ANON_KEY",
    "ServiceOS bearer token validation failed",
    "loadAuthenticatedAuthUser",
  ]) {
    assert.ok(qbSrc.includes(token), `QB adapter must include ${token}`);
  }
});

// ── Pilot panel: browser must POST to server-only adapter ─────────────────────

test("W4H-19. Wave 5 pilot panel posts invoice_request_id + idempotency_key to /api/wave5-accounting-sync", () => {
  assert.ok(panelSrc.includes('fetch("/api/wave5-accounting-sync"'), "Pilot panel must POST to /api/wave5-accounting-sync");
  assert.ok(panelSrc.includes("invoice_request_id") && panelSrc.includes("idempotency_key"), "Pilot panel must send canonical request fields only");
  assert.ok(!panelSrc.includes("ir-${invoiceRequestId}-v1"), "Pilot panel must require an explicit idempotency_key input");
});

test("W4H-20. Wave 5 pilot panel sends the current ServiceOS bearer token and no longer writes accounting_sync_outbox directly", () => {
  assert.ok(panelSrc.includes("Authorization:") && panelSrc.includes("accessToken"), "Pilot panel must send the current ServiceOS bearer token");
  assert.ok(!panelSrc.includes("enqueueAccountingSync("), "Pilot panel must not call enqueueAccountingSync directly anymore");
});

test("W4H-21. Preview payment now uses a server-only endpoint with bearer auth", () => {
  assert.ok(panelSrc.includes('fetch("/api/wave5-preview-payment"'), "Pilot panel must POST preview payments to the server-only endpoint");
  assert.ok(panelSrc.includes("provider_event_id"), "Pilot panel must send provider_event_id for preview payment idempotency");
  assert.ok(!panelSrc.includes("observePayment("), "Pilot panel must remove the direct browser payment_observation insert path");
  for (const token of [
    "SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED",
    "owner_admin",
    "office_ops",
    "payment_observation",
    "\"preview_test\"",
  ]) {
    assert.ok(previewPaymentSrc.includes(token), `Preview payment endpoint must include ${token}`);
  }
});
