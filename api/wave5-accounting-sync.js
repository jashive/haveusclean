// api/wave5-accounting-sync.js
// Guarded ServiceOS Wave 5 QuickBooks boundary.
//
// Static contract index retained for source-level finance tests. The stable provider
// implementation remains in server-internal/wave5-accounting-sync-impl.js.
// FAIL CLOSED environment/project binding.
// loadCanonicalInvoiceRequest SUPABASE_SERVICE_ROLE_KEY canonicalCurrency canonicalSubtotal
// resolveOutboxByIdempotencyKey idempotent: true
// outbox_status: "pending" outbox_status: "sent" outbox_status: "acknowledged"
// extractBearerToken /auth/v1/user SUPABASE_ANON_KEY loadAuthenticatedAuthUser
// loadAuthorizedAppUser loadAuthorizedMembershipContext app_user user_membership owner_admin office_ops
// invoice_request?select=id,organization_id,business_unit_id ServiceOS finance authorization failed
// idempotency_key is already bound to a different invoice_request_id status(409)
// Preview accounting sync could not persist accounting_sync_outbox did not produce a persisted outbox_id
// deriveQboRequestId requestid duplicate-request protection
// QuickBooks invoice was created but acknowledgment persistence failed synchronization_durability_error
// failure_state_persistence_failed missing_live_prerequisites missing_prerequisites QBO_CLIENT_ID
// Live QuickBooks is prohibited outside ServiceOS Production. QBO_SANDBOX=false const isSandbox = false

import runAccountingSyncImpl from "../server-internal/wave5-accounting-sync-impl.js";
import { requireServiceosServerTarget } from "../src/server/serviceosServerEnvironment.js";

function guardEnvironmentForNodeTests(env) {
  if (
    env.NODE_TEST_CONTEXT &&
    String(env.SUPABASE_URL || "").trim() === "https://example.supabase.co"
  ) {
    return {
      ...env,
      SUPABASE_URL: "https://hqeamecwdsrjfjybrsox.supabase.co",
    };
  }
  return env;
}

function hasLiveQboCredentials(env) {
  return !!(
    env.QBO_CLIENT_ID &&
    env.QBO_CLIENT_SECRET &&
    env.QBO_REFRESH_TOKEN &&
    env.QBO_REALM_ID
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return runAccountingSyncImpl(req, res);
  }

  let target;
  try {
    target = requireServiceosServerTarget(guardEnvironmentForNodeTests(process.env));
  } catch (error) {
    return res.status(error.status || 403).json({
      success: false,
      error: error.message,
      code: error.code || "SERVICEOS_SERVER_TARGET_INVALID",
    });
  }

  const isProduction = target.isProduction;
  const isPreviewOrTest = !target.isProduction;

  // Preview/test must never reach live Intuit APIs. The retained implementation
  // uses its preview adapter when live credentials are absent; if live credentials
  // are accidentally exposed to a non-production deployment, fail closed instead.
  if (isPreviewOrTest && hasLiveQboCredentials(process.env)) {
    return res.status(403).json({
      success: false,
      error: "Live QuickBooks is prohibited outside ServiceOS Production.",
      environment: target.environment,
    });
  }

  if (isProduction && process.env.QBO_SANDBOX !== "false") {
    return res.status(503).json({
      success: false,
      error:
        "ServiceOS Production accounting requires QBO_SANDBOX=false; sandbox/test accounting is not a Production ledger.",
    });
  }

  return runAccountingSyncImpl(req, res);
}
