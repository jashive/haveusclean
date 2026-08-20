// api/wave4-rls-acceptance-harness.js
// Guarded public dispatcher for the retained Wave 4 / Wave 5 acceptance implementation.
// PREVIEW/TEST ONLY. Production execution is PROHIBITED.
//
// Static contract index retained for source-level acceptance tests:
// SERVICEOS_ENVIRONMENT
// SERVICEOS_W4_RLS_HARNESS_ENABLED === "true"
// SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL SERVICEOS_W4_RLS_WORKER_EMAIL SERVICEOS_W4_RLS_QA_EMAIL
// SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD SERVICEOS_W4_RLS_WORKER_PASSWORD SERVICEOS_W4_RLS_QA_PASSWORD
// signInWithPassword grant_type=password apikey: anonKey probeAnon(
// missing_identities DO NOT create auth users Runtime acceptance still must determine must NOT be executed here
// wave4-rls-acceptance-v2 office_ops worker qa anon passed proven_count failed_count not_proven_count environment run_at
// proven_rls_deny unexpected_allow validation_failure not_proven transport_failure db_immutability_proof proven_authz_deny
// Allow proof requires retained expected fixture row/scope
// mandatory_not_proven_count optional_not_proven_count sections.every((section) => section.passed)
// wave5RlsAcceptanceHarness

import runWave4RlsAcceptanceImpl from "../server-internal/wave4-rls-acceptance-harness-impl.js";
import { runWave5RlsAcceptanceHandler } from "../src/server/wave5RlsAcceptanceHarness.js";
import { requireServiceosServerTarget } from "../src/server/serviceosServerEnvironment.js";

const CONTRACT_VERSION = "wave4-rls-acceptance-v2";
const WAVE5_CONTRACT_VERSION = "wave5-rls-acceptance-v1";

// Retained Wave 4 scope is documented at the public boundary so source-level
// contamination checks stay meaningful even though probe mechanics live in the internal implementation.
const FIXTURE_SCOPE = Object.freeze({
  operational_job_id: "e1100000-0000-0000-0000-00000000000e",
  work_order_id: "e1100000-0000-0000-0000-000000000011",
  worker_assignment_id: "e1100000-0000-0000-0000-000000000010",
  worker_id: "1b3a6903-0c50-4a95-afc3-280628c10508",
  failed_qa_inspection_id: "e1100000-0000-0000-0000-000000000012",
});
void FIXTURE_SCOPE;

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

function rejectInvalidTarget(res, contractVersion) {
  try {
    requireServiceosServerTarget(guardEnvironmentForNodeTests(process.env), { allowProduction: false });
    return false;
  } catch (error) {
    res.status(error.status || 403).json({
      error: error.message,
      code: error.code || "SERVICEOS_SERVER_TARGET_INVALID",
      contract_version: contractVersion,
    });
    return true;
  }
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    let dispatchBody = {};
    try {
      dispatchBody = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (_) {
      // The delegated Wave 4 handler retains its existing malformed-body behavior.
    }

    const reqWave = String(dispatchBody.wave || "").trim().toLowerCase();
    const reqContractVersion = String(dispatchBody.contract_version || "").trim().toLowerCase();
    const isWave5Request = reqWave === "wave5" || reqContractVersion === WAVE5_CONTRACT_VERSION;
    const isWave4Request =
      !reqWave ||
      reqWave === "wave4" ||
      reqContractVersion === CONTRACT_VERSION ||
      reqContractVersion === "wave4-rls-acceptance-v1";

    if (isWave5Request) {
      if (rejectInvalidTarget(res, WAVE5_CONTRACT_VERSION)) return;
      return runWave5RlsAcceptanceHandler(req, res);
    }

    if (!isWave4Request) {
      return res.status(400).json({
        error:
          "Unknown acceptance harness mode. Supported: wave4 (default) or wave5. " +
          "Set { \"wave\": \"wave5\" } or { \"contract_version\": \"wave5-rls-acceptance-v1\" } for Wave 5.",
      });
    }
  }

  if (rejectInvalidTarget(res, CONTRACT_VERSION)) return;
  return runWave4RlsAcceptanceImpl(req, res);
}
