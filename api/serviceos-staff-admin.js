// ServiceOS 1.0 Staff Administration API
// Owner/Admin only. All privileged Supabase operations remain server-side.

import "../server-internal/supabase-secret-key-fetch-compat.js";
import runStaffAdmin from "../server-internal/serviceos-staff-admin-impl.js";
import { requireServiceosServerTarget } from "../src/server/serviceosServerEnvironment.js";

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
      code: error.code || "SERVICEOS_SERVER_TARGET_INVALID",
    });
  }

  return runStaffAdmin(req, res);
}
