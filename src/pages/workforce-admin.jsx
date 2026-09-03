import React, { Suspense, lazy } from "react";
import { useServiceOSContext } from "../auth/ServiceOSAuthGate";

const WorkforceComplianceDashboard = lazy(() => import("../features/workforce/WorkforceComplianceDashboard"));
const WORKFORCE_DASHBOARD_ENABLED = typeof import.meta !== "undefined" && import.meta.env?.VITE_WORKFORCE_DASHBOARD_ENABLED === "true";

export default function WorkforceAdminPage() {
  const context = useServiceOSContext();
  const role = context?.revenueContext?.roleCode ?? "unknown";

  if (!WORKFORCE_DASHBOARD_ENABLED) {
    return <main style={{ minHeight: "100vh", background: "#0A0F1E", color: "#F5F8FC", padding: 32 }}><h1>Workforce Administration</h1><p>Workforce dashboard is not enabled in this deployment.</p></main>;
  }
  if (role !== "owner_admin") {
    return <main style={{ minHeight: "100vh", background: "#0A0F1E", color: "#F5F8FC", padding: 32 }}><h1>Workforce Administration</h1><p>Owner / Admin access is required.</p></main>;
  }

  return (
    <main style={{ minHeight: "100vh", background: "#0A0F1E", color: "#F5F8FC", padding: "32px 20px 48px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <a href="/" style={{ color: "#54E5C2", fontWeight: 800, textDecoration: "none" }}>← ServiceOS Admin</a>
          <h1 style={{ marginBottom: 6 }}>Workforce Administration</h1>
          <p style={{ margin: 0, color: "#AEBAC9" }}>HEMS / HR governed onboarding and ServiceOS worker activation.</p>
        </div>
        <Suspense fallback={<div role="status">Loading Workforce Administration…</div>}>
          <WorkforceComplianceDashboard session={context?.session ?? null} revenueContext={context?.revenueContext ?? null} />
        </Suspense>
      </div>
    </main>
  );
}
