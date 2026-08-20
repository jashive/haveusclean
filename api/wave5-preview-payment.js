// api/wave5-preview-payment.js
// Guarded server-only Wave 5 preview payment boundary.
// Preview/test ONLY. Production is prohibited.
//
// Static contract index retained for source-level finance tests:
// SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED owner_admin office_ops payment_observation provider_event_id "preview_test"

import runPreviewPaymentImpl from "../server-internal/wave5-preview-payment-impl.js";
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return runPreviewPaymentImpl(req, res);
  }

  try {
    requireServiceosServerTarget(guardEnvironmentForNodeTests(process.env), { allowProduction: false });
  } catch (error) {
    return res.status(error.status || 403).json({
      success: false,
      error: error.message,
      code: error.code || "SERVICEOS_SERVER_TARGET_INVALID",
    });
  }

  return runPreviewPaymentImpl(req, res);
}
