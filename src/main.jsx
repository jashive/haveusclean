import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import ServiceOSAuthGate, { useServiceOSContext } from "./auth/ServiceOSAuthGate";
import { isCanonicalServiceOSMode, SERVICEOS_DIAGNOSTICS_PATH } from "./lib/serviceosUiPolicy";
import "./styles.css";

const LegacyApp = lazy(() => import("./App"));
const ServiceOSDiagnosticsWorkspace = lazy(() => import("./features/pilot/ServiceOSDiagnosticsWorkspace"));
const ServiceOSWave1Workspace = lazy(() => import("./features/wave1/ServiceOSWave1Workspace"));

const CANONICAL_SERVICEOS_MODE = isCanonicalServiceOSMode(import.meta.env);

function ServiceOSRoot() {
  const context = useServiceOSContext();
  const diagnosticsRequested = typeof window !== "undefined" && window.location.pathname === SERVICEOS_DIAGNOSTICS_PATH;

  if (diagnosticsRequested) {
    return (
      <Suspense fallback={<div role="status">Loading ServiceOS diagnostics…</div>}>
        <ServiceOSDiagnosticsWorkspace session={context?.session ?? null} revenueContext={context?.revenueContext ?? null} />
      </Suspense>
    );
  }

  if (CANONICAL_SERVICEOS_MODE) {
    return (
      <Suspense fallback={<div role="status">Loading ServiceOS workspace…</div>}>
        <ServiceOSWave1Workspace />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div role="status">Loading Have Us Clean…</div>}>
      <LegacyApp />
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ServiceOSAuthGate><ServiceOSRoot /></ServiceOSAuthGate>
  </React.StrictMode>
);
