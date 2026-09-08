import React from "react";

export const ADMIN_WORKSPACES = [
  { id: "flight-control", label: "Flight Control", path: "/admin" },
  { id: "pipeline-dispatch", label: "Pipeline & Dispatch", path: "/admin/dispatch" },
  { id: "team-hiring", label: "Team & Hiring", path: "/admin/team" },
  { id: "financial-ledgers", label: "Financial Ledgers", path: "/admin/financials" },
];

export function workspaceFromPath(pathname) {
  if (pathname.startsWith("/admin/dispatch")) return "pipeline-dispatch";
  if (pathname.startsWith("/admin/team")) return "team-hiring";
  if (pathname.startsWith("/admin/financials")) return "financial-ledgers";
  return "flight-control";
}

export default function AdminWorkspaceNavigation({ active, onSelect }) {
  return <nav className="admin-workspace-navigation" aria-label="ServiceOS workspaces">
    {ADMIN_WORKSPACES.map((item) => <button key={item.id} type="button" className={active === item.id ? "is-active" : ""} aria-current={active === item.id ? "page" : undefined} onClick={() => onSelect(item)}>{item.label}</button>)}
  </nav>;
}
