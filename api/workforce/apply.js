import { runWorkforceApply } from "../../server-internal/workforce-compliance-dashboard-impl.js";
import { requireServiceosServerTarget } from "../../src/server/serviceosServerEnvironment.js";

export default async function handler(req, res) {
  try {
    requireServiceosServerTarget(process.env, {
      allowProduction: true,
      allowNonProduction: true,
      requireProductionApproval: true,
    });
  } catch (error) {
    return res.status(error.status || 403).json({
      success: false,
      error: error.message,
      code: error.code || "WORKFORCE_SERVER_TARGET_INVALID",
    });
  }

  return runWorkforceApply(req, res);
}
