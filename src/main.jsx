import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import ServiceOSAuthGate, { useServiceOSContext } from "./auth/ServiceOSAuthGate";
import ServiceOSPasswordSetup from "./auth/ServiceOSPasswordSetup";
import { isCanonicalServiceOSMode, SERVICEOS_DIAGNOSTICS_PATH } from "./lib/serviceosUiPolicy";
import "./styles.css";

const LegacyApp = lazy(() => import("./App"));
const BookPage = lazy(() => import("./pages/book"));
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

function isPasswordSetupRequest() {
  if (typeof window === "undefined") return false;
  if (window.location.pathname === "/set-password") return true;
  const callback = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = callback.get("type");
  const hasPasswordSession = Boolean(callback.get("access_token")) && (type === "invite" || type === "recovery");
  const hasAuthCallbackError = Boolean(
    callback.get("error") || callback.get("error_code") || callback.get("error_description")
  );
  return hasPasswordSession || hasAuthCallbackError;
}

function isPublicBookingRequest() {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/book" || path.startsWith("/book/");
}

function RootRouter() {
  if (isPasswordSetupRequest()) return <ServiceOSPasswordSetup />;
  if (isPublicBookingRequest()) {
    return (
      <Suspense fallback={<div role="status">Loading booking…</div>}>
        <BookPage />
      </Suspense>
    );
  }
  return <ServiceOSAuthGate><ServiceOSRoot /></ServiceOSAuthGate>;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootRouter />
  </React.StrictMode>
);
