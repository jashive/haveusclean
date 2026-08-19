import { CANONICAL_ROLES, workspaceForRole } from "./serviceosRolePolicy.js";

export const SERVICEOS_DIAGNOSTICS_PATH = "/serviceos-diagnostics";

export function isServiceOSAcceptance(env = {}) {
  return String(env.VITE_SERVICEOS_ENVIRONMENT || "").toLowerCase() === "acceptance";
}

export function isCanonicalServiceOSMode(env = {}) {
  return isServiceOSAcceptance(env) || env.VITE_SERVICEOS_AUTH_ENABLED === "true";
}

export function canOpenServiceOSDiagnostics(role) {
  return role === "owner_admin";
}

export function serviceOSNavigationForRole(role) {
  if (!CANONICAL_ROLES.includes(role)) return new Set();
  const workspace = workspaceForRole(role);

  if (role === "worker") return new Set(["schedule"]);
  if (role === "qa") return new Set(["jobs", "schedule"]);

  const officeTabs = [
    "dashboard", "ops_mgr", "jobs", "recurring", "gps", "geo",
    "res", "com", "cold", "intake", "portal", "clientview", "followup",
    "sms", "marketing", "partners", "onboarding", "ai", "schedule",
  ];
  if (workspace.finance) officeTabs.push("pay", "stripe", "qb", "tax");
  if (role === "owner_admin") officeTabs.push("db", "whitelabel", "pricing", "swot", "diagnostic");
  return new Set(officeTabs);
}

export function filterServiceOSNavigation(navGroups, role) {
  const allowlist = serviceOSNavigationForRole(role);
  return navGroups
    .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => allowlist.has(tab.id)) }))
    .filter((group) => group.tabs.length > 0);
}
