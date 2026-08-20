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
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");
const combined = (publicPath, implPath) => `${read(publicPath)}\n${read(implPath)}`;

const harnessPublicSrc = read("api/wave4-rls-acceptance-harness.js");
const harnessSrc = combined("api/wave4-rls-acceptance-harness.js", "server-internal/wave4-rls-acceptance-harness-impl.js");
const wave5RlsHarnessSrc = read("src/server/wave5RlsAcceptanceHarness.js");
const stripePublicSrc = read("api/stripe-webhook.js");
const stripeSrc = combined("api/stripe-webhook.js", "server-internal/stripe-webhook-impl.js");
const qbPublicSrc = read("api/wave5-accounting-sync.js");
const qbSrc = combined("api/wave5-accounting-sync.js", "server-internal/wave5-accounting-sync-impl.js");
const previewPaymentSrc = combined("api/wave5-preview-payment.js", "server-internal/wave5-preview-payment-impl.js");
const panelSrc = read("src/features/pilot/ServiceOSWave5FinancePilotPanel.jsx");
const mainSrc = read("src/main.jsx");

// ── Harness: source-level safety checks ───────────────────────────────────────

test("W4H-1. Wave 4 harness is Preview/test only — hard fail guard for production", () => {
  assert.ok(harnessPublicSrc.includes("allowProduction: false"), "Public harness must prohibit Production through the canonical server target guard");
  assert.ok(harnessPublicSrc.includes("requireServiceosServerTarget"), "Harness must use the canonical server target guard");
});

test("W4H-2. Harness feature flag defaults OFF — requires explicit SERVICEOS_W4_RLS_HARNESS_ENABLED=true", () => {
  assert.ok(harnessSrc.includes("SERVICEOS_W4_RLS_HARNESS_ENABLED"));
  assert.ok(harnessSrc.includes('=== "true"') || harnessSrc.includes("=== 'true'"));
});

test("W4H-3. No test passwords in harness source or client bundle", () => {
  assert.ok(!/@[a-zA-Z0-9._%+-]+:[a-zA-Z0-9]{8,}/.test(harnessSrc));
  assert.ok(!harnessSrc.includes("password123") && !harnessSrc.includes("test1234"));
  assert.ok(!harnessSrc.includes("VITE_SERVICEOS_W4_RLS") && !mainSrc.includes("VITE_SERVICEOS_W4_RLS"));
});

test("W4H-4. Harness uses env var credentials only — no hardcoded identities", () => {
  for (const key of [
    "SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL", "SERVICEOS_W4_RLS_WORKER_EMAIL", "SERVICEOS_W4_RLS_QA_EMAIL",
    "SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD", "SERVICEOS_W4_RLS_WORKER_PASSWORD", "SERVICEOS_W4_RLS_QA_PASSWORD",
  ]) assert.ok(harnessSrc.includes(key), `Harness must reference ${key}`);
});

