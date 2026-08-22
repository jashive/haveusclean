import React, { lazy, Suspense, useState } from "react";
import { useServiceOSContext } from "../../auth/ServiceOSAuthGate";
import { getStoredSession, signOut } from "../../lib/serviceosAuthClient";
import {
  canManageServiceOSRevenue,
  canOpenServiceOSDiagnostics,
  SERVICEOS_DIAGNOSTICS_PATH,
} from "../../lib/serviceosUiPolicy";

const ServiceOSPilotPanel = lazy(() => import("../pilot/ServiceOSPilotPanel"));
const ServiceOSOperationsWorkspace = lazy(() => import("../wave3/ServiceOSOperationsWorkspace"));
const ServiceOSQaWorkspace = lazy(() => import("../wave4/ServiceOSQaWorkspace"));
const ServiceOSFinanceWorkspace = lazy(() => import("../wave5/ServiceOSFinanceWorkspace"));

const REVENUE_PILOT_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_REVENUE_ENABLED === "true" &&
  import.meta.env?.VITE_SERVICEOS_REVENUE_PILOT_UI === "true";

const OPERATIONS_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_OPERATIONS_ENABLED === "true";

const QA_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_QA_ENABLED === "true";

const FINANCE_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_FINANCE_ENABLED === "true";

const ROLE_LABELS = {
  owner_admin: "Owner / Admin",
  office_ops: "Office Operations",
  worker: "Worker",
  qa: "Quality Assurance",
  finance: "Finance",
};

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0A0F1E",
    color: "#F5F8FC",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "32px 20px 48px",
    boxSizing: "border-box",
  },
  shell: { maxWidth: 1040, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 28 },
  eyebrow: { color: "#00D4AA", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" },
  title: { margin: "6px 0 4px", fontSize: 30, lineHeight: 1.15 },
  subtitle: { margin: 0, color: "#9AA9BC", fontSize: 14 },
  logout: { border: "1px solid #55657A", borderRadius: 8, background: "#151D2C", color: "#F5F8FC", padding: "10px 16px", fontWeight: 800, cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginBottom: 20 },
  card: { background: "#151D2C", border: "1px solid #28364A", borderRadius: 12, padding: 18 },
  label: { color: "#8291A6", fontSize: 12, textTransform: "uppercase", fontWeight: 800, letterSpacing: ".07em" },
  value: { marginTop: 7, fontSize: 16, fontWeight: 750, overflowWrap: "anywhere" },
  sectionTitle: { margin: "0 0 12px", fontSize: 17 },
  notice: { color: "#AEBAC9", fontSize: 14, lineHeight: 1.6, margin: 0 },
  status: { display: "inline-flex", marginTop: 12, padding: "4px 9px", borderRadius: 999, background: "#19352F", color: "#54E5C2", fontSize: 12, fontWeight: 800 },
  actions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 },
  link: { display: "inline-block", textDecoration: "none", borderRadius: 8, padding: "9px 13px", background: "#00D4AA", color: "#07110F", fontWeight: 850, fontSize: 13 },
  disabled: { display: "inline-block", borderRadius: 8, padding: "9px 13px", border: "1px solid #344359", color: "#6F7F94", fontWeight: 750, fontSize: 13 },
  enabled: { display: "inline-block", borderRadius: 8, padding: "9px 13px", border: "1px solid #2B7A68", color: "#54E5C2", fontWeight: 800, fontSize: 13 },
};

