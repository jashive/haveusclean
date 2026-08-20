export const CANONICAL_ROLES = Object.freeze(["owner_admin", "office_ops", "worker", "qa"]);

const active = (row) => row?.status === "active";

/** Resolve the fail-closed identity used by every ServiceOS workspace. */
export function resolveCanonicalIdentity({ authUserId, organizationId, appUsers, memberships, roles, workers = [], visibleBusinessUnitIds = [] }) {
  const users = appUsers.filter((user) => user.auth_user_id === authUserId && active(user));
  if (users.length !== 1) throw new Error("expected exactly one active app user");
  const appUser = users[0];
  const roleById = new Map(roles.map((role) => [role.id, role.code]));
  const allActive = memberships.filter((membership) => membership.app_user_id === appUser.id && active(membership));
  if (!allActive.length) throw new Error("active membership required");
  if (allActive.some((membership) => membership.organization_id !== organizationId)) throw new Error("other-organization membership rejected");
  const codes = new Set(allActive.map((membership) => roleById.get(membership.role_id)));
  if ([...codes].some((code) => !CANONICAL_ROLES.includes(code))) throw new Error("unsupported role rejected");
  if (codes.size !== 1) throw new Error("mixed-role contamination rejected");
  const role = [...codes][0];
  const allowedBusinessUnitIds = [...new Set(allActive.flatMap((membership) => membership.business_unit_id ? [membership.business_unit_id] : visibleBusinessUnitIds))];
  if (!allowedBusinessUnitIds.length || allowedBusinessUnitIds.some((id) => !visibleBusinessUnitIds.includes(id))) throw new Error("membership business unit is not visible");
  const linkedWorkers = workers.filter((worker) => worker.app_user_id === appUser.id && active(worker));
  if (role === "worker") {
    if (linkedWorkers.length !== 1) throw new Error("worker requires exactly one active worker link");
    const worker = linkedWorkers[0];
    if (worker.organization_id !== organizationId || !allowedBusinessUnitIds.includes(worker.business_unit_id)) throw new Error("worker link is outside canonical scope");
    return { role, appUser, memberships: allActive, worker, allowedBusinessUnitIds };
  }
  if (linkedWorkers.length) throw new Error("non-worker cannot have an active worker link");
  return { role, appUser, memberships: allActive, worker: null, allowedBusinessUnitIds };
}

export function workspaceForRole(role) {
  if (!CANONICAL_ROLES.includes(role)) throw new Error("unsupported canonical role");
  return {
    operations: role,
    officeQueues: role === "owner_admin" || role === "office_ops",
    workerAssignments: role === "worker",
    qaEligibleJobs: role === "qa",
    finance: role === "owner_admin" || role === "office_ops",
    wave4Pilot: role === "owner_admin",
    wave6Management: role === "owner_admin",
  };
}
