import React, { lazy, Suspense, useEffect, useState } from "react";
import { StatusBadge } from "../../components/ui.jsx";
import AdminWorkspaceNavigation, { workspaceFromPath } from "./AdminWorkspaceNavigation.jsx";

const ExecutiveKpiBar = lazy(() => import("./ExecutiveKpiBar"));
const ServiceOSFlightControlBoard = lazy(() => import("./ServiceOSFlightControlBoard"));
const PipelineDispatchWorkspace = lazy(() => import("./PipelineDispatchWorkspace"));
const ServiceOSStaffAdminWorkspace = lazy(() => import("./ServiceOSStaffAdminWorkspace"));
const CleanerPayablesPanel = lazy(() => import("../wave5/CleanerPayablesPanel"));
const ServiceOSFinanceWorkspace = lazy(() => import("../wave5/ServiceOSFinanceWorkspace"));

function WorkspaceLoading() { return <div className="admin-workspace-loading" role="status">Loading workspace…</div>; }

export default function AdminCockpitLayout({ session, revenueContext, staffAdminAuthorized, marketControl }) {
  const [workspace, setWorkspace] = useState(() => workspaceFromPath(window.location.pathname));
  const selectWorkspace = (item) => { window.history.pushState({}, "", item.path); setWorkspace(item.id); window.scrollTo({ top: 0, behavior: "smooth" }); };

  useEffect(() => { const pop = () => setWorkspace(workspaceFromPath(window.location.pathname)); window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
  useEffect(() => {
    const open = (event) => {
      const target = event?.detail?.workspace;
      const mapped = target === "operations"
        ? { id: "pipeline-dispatch", path: "/admin/dispatch" }
        : target === "staff"
          ? { id: "team-hiring", path: "/admin/team" }
          : target === "qa"
            ? { id: "flight-control", path: "/admin" }
            : { id: "financial-ledgers", path: "/admin/financials" };
      selectWorkspace(mapped);
    };
    window.addEventListener("serviceos:open-secondary-workspace", open);
    return () => window.removeEventListener("serviceos:open-secondary-workspace", open);
  }, []);

  return <section className="admin-cockpit-layout" data-admin-default-view="flight-control" data-admin-workspace={workspace}>
    <header className="admin-commercial-topbar"><div><p className="admin-eyebrow">Have Us Clean · ServiceOS</p><h2>Operations command center</h2></div><div>{marketControl}<StatusBadge tone="success">Live</StatusBadge></div></header>
    <AdminWorkspaceNavigation active={workspace} onSelect={selectWorkspace} />
    <Suspense fallback={<WorkspaceLoading />}>
      {workspace === "flight-control" ? <><ExecutiveKpiBar revenueContext={revenueContext} /><ServiceOSFlightControlBoard session={session} revenueContext={revenueContext} /></> : null}
      {workspace === "pipeline-dispatch" ? <PipelineDispatchWorkspace session={session} revenueContext={revenueContext} /> : null}
      {workspace === "team-hiring" ? staffAdminAuthorized ? <ServiceOSStaffAdminWorkspace /> : <div className="admin-permission-state">Owner access is required for team administration.</div> : null}
      {workspace === "financial-ledgers" ? <><ExecutiveKpiBar revenueContext={revenueContext} /><CleanerPayablesPanel revenueContext={revenueContext} /><ServiceOSFinanceWorkspace session={session} revenueContext={revenueContext} /></> : null}
    </Suspense>
  </section>;
}
