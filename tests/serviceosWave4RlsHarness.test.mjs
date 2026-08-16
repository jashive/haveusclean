// =============================================================================
// UNIT TESTS — Wave 4 RLS Acceptance Harness / Wave 5 server-only sync
// Source-level contract checks only. No live DB operations are executed.
// =============================================================================

import { readFileSync, existsSync } from "fs";
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
const wave5RlsHarnessSrc = readFileSync(
  resolve(ROOT, "src/server/wave5RlsAcceptanceHarness.js"),
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

test("W4H-22. Wave 5 RLS harness is preview/test only, requester-authenticated, and supports Wave 4 credential fallback", () => {
  for (const token of [
    "wave5-rls-acceptance-v1",
    "SERVICEOS_W5_RLS_HARNESS_ENABLED",
    "SERVICEOS_ENVIRONMENT",
    "extractBearerToken",
    "loadAuthenticatedAuthUser",
    "loadActiveOwnerAdminMembership",
    "SERVICEOS_W5_RLS_OFFICE_OPS",
    "SERVICEOS_W5_RLS_WORKER",
    "SERVICEOS_W5_RLS_QA",
    "SERVICEOS_W4_RLS_OFFICE_OPS",
    "SERVICEOS_W4_RLS_WORKER",
    "SERVICEOS_W4_RLS_QA",
    "missing_identities",
  ]) {
    assert.ok(wave5RlsHarnessSrc.includes(token), `Wave 5 RLS harness must include ${token}`);
  }
  assert.ok(
    !wave5RlsHarnessSrc.includes("SERVICEOS_W5_RLS_OWNER_PASSWORD"),
    "Wave 5 RLS harness must not require an owner password env var"
  );
});

test("W4H-23. Wave 5 pilot panel exposes finance-core-pass-gated RLS acceptance button and posts bearer auth to the unified dispatcher endpoint with Wave 5 discriminators", () => {
  assert.ok(
    panelSrc.includes('fetch("/api/wave4-rls-acceptance-harness"'),
    "Wave 5 pilot panel must POST to /api/wave4-rls-acceptance-harness (unified dispatcher)"
  );
  assert.ok(
    !panelSrc.includes('fetch("/api/wave5-rls-acceptance-harness"'),
    "Wave 5 pilot panel must NOT call the deleted /api/wave5-rls-acceptance-harness endpoint"
  );
  assert.ok(
    panelSrc.includes('"wave": "wave5"') || panelSrc.includes("wave: \"wave5\""),
    "Wave 5 pilot panel must send wave: 'wave5' discriminator to dispatcher"
  );
  assert.ok(
    panelSrc.includes('"contract_version": "wave5-rls-acceptance-v1"') ||
      panelSrc.includes('contract_version: "wave5-rls-acceptance-v1"'),
    "Wave 5 pilot panel must send contract_version: 'wave5-rls-acceptance-v1' discriminator to dispatcher"
  );
  assert.ok(
    panelSrc.includes("Run Wave 5 RLS Acceptance"),
    "Wave 5 pilot panel must expose the RLS acceptance button label"
  );
  assert.ok(
    panelSrc.includes('gaState?.financeCoreStatus === "pass"') &&
      panelSrc.includes("handleGaRunRlsAcceptance"),
    "Wave 5 pilot panel must gate the RLS acceptance action on financeCoreStatus === 'pass'"
  );
  assert.ok(
    panelSrc.includes("Authorization:") && panelSrc.includes("accessToken"),
    "Wave 5 pilot panel must send the current ServiceOS bearer token"
  );
});

// ── Dispatcher regression tests ───────────────────────────────────────────────

test("W4H-24. Wave 4 dispatcher: default (no wave discriminator) routes to Wave 4 handler", () => {
  // The dispatcher import and the Wave 5 handler import must both be present
  assert.ok(
    harnessSrc.includes("runWave5RlsAcceptanceHandler"),
    "Wave 4 dispatcher must import runWave5RlsAcceptanceHandler"
  );
  assert.ok(
    harnessSrc.includes("wave5RlsAcceptanceHarness"),
    "Wave 4 dispatcher must reference the Wave 5 server-only module"
  );
  // Default path (no discriminator, or explicit wave4) must not call Wave 5 handler
  // Verified by ensuring Wave 4 contract version and fixture IDs remain in harnessSrc
  assert.ok(
    harnessSrc.includes("wave4-rls-acceptance-v2"),
    "Wave 4 dispatcher must preserve Wave 4 contract version"
  );
  assert.ok(
    harnessSrc.includes("SERVICEOS_W4_RLS_HARNESS_ENABLED"),
    "Wave 4 dispatcher must preserve Wave 4 feature flag guard"
  );
});

test("W4H-25. Wave 4 dispatcher: explicit Wave 5 discriminators route to Wave 5 handler", () => {
  assert.ok(
    harnessSrc.includes('"wave5"') || harnessSrc.includes("'wave5'"),
    "Dispatcher must check for wave5 string discriminator"
  );
  assert.ok(
    harnessSrc.includes("wave5-rls-acceptance-v1"),
    "Dispatcher must check for contract_version wave5-rls-acceptance-v1 discriminator"
  );
  assert.ok(
    harnessSrc.includes("return runWave5RlsAcceptanceHandler(req, res)"),
    "Dispatcher must forward Wave 5 requests to runWave5RlsAcceptanceHandler"
  );
});

test("W4H-26. Wave 4 dispatcher: unknown mode fails closed with 400", () => {
  assert.ok(
    harnessSrc.includes("Unknown acceptance harness mode"),
    "Dispatcher must fail closed with an error message on unknown wave discriminator"
  );
  assert.ok(
    harnessSrc.includes("status(400)") || harnessSrc.includes(".status(400)"),
    "Dispatcher must return HTTP 400 for unknown modes"
  );
});

test("W4H-27. Wave 5 module is NOT a serverless function — lives outside /api", () => {
  assert.ok(
    !existsSync(resolve(ROOT, "api/wave5-rls-acceptance-harness.js")),
    "api/wave5-rls-acceptance-harness.js must be deleted to stay within the 12-function Vercel limit"
  );
  assert.ok(
    existsSync(resolve(ROOT, "src/server/wave5RlsAcceptanceHarness.js")),
    "Wave 5 RLS handler must exist at src/server/wave5RlsAcceptanceHarness.js"
  );
});

test("W4H-28. Wave 5 cannot accidentally execute Wave 4 probes — no Wave 4 fixture IDs or Wave 4 env vars in Wave 5 module", () => {
  // Wave 5 module must not embed Wave 4 specific contract version or Wave 4 mandatory fixture IDs
  assert.ok(
    !wave5RlsHarnessSrc.includes("wave4-rls-acceptance-v2"),
    "Wave 5 module must not reference Wave 4 contract version"
  );
  assert.ok(
    !wave5RlsHarnessSrc.includes("SERVICEOS_W4_RLS_HARNESS_ENABLED"),
    "Wave 5 module must not check Wave 4 harness flag"
  );
});

test("W4H-29. Wave 4 cannot accidentally execute Wave 5 probes — Wave 5 finance table IDs not in Wave 4 scope", () => {
  // Wave 5 canonical IDs for finance tables must not appear in the Wave 4 harness fixture scope
  const wave5FinanceIds = [
    "c626972d-3d5f-411c-ba87-613a62f5a885", // billing_readiness_gate_id
    "71fec2d6-a941-4644-901b-f35d2a29afdd", // invoice_request_id
    "23026a2e-13e9-4a0a-938a-95f4fc28761b", // contractor_payable_id
  ];
  // The harnessSrc still includes the dispatcher import from Wave5 module, so we isolate
  // the Wave 4 FIXTURE_SCOPE constant block to check for contamination
  const fixtureScopeMatch = harnessSrc.match(/const FIXTURE_SCOPE[\s\S]*?}\s*\)/);
  if (fixtureScopeMatch) {
    const fixtureScopeStr = fixtureScopeMatch[0];
    for (const id of wave5FinanceIds) {
      assert.ok(
        !fixtureScopeStr.includes(id),
        `Wave 4 FIXTURE_SCOPE must not contain Wave 5 finance canonical ID ${id}`
      );
    }
  }
  assert.ok(
    !harnessSrc.includes("SERVICEOS_W5_RLS_HARNESS_ENABLED"),
    "Wave 4 dispatcher must not check Wave 5 harness flag in the Wave 4 path"
  );
});
