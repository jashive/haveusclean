import React, { lazy, Suspense, useEffect, useState } from "react";
import { StatusBadge } from "../../components/ui.jsx";

const ExecutiveKpiBar = lazy(() => import("./ExecutiveKpiBar"));
const ServiceOSFlightControlBoard = lazy(() => import("./ServiceOSFlightControlBoard"));
const ServiceOSOperationsWorkspace = lazy(() => import("../wave3/ServiceOSOperationsWorkspace"));
const ServiceOSQaWorkspace = lazy(() => import("../wave4/ServiceOSQaWorkspace"));
const CleanerPayablesPanel = lazy(() => import("../wave5/CleanerPayablesPanel"));
const ServiceOSFinanceWorkspace = lazy(() => import("../wave5/ServiceOSFinanceWorkspace"));
const ServiceOSStaffAdminWorkspace = lazy(() => import("./ServiceOSStaffAdminWorkspace"));

const WORKSPACES = [
  { id: "operations", label: "Operations" },
  { id: "qa", label: "Full QA" },
  { id: "payables", label: "Payables history" },
  { id: "finance", label: "Finance & logs" },
  { id: "staff", label: "Staff" },
];

export function SecondaryWorkspaceDrawer({ open, active, onClose, onSelect, session, revenueContext, staffAdminAuthorized }) {
  if (!open) return null;
  return <div className="secondary-workspace-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="secondary-workspace-drawer" role="dialog" aria-modal="true" aria-labelledby="secondary-workspace-title">
      <header><div><p className="admin-eyebrow">Secondary workspaces</p><h2 id="secondary-workspace-title">Detailed administration</h2></div><button className="huc-button huc-button--secondary" onClick={onClose} aria-label="Close secondary workspace">Close</button></header>
      <nav aria-label="Administrative workspace tabs">{WORKSPACES.filter((item) => item.id !== "staff" || staffAdminAuthorized).map((item) => <button key={item.id} className={active === item.id ? "is-active" : ""} onClick={() => onSelect(item.id)}>{item.label}</button>)}</nav>
      <div className="secondary-workspace-drawer__body"><Suspense fallback={<div role="status">Loading workspace…</div>}>
        {active === "operations" ? <ServiceOSOperationsWorkspace session={session} revenueContext={revenueContext} /> : null}
        {active === "qa" ? <ServiceOSQaWorkspace session={session} revenueContext={revenueContext} /> : null}
        {active === "payables" ? <CleanerPayablesPanel revenueContext={revenueContext} /> : null}
        {active === "finance" ? <ServiceOSFinanceWorkspace session={session} revenueContext={revenueContext} /> : null}
        {active === "staff" && staffAdminAuthorized ? <ServiceOSStaffAdminWorkspace /> : null}
      </Suspense></div>
    </aside>
  </div>;
}

export default function AdminCockpitLayout({ session, revenueContext, staffAdminAuthorized }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspace, setWorkspace] = useState("operations");
  const openWorkspace = (id) => { setWorkspace(id); setDrawerOpen(true); };

  useEffect(() => {
    const open = (event) => { setWorkspace(event?.detail?.workspace || "operations"); setDrawerOpen(true); };
    window.addEventListener("serviceos:open-secondary-workspace", open);
    return () => window.removeEventListener("serviceos:open-secondary-workspace", open);
  }, []);

  return <section className="admin-cockpit-layout" data-admin-default-view="flight-control">
    <header className="admin-cockpit-layout__toolbar"><div><p className="admin-eyebrow">Administrative Flight Control</p><h2>Today&apos;s operating picture</h2></div><div><StatusBadge tone="success">Live</StatusBadge><button className="huc-button huc-button--secondary" onClick={() => openWorkspace("operations")}>Secondary workspaces</button></div></header>
    <Suspense fallback={<div role="status">Loading executive metrics…</div>}><ExecutiveKpiBar revenueContext={revenueContext} /></Suspense>
    <Suspense fallback={<div role="status">Loading Flight Control…</div>}><ServiceOSFlightControlBoard session={session} revenueContext={revenueContext} /></Suspense>
    <SecondaryWorkspaceDrawer open={drawerOpen} active={workspace} onClose={() => setDrawerOpen(false)} onSelect={setWorkspace} session={session} revenueContext={revenueContext} staffAdminAuthorized={staffAdminAuthorized} />
  </section>;
}
