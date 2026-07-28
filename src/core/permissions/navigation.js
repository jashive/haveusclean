export const ROLE_TAB_ALLOWLIST = {
  partner: new Set(["partnerview", "onboarding"]),
  sales: new Set(["salesview", "cold", "res", "jobs", "schedule", "partners"]),
};

export const TAB_QUERY_ALIASES = {
  partnerview: "partner-view",
};

export const QUERY_TAB_ALIASES = {
  "partner-view": "partnerview",
};

export const ALL_TAB_IDS = new Set([
  "dashboard", "ops_mgr", "jobs", "recurring", "gps", "geo",
  "res", "com", "cold", "intake",
  "agent_quote", "agent_bidspec", "agent_workorder", "agent_social", "agent_dm", "agent_ops",
  "pay", "stripe", "qb",
  "portal", "clientview", "followup", "sms", "marketing",
  "partners", "partnerview", "salesview", "admins", "onboarding", "ai",
  "tax", "db", "whitelabel", "pricing", "swot", "diagnostic", "schedule",
]);

export function normalizeTabId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return QUERY_TAB_ALIASES[raw] || raw;
}

export function getTabQueryValue(tabId) {
  return TAB_QUERY_ALIASES[tabId] || tabId;
}

export function canAccessTab(role, tabId) {
  if (role === "admin") return true;
  const allowlist = ROLE_TAB_ALLOWLIST[role];
  return Boolean(allowlist && allowlist.has(tabId));
}

export function filterNavGroupsByRole(navGroups, role) {
  if (role === "admin") return navGroups;
  const allowlist = ROLE_TAB_ALLOWLIST[role];
  if (!allowlist) return [];
  const blockedGroups = new Set(["finance", "biz"]);
  return navGroups
    .filter((group) => !blockedGroups.has(group.id))
    .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => allowlist.has(tab.id)) }))
    .filter((group) => group.tabs.length > 0);
}