test("W4H-5. Each authenticated role uses its own access token; anon uses apikey only", () => {
  assert.ok(harnessSrc.includes("signInWithPassword") || harnessSrc.includes("grant_type=password"));
  assert.ok(!harnessSrc.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(harnessSrc.includes("SUPABASE_ANON_KEY") && harnessSrc.includes("apikey: anonKey"));
  assert.ok(harnessSrc.includes("probeAnon(") && harnessSrc.includes("work_order"));
});

test("W4H-6. Harness reports missing identities rather than creating them", () => {
  assert.ok(harnessSrc.includes("missing_identities"));
  assert.ok(!harnessSrc.includes("createUser") && !harnessSrc.includes("signUp"));
  assert.ok(harnessSrc.includes("DO NOT create auth users"));
});

test("W4H-7. Harness output contract is authoritative v2 and includes anon + proof counts", () => {
  assert.ok(harnessSrc.includes("wave4-rls-acceptance-v2"));
  for (const field of ["office_ops","worker","qa","anon","passed","proven_count","failed_count","not_proven_count","environment","run_at"])
    assert.ok(harnessSrc.includes(field), `Contract must include ${field}`);
});

test("W4H-8. Harness locks to retained Wave 4 acceptance scope IDs", () => {
  for (const id of [
    "e1100000-0000-0000-0000-00000000000e", "e1100000-0000-0000-0000-000000000011",
    "e1100000-0000-0000-0000-000000000010", "1b3a6903-0c50-4a95-afc3-280628c10508",
    "e1100000-0000-0000-0000-000000000012",
  ]) assert.ok(harnessSrc.includes(id), `Harness must reference retained fixture ID ${id}`);
});

test("W4H-9. Harness deny classification distinguishes proven RLS from validation/not_proven/transport", () => {
  for (const value of ["proven_rls_deny","unexpected_allow","validation_failure","not_proven","transport_failure","db_immutability_proof","proven_authz_deny"])
    assert.ok(harnessSrc.includes(value), `Harness must include ${value}`);
});

test("W4H-10. Harness allow proofs require retained-scope rows — not generic limit=5 reads", () => {
  assert.ok(harnessSrc.includes("Allow proof requires") || harnessSrc.includes("retained expected fixture row/scope"));
  assert.ok(!harnessSrc.includes("?limit=5"));
});

test("W4H-11. Harness no longer uses invented cross-org UUIDs or sentinel DELETE IDs", () => {
  assert.ok(!harnessSrc.includes("00000000-0000-0000-0000-000000000099"));
  assert.ok(!harnessSrc.includes("00000000-0000-0000-0000-000000000000"));
});

test("W4H-12. Harness pass/fail requires mandatory proof and reports optional not_proven separately", () => {
  assert.ok(harnessSrc.includes("mandatory_not_proven_count"));
  assert.ok(harnessSrc.includes("sections.every((section) => section.passed)"));
  assert.ok(harnessSrc.includes("optional_not_proven_count"));
});

test("W4H-13. Harness declares runtime acceptance still must be executed separately", () => {
  assert.ok(harnessSrc.includes("Runtime acceptance still must determine") || harnessSrc.includes("must NOT be executed here"));
});

// ── Stripe webhook: corrected A8/A9 checks ───────────────────────────────────

test("W4H-14. Stripe legacy webhook stays independent while explicit Wave5 persistence fails closed on ServiceOS target", () => {
  const wave5Classifier = stripePublicSrc.indexOf("isWave5InvoiceEvent(session)");
  const targetGuard = stripePublicSrc.indexOf("requireServiceosServerTarget");
  assert.ok(stripePublicSrc.includes("Legacy non-ServiceOS checkout traffic remains independent"));
  assert.ok(wave5Classifier >= 0, "Public webhook must explicitly classify Wave5 events");
  assert.ok(targetGuard >= 0, "Explicit Wave5 persistence must use the canonical target guard");
  assert.ok(stripePublicSrc.includes("Wave5 canonical payment target validation failed"));
  assert.ok(stripePublicSrc.includes("if (!isWave5)"), "Legacy events must return on the historical path before ServiceOS target validation");
});

test("W4H-15. Stripe webhook requires BOTH secret AND signature in production (A9)", () => {
  assert.ok(stripePublicSrc.includes("stripe-signature header is required in Production"));
  assert.ok(stripePublicSrc.includes("STRIPE_WEBHOOK_SECRET is required in Production"));
});

// ── QB adapter / server-only sync checks ──────────────────────────────────────

test("W4H-16. QB adapter loads canonical monetary values from DB and uses durable idempotency (A6/A7)", () => {
  assert.ok(qbSrc.includes("loadCanonicalInvoiceRequest"));
  assert.ok(qbSrc.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(qbSrc.includes("resolveOutboxByIdempotencyKey"));
  assert.ok(qbSrc.includes("idempotent: true") || qbSrc.includes("already acknowledged"));
});

test("W4H-17. QB adapter rejects client monetary inputs and fails closed on environment (A6/A8)", () => {
  assert.ok(!qbSrc.includes("body.currency_code") && !qbSrc.includes("body.subtotal_amount") && !qbSrc.includes("body.tax_amount") && !qbSrc.includes("body.total_amount"));
  assert.ok(!qbSrc.includes('|| "test"') && !qbSrc.includes("|| 'test'"));
  assert.ok(qbPublicSrc.includes("requireServiceosServerTarget"));
});

test("W4H-18. QB adapter now requires ServiceOS bearer auth for server-only sync", () => {
  for (const token of ["extractBearerToken","/auth/v1/user","SUPABASE_ANON_KEY","ServiceOS bearer token validation failed","loadAuthenticatedAuthUser"])
    assert.ok(qbSrc.includes(token), `QB adapter must include ${token}`);
});

test("W4H-19. Wave 5 pilot panel posts invoice_request_id + idempotency_key to /api/wave5-accounting-sync", () => {
  assert.ok(panelSrc.includes('fetch("/api/wave5-accounting-sync"'));
  assert.ok(panelSrc.includes("invoice_request_id") && panelSrc.includes("idempotency_key"));
  assert.ok(!panelSrc.includes("ir-${invoiceRequestId}-v1"));
});

test("W4H-20. Wave 5 pilot panel sends the current ServiceOS bearer token and no longer writes accounting_sync_outbox directly", () => {
  assert.ok(panelSrc.includes("Authorization:") && panelSrc.includes("accessToken"));
  assert.ok(!panelSrc.includes("enqueueAccountingSync("));
});

test("W4H-21. Preview payment now uses a server-only endpoint with bearer auth", () => {
  assert.ok(panelSrc.includes('fetch("/api/wave5-preview-payment"'));
  assert.ok(panelSrc.includes("provider_event_id"));
  assert.ok(!panelSrc.includes("observePayment("));
  for (const token of ["SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED","owner_admin","office_ops","payment_observation","\"preview_test\""])
    assert.ok(previewPaymentSrc.includes(token), `Preview payment endpoint must include ${token}`);
});

test("W4H-22. Wave 5 RLS harness is preview/test only, requester-authenticated, and supports Wave 4 credential fallback", () => {
  for (const token of [
    "wave5-rls-acceptance-v1","SERVICEOS_W5_RLS_HARNESS_ENABLED","SERVICEOS_ENVIRONMENT","extractBearerToken",
    "loadAuthenticatedAuthUser","loadActiveOwnerAdminMembership","SERVICEOS_W5_RLS_OFFICE_OPS","SERVICEOS_W5_RLS_WORKER",
    "SERVICEOS_W5_RLS_QA","SERVICEOS_W4_RLS_OFFICE_OPS","SERVICEOS_W4_RLS_WORKER","SERVICEOS_W4_RLS_QA","missing_identities",
  ]) assert.ok(wave5RlsHarnessSrc.includes(token), `Wave 5 RLS harness must include ${token}`);
  assert.ok(!wave5RlsHarnessSrc.includes("SERVICEOS_W5_RLS_OWNER_PASSWORD"));
});

test("W4H-23. Wave 5 pilot panel exposes finance-core-pass-gated RLS acceptance button and posts bearer auth to the unified dispatcher endpoint with Wave 5 discriminators", () => {
  assert.ok(panelSrc.includes('fetch("/api/wave4-rls-acceptance-harness"'));
  assert.ok(!panelSrc.includes('fetch("/api/wave5-rls-acceptance-harness"'));
  assert.ok(panelSrc.includes('"wave": "wave5"') || panelSrc.includes('wave: "wave5"'));
  assert.ok(panelSrc.includes('"contract_version": "wave5-rls-acceptance-v1"') || panelSrc.includes('contract_version: "wave5-rls-acceptance-v1"'));
  assert.ok(panelSrc.includes("Run Wave 5 RLS Acceptance"));
  assert.ok(panelSrc.includes('gaState?.financeCoreStatus === "pass"') && panelSrc.includes("handleGaRunRlsAcceptance"));
  assert.ok(panelSrc.includes("Authorization:") && panelSrc.includes("accessToken"));
});

// ── Dispatcher regression tests ───────────────────────────────────────────────

test("W4H-24. Wave 4 dispatcher: default (no wave discriminator) routes to Wave 4 handler", () => {
  assert.ok(harnessPublicSrc.includes("runWave5RlsAcceptanceHandler"));
  assert.ok(harnessPublicSrc.includes("wave5RlsAcceptanceHarness"));
  assert.ok(harnessSrc.includes("wave4-rls-acceptance-v2"));
  assert.ok(harnessSrc.includes("SERVICEOS_W4_RLS_HARNESS_ENABLED"));
});

test("W4H-25. Wave 4 dispatcher: explicit Wave 5 discriminators route to Wave 5 handler", () => {
  assert.ok(harnessPublicSrc.includes('"wave5"') || harnessPublicSrc.includes("'wave5'"));
  assert.ok(harnessPublicSrc.includes("wave5-rls-acceptance-v1"));
  assert.ok(harnessPublicSrc.includes("return runWave5RlsAcceptanceHandler(req, res)"));
});

test("W4H-26. Wave 4 dispatcher: unknown mode fails closed with 400", () => {
  assert.ok(harnessPublicSrc.includes("Unknown acceptance harness mode"));
  assert.ok(harnessPublicSrc.includes("status(400)"));
});

test("W4H-27. Wave 5 module is NOT a serverless function — lives outside /api", () => {
  assert.ok(!existsSync(resolve(ROOT, "api/wave5-rls-acceptance-harness.js")));
  assert.ok(existsSync(resolve(ROOT, "src/server/wave5RlsAcceptanceHarness.js")));
});

test("W4H-28. Wave 5 cannot accidentally execute Wave 4 probes — no Wave 4 fixture IDs or Wave 4 env vars in Wave 5 module", () => {
  assert.ok(!wave5RlsHarnessSrc.includes("wave4-rls-acceptance-v2"));
  assert.ok(!wave5RlsHarnessSrc.includes("SERVICEOS_W4_RLS_HARNESS_ENABLED"));
});

test("W4H-29. Wave 4 cannot accidentally execute Wave 5 probes — Wave 5 finance table IDs not in Wave 4 scope", () => {
  const wave5FinanceIds = [
    "c626972d-3d5f-411c-ba87-613a62f5a885",
    "71fec2d6-a941-4644-901b-f35d2a29afdd",
    "23026a2e-13e9-4a0a-938a-95f4fc28761b",
  ];
  const fixtureScopeMatch = harnessPublicSrc.match(/const FIXTURE_SCOPE[\s\S]*?}\s*\)/);
  if (fixtureScopeMatch) for (const id of wave5FinanceIds) assert.ok(!fixtureScopeMatch[0].includes(id));
  assert.ok(!harnessPublicSrc.includes("SERVICEOS_W5_RLS_HARNESS_ENABLED"));
});
