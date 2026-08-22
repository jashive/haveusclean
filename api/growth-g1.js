// Growth Layer 1.0 / Milestone G1 API boundary.
// Non-production only until Growth governance explicitly approves production activation.

import runGrowthG1 from "../server-internal/growth-g1-impl.js";
import { requireServiceosServerTarget } from "../src/server/serviceosServerEnvironment.js";

export default async function handler(req, res) {
  try {
    requireServiceosServerTarget(process.env, {
      allowProduction: false,
      allowNonProduction: true,
      requireProductionApproval: true,
    });
  } catch (error) {
    return res.status(error.status || 403).json({
      success: false,
      error: error.message,
      code: error.code || "GROWTH_SERVER_TARGET_INVALID",
    });
  }

  return runGrowthG1(req, res);
}
