import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { StatusBadge } from "../../components/ui.jsx";
import AdminWorkspaceNavigation, { workspaceFromPath } from "./AdminWorkspaceNavigation.jsx";
import { completeServiceOSTour, hasCompletedServiceOSTour, SERVICEOS_TOUR_STEPS } from "../../lib/serviceosLearnability.js";

const ExecutiveKpiBar = lazy(() => import("./ExecutiveKpiBar"));
const ServiceOSFlightControlBoard = lazy(() => import("./ServiceOSFlightControlBoard"));
const PipelineDispatchWorkspace = lazy(() => import("./PipelineDispatchWorkspace"));
const TeamHiringWorkspace = lazy(() => import("./TeamHiringWorkspace"));
const FinancialLedgersWorkspace = lazy(() => import("./FinancialLedgersWorkspace"));
const HelpPanel = lazy(() => import("./HelpPanel"));
const TourOverlay = lazy(() => import("./TourOverlay"));

function WorkspaceLoading() { return <div className="admin-workspace-loading" role="status">Loading workspace…</div>; }

export default function AdminCockpitLayout({ session, revenueContext, staffAdminAuthorized, marketControl }) {
  const [workspace, setWorkspace] = useState(() => workspaceFromPath(window.location.pathname));
  const [helpOpen, setHelpOpen] = useState(false); const [tourActive, setTourActive] = useState(() => !hasCompletedServiceOSTour()); const [tourStep, setTourStep] = useState(0);
  const selectWorkspace = useCallback((item) => { window.history.pushState({}, "", item.path); setWorkspace(item.id); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const navigateTour = useCallback((id) => { const item = [{ id: "flight-control", path: "/admin" }, { id: "pipeline-dispatch", path: "/admin/dispatch" }, { id: "team-hiring", path: "/admin/team" }, { id: "financial-ledgers", path: "/admin/financials" }].find((entry) => entry.id === id); if (item && item.id !== workspace) selectWorkspace(item); }, [selectWorkspace, workspace]);
  const closeTour = useCallback(() => { completeServiceOSTour(); setTourActive(false); }, []);
  const startTour = () => { setHelpOpen(false); setTourStep(0); setTourActive(true); };

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
    <header className="admin-commercial-topbar"><div><p className="admin-eyebrow">Have Us Clean · ServiceOS</p><h2>Operations command center</h2></div><div>{marketControl}<StatusBadge tone="success">Live</StatusBadge><button className="admin-help-button" onClick={() => setHelpOpen(true)} aria-haspopup="dialog">Help</button></div></header>
    <AdminWorkspaceNavigation active={workspace} onSelect={selectWorkspace} />
    <Suspense fallback={<WorkspaceLoading />}>
      {workspace === "flight-control" ? <><ExecutiveKpiBar revenueContext={revenueContext} /><ServiceOSFlightControlBoard session={session} revenueContext={revenueContext} /></> : null}
      {workspace === "pipeline-dispatch" ? <PipelineDispatchWorkspace session={session} revenueContext={revenueContext} /> : null}
      {workspace === "team-hiring" ? staffAdminAuthorized ? <TeamHiringWorkspace session={session} revenueContext={revenueContext} /> : <div className="admin-permission-state">Owner access is required for team administration.</div> : null}
      {workspace === "financial-ledgers" ? <FinancialLedgersWorkspace session={session} revenueContext={revenueContext} /> : null}
    </Suspense>
    <Suspense fallback={null}>{helpOpen ? <HelpPanel workspace={workspace} onClose={() => setHelpOpen(false)} onStartTour={startTour} /> : null}{tourActive ? <TourOverlay steps={SERVICEOS_TOUR_STEPS} stepIndex={tourStep} onStep={setTourStep} onExit={closeTour} onWorkspaceChange={navigateTour} /> : null}</Suspense>
  </section>;
}