export default function ServiceOSWave1Workspace() {
  const context = useServiceOSContext();
  const session = context?.session ?? null;
  const revenueContext = context?.revenueContext ?? null;
  const [loggingOut, setLoggingOut] = useState(false);
  const role = revenueContext?.roleCode ?? "unknown";
  const organizationId = revenueContext?.orgId ?? "Unavailable";
  const businessUnits = Array.isArray(revenueContext?.businessUnits) ? revenueContext.businessUnits : [];
  const email = session?.user?.email ?? "Unavailable";
  const revenueAuthorized = REVENUE_PILOT_ENABLED && canManageServiceOSRevenue(role);
  const operationsAuthorized = OPERATIONS_ENABLED && ["owner_admin", "office_ops", "worker"].includes(role);
  const qaAuthorized = QA_ENABLED && role === "qa";
  const financeAuthorized = FINANCE_ENABLED && role === "finance";
  const activeWave = financeAuthorized ? "wave5" : qaAuthorized ? "wave4" : operationsAuthorized ? "wave3" : revenueAuthorized ? "wave2" : "wave1";
  const workspaceTitle = financeAuthorized
    ? "Wave 5 Finance Workspace"
    : qaAuthorized
      ? "Wave 4 Quality Assurance Workspace"
      : operationsAuthorized
        ? "Wave 3 Operations Workspace"
        : revenueAuthorized
          ? "Wave 2 Revenue Workspace"
          : "Wave 1 Access Workspace";
  const workspaceSubtitle = financeAuthorized
    ? "Controlled Finance rollout with provider execution and Intelligence gates preserved"
    : qaAuthorized
      ? "Controlled QA rollout with Finance and Intelligence gates preserved"
      : operationsAuthorized
        ? "Controlled Operations rollout with QA, Finance, and Intelligence gates preserved"
        : revenueAuthorized
          ? "Canonical Revenue pilot with Wave 1 role isolation preserved"
          : "Canonical authentication and role isolation pilot";

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const stored = getStoredSession();
      await signOut(stored?.access_token);
    } finally {
      window.location.assign("/");
    }
  }

  return (
    <main
      style={styles.page}
      data-serviceos-wave={activeWave}
      data-canonical-workspace="true"
      data-revenue-authorized={revenueAuthorized ? "true" : "false"}
      data-operations-authorized={operationsAuthorized ? "true" : "false"}
      data-qa-authorized={qaAuthorized ? "true" : "false"}
      data-finance-authorized={financeAuthorized ? "true" : "false"}
    >
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Have Us Clean · ServiceOS 1.0</div>
            <h1 style={styles.title}>{workspaceTitle}</h1>
            <p style={styles.subtitle}>{workspaceSubtitle}</p>
          </div>
          <button type="button" style={{ ...styles.logout, opacity: loggingOut ? 0.6 : 1 }} onClick={handleLogout} disabled={loggingOut} aria-label="Log out of ServiceOS">
            {loggingOut ? "Logging out…" : "Logout"}
          </button>
        </header>

        <section style={styles.grid} aria-label="Authenticated ServiceOS context">
          <div style={styles.card}><div style={styles.label}>Authenticated user</div><div style={styles.value}>{email}</div></div>
          <div style={styles.card}><div style={styles.label}>Canonical role</div><div style={styles.value}>{ROLE_LABELS[role] ?? role}</div><div style={styles.status}>{role}</div></div>
          <div style={styles.card}><div style={styles.label}>Organization</div><div style={styles.value}>Have Us Clean</div><div style={{ ...styles.notice, marginTop: 6 }}>ID: {organizationId}</div></div>
          <div style={styles.card}><div style={styles.label}>Business-unit scope</div><div style={styles.value}>{businessUnits.length ? businessUnits.join(", ") : "No visible business unit"}</div></div>
        </section>

        <section style={{ ...styles.card, marginBottom: 14 }}>
          <h2 style={styles.sectionTitle}>Canonical access status</h2>
          <p style={styles.notice}>Authentication remains isolated from the legacy HUC application data layer. No demo jobs, customers, invoices, partners, or other fixture data are loaded in canonical mode.</p>
          <div style={styles.status}>Canonical shell active</div>
        </section>

        <section style={{ ...styles.card, marginBottom: (revenueAuthorized || operationsAuthorized || qaAuthorized || financeAuthorized) ? 14 : 0 }}>
          <h2 style={styles.sectionTitle}>ServiceOS rollout gates</h2>
          <p style={styles.notice}>Revenue, Operations, QA, and Finance use independent role-aware gates. Intelligence remains dark until its own rollout gate is accepted.</p>
          <div style={styles.actions}>
            {canOpenServiceOSDiagnostics(role) ? <a href={SERVICEOS_DIAGNOSTICS_PATH} style={styles.link}>Open read-only diagnostics</a> : null}
            <span style={revenueAuthorized ? styles.enabled : styles.disabled}>{revenueAuthorized ? "Revenue · active" : "Revenue · disabled"}</span>
            <span style={operationsAuthorized ? styles.enabled : styles.disabled}>{operationsAuthorized ? "Operations · active" : "Operations · disabled"}</span>
            <span style={qaAuthorized ? styles.enabled : styles.disabled}>{qaAuthorized ? "QA · active" : "QA · disabled"}</span>
            <span style={financeAuthorized ? styles.enabled : styles.disabled}>{financeAuthorized ? "Finance · active" : "Finance · disabled"}</span>
            <span style={styles.disabled}>Intelligence · disabled</span>
          </div>
        </section>

        {revenueAuthorized ? (
          <Suspense fallback={<div role="status">Loading Revenue…</div>}>
            <ServiceOSPilotPanel session={session} revenueContext={revenueContext} />
          </Suspense>
        ) : null}
        {operationsAuthorized ? (
          <Suspense fallback={<div role="status">Loading Operations…</div>}>
            <ServiceOSOperationsWorkspace session={session} revenueContext={revenueContext} />
          </Suspense>
        ) : null}
        {qaAuthorized ? (
          <Suspense fallback={<div role="status">Loading QA…</div>}>
            <ServiceOSQaWorkspace session={session} revenueContext={revenueContext} />
          </Suspense>
        ) : null}
        {financeAuthorized ? (
          <Suspense fallback={<div role="status">Loading Finance…</div>}>
            <ServiceOSFinanceWorkspace session={session} revenueContext={revenueContext} />
          </Suspense>
        ) : null}
      </div>
    </main>
  );
}
