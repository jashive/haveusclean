import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ServiceOSAuthGate, { useServiceOSContext } from "./auth/ServiceOSAuthGate";
import { SERVICEOS_DIAGNOSTICS_PATH } from "./lib/serviceosUiPolicy";
import "./styles.css";

const ServiceOSDiagnosticsWorkspace = lazy(() => import("./features/pilot/ServiceOSDiagnosticsWorkspace"));

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
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ServiceOSAuthGate><ServiceOSRoot /></ServiceOSAuthGate>
  </React.StrictMode>
);
