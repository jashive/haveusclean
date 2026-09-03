// ServiceOS 1.0 Staff Administration API
// Owner/Admin only for staff and Workforce dashboard actions. Public Workforce apply is
// explicitly dispatched to the governed applicant-intake RPC. Privileged Supabase
// operations remain server-side.

import "../server-internal/supabase-secret-key-fetch-compat.js";
import runStaffAdmin from "../server-internal/serviceos-staff-admin-impl.js";
import { runWithStaffAdminDiagnostics } from "../server-internal/serviceos-staff-admin-diagnostics.js";
import { runWorkforceApply, runWorkforceDashboard } from "../server-internal/workforce-compliance-dashboard-impl.js";
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

  const workforceAction = String(req.query?.workforce || "").trim().toLowerCase();
  if (workforceAction === "apply") return runWorkforceApply(req, res);
  if (workforceAction === "dashboard") return runWorkforceDashboard(req, res);

  return runWithStaffAdminDiagnostics(req, res, () => runStaffAdmin(req, res));
}
