import React, { lazy, Suspense, useState } from "react";
import { useServiceOSContext } from "../../auth/ServiceOSAuthGate";
import { getStoredSession, signOut } from "../../lib/serviceosAuthClient";
import {
  canManageServiceOSRevenue,
  canOpenServiceOSDiagnostics,
  SERVICEOS_DIAGNOSTICS_PATH,
} from "../../lib/serviceosUiPolicy";

const ServiceOSLeadIntakePanel = lazy(() => import("./ServiceOSLeadIntakePanel"));
const ServiceOSRevenueWorkspace = lazy(() => import("./ServiceOSRevenueWorkspace"));
const ServiceOSQuoteDeliveryPanel = lazy(() => import("./ServiceOSQuoteDeliveryPanel"));
const ServiceOSQuoteRevisionPanel = lazy(() => import("./ServiceOSQuoteRevisionPanel"));
const ServiceOSCustomerResponsePanel = lazy(() => import("./ServiceOSCustomerResponsePanel"));
const ServiceOSOperationsWorkspace = lazy(() => import("../wave3/ServiceOSOperationsWorkspace"));
const ServiceOSQaWorkspace = lazy(() => import("../wave4/ServiceOSQaWorkspace"));
const ServiceOSFinanceWorkspace = lazy(() => import("../wave5/ServiceOSFinanceWorkspace"));
const ServiceOSStaffAdminWorkspace = lazy(() => import("../admin/ServiceOSStaffAdminWorkspace"));

const REVENUE_ENABLED = typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVICEOS_REVENUE_ENABLED === "true";
const OPERATIONS_ENABLED = typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVICEOS_OPERATIONS_ENABLED === "true";
const QA_ENABLED = typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVICEOS_QA_ENABLED === "true";
const FINANCE_ENABLED = typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVICEOS_FINANCE_ENABLED === "true";
const STAFF_ADMIN_ENABLED = typeof import.meta !== "undefined" && import.meta.env?.VITE_SERVICEOS_STAFF_ADMIN_ENABLED === "true";

const ROLE_LABELS = {
  owner_admin: "Owner / Admin",
  office_ops: "Office Operations",
  worker: "Worker",
  qa: "Quality Assurance",
  finance: "Finance",
};

const MARKET_LABELS = {
  "HUC-ON": "Ontario — HUC-ON",
  "HUC-AZ": "Arizona — HUC-AZ",
};

const styles = {
  page: { minHeight: "100vh", background: "#0A0F1E", color: "#F5F8FC", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", padding: "32px 20px 48px", boxSizing: "border-box" },
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
  marketSelect: { width: "100%", marginTop: 8, border: "1px solid #3A4B62", borderRadius: 8, background: "#0E1524", color: "#F5F8FC", padding: "10px 11px", fontSize: 14, fontWeight: 750 },
};

export default function ServiceOSWave1Workspace() {
  const context = useServiceOSContext();
  const session = context?.session ?? null;
  const revenueContext = context?.revenueContext ?? null;
  const [loggingOut, setLoggingOut] = useState(false);
  const [selectedBusinessUnitCode, setSelectedBusinessUnitCode] = useState("HUC-ON");

  const role = revenueContext?.roleCode ?? "unknown";
  const organizationId = revenueContext?.orgId ?? "Unavailable";
  const businessUnits = Array.isArray(revenueContext?.businessUnits) ? revenueContext.businessUnits : [];
  const businessUnitRecords = Array.isArray(revenueContext?.businessUnitRecords) ? revenueContext.businessUnitRecords : [];
  const activeBusinessUnit = businessUnitRecords.find((item) => item.code === selectedBusinessUnitCode)
    ?? businessUnitRecords.find((item) => item.code === "HUC-ON")
    ?? businessUnitRecords[0]
    ?? null;
  const activeRevenueContext = activeBusinessUnit ? {
    ...revenueContext,
    primaryBusinessUnitId: activeBusinessUnit.id,
    primaryJurisdictionId: activeBusinessUnit.jurisdictionId,
    activeBusinessUnitCode: activeBusinessUnit.code,
    activeBusinessUnitName: activeBusinessUnit.name,
  } : revenueContext;
  const canSelectMarket = role === "owner_admin" && businessUnitRecords.length > 1;
  const email = session?.user?.email ?? "Unavailable";
  const revenueAuthorized = REVENUE_ENABLED && canManageServiceOSRevenue(role);
  const operationsAuthorized = OPERATIONS_ENABLED && ["owner_admin", "office_ops", "worker"].includes(role);
  const qaAuthorized = QA_ENABLED && ["owner_admin", "qa"].includes(role);
  const financeAuthorized = FINANCE_ENABLED && ["owner_admin", "office_ops"].includes(role);
  const staffAdminAuthorized = STAFF_ADMIN_ENABLED && role === "owner_admin";
  const activeWave = financeAuthorized ? "wave5" : qaAuthorized ? "wave4" : operationsAuthorized ? "wave3" : revenueAuthorized ? "wave2" : "wave1";
  const workspaceTitle = role === "owner_admin"
    ? "ServiceOS Administrative Workspace"
    : financeAuthorized ? "Wave 5 Finance Workspace" : qaAuthorized ? "Wave 4 Quality Assurance Workspace" : operationsAuthorized ? "ServiceOS Operations Workspace" : revenueAuthorized ? "ServiceOS Revenue Workspace" : "Wave 1 Access Workspace";
  const workspaceSubtitle = role === "owner_admin"
    ? "Owner/Admin access across enabled Revenue, Operations, QA, Finance, and Staff Administration gates"
    : financeAuthorized
      ? "Controlled Finance rollout with provider execution and Intelligence gates preserved"
      : qaAuthorized
        ? "Controlled QA rollout with Finance and Intelligence gates preserved"
        : operationsAuthorized
          ? "Controlled Operations with canonical Revenue, QA, Finance, and Intelligence boundaries preserved"
          : revenueAuthorized
            ? "Immediate lead capture, guided qualification, governed quoting, quote revision, native delivery, and explicit customer response for real Have Us Clean leads"
            : "Canonical authentication and role isolation";

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
      data-staff-admin-authorized={staffAdminAuthorized ? "true" : "false"}
      data-active-business-unit={activeBusinessUnit?.code ?? "unavailable"}
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
          <div style={styles.card}>
            <div style={styles.label}>{canSelectMarket ? "Active market / business unit" : "Business-unit scope"}</div>
            {canSelectMarket ? (
              <select
                style={styles.marketSelect}
                value={activeBusinessUnit?.code ?? ""}
                onChange={(event) => setSelectedBusinessUnitCode(event.target.value)}
                aria-label="Active Have Us Clean market"
              >
                {businessUnitRecords.map((item) => <option key={item.id} value={item.code}>{MARKET_LABELS[item.code] ?? `${item.name} — ${item.code}`}</option>)}
              </select>
            ) : <div style={styles.value}>{businessUnits.length ? businessUnits.join(", ") : "No visible business unit"}</div>}
            {activeBusinessUnit ? <div style={{ ...styles.notice, marginTop: 6 }}>Active: {MARKET_LABELS[activeBusinessUnit.code] ?? activeBusinessUnit.name}</div> : null}
          </div>
        </section>

        <section style={{ ...styles.card, marginBottom: 14 }}>
          <h2 style={styles.sectionTitle}>Canonical access status</h2>
          <p style={styles.notice}>ServiceOS is the operational system of record. Incomplete leads may be captured before qualification. Quote preparation does not fabricate customer acceptance, conversion, job handoff, or accounting events. Quote revision also does not fabricate customer acceptance, conversion, job handoff, or accounting events. Revised quotes create a new canonical version and preserve the prior version as Superseded. Native quote delivery marks a quote Sent only after email-provider acceptance. Only an explicit recorded Accepted response may cross the Revenue → Operations boundary.</p>
          <div style={styles.status}>Canonical shell active · {activeBusinessUnit?.code ?? "No BU"}</div>
        </section>

        <section style={{ ...styles.card, marginBottom: (revenueAuthorized || operationsAuthorized || qaAuthorized || financeAuthorized || staffAdminAuthorized) ? 14 : 0 }}>
          <h2 style={styles.sectionTitle}>ServiceOS rollout gates</h2>
          <p style={styles.notice}>Revenue, Operations, QA, Finance, and Staff Administration use independent role-aware gates. Owner/Admin may open every enabled administrative gate. Intelligence remains dark until its own rollout gate is accepted.</p>
          <div style={styles.actions}>
            {canOpenServiceOSDiagnostics(role) ? <a href={SERVICEOS_DIAGNOSTICS_PATH} style={styles.link}>Open read-only diagnostics</a> : null}
            <span style={revenueAuthorized ? styles.enabled : styles.disabled}>{revenueAuthorized ? "Revenue · active" : "Revenue · disabled"}</span>
            <span style={operationsAuthorized ? styles.enabled : styles.disabled}>{operationsAuthorized ? "Operations · active" : "Operations · disabled"}</span>
            <span style={qaAuthorized ? styles.enabled : styles.disabled}>{qaAuthorized ? "QA · active" : "QA · disabled"}</span>
            <span style={financeAuthorized ? styles.enabled : styles.disabled}>{financeAuthorized ? "Finance · active" : "Finance · disabled"}</span>
            <span style={staffAdminAuthorized ? styles.enabled : styles.disabled}>{staffAdminAuthorized ? "Staff Admin · active" : "Staff Admin · disabled"}</span>
            <span style={styles.disabled}>Intelligence · disabled</span>
          </div>
        </section>

        {staffAdminAuthorized ? <Suspense fallback={<div role="status">Loading Staff Management…</div>}><ServiceOSStaffAdminWorkspace /></Suspense> : null}
        {revenueAuthorized ? (
          <Suspense fallback={<div role="status">Loading Revenue…</div>}>
            <ServiceOSLeadIntakePanel session={session} revenueContext={activeRevenueContext} />
            <ServiceOSRevenueWorkspace session={session} revenueContext={activeRevenueContext} />
            <ServiceOSQuoteDeliveryPanel session={session} revenueContext={activeRevenueContext} />
            <ServiceOSQuoteRevisionPanel session={session} revenueContext={activeRevenueContext} />
            <ServiceOSCustomerResponsePanel session={session} revenueContext={activeRevenueContext} />
          </Suspense>
        ) : null}
        {operationsAuthorized ? <Suspense fallback={<div role="status">Loading Operations…</div>}><ServiceOSOperationsWorkspace session={session} revenueContext={activeRevenueContext} /></Suspense> : null}
        {qaAuthorized ? <Suspense fallback={<div role="status">Loading QA…</div>}><ServiceOSQaWorkspace session={session} revenueContext={activeRevenueContext} /></Suspense> : null}
        {financeAuthorized ? <Suspense fallback={<div role="status">Loading Finance…</div>}><ServiceOSFinanceWorkspace session={session} revenueContext={activeRevenueContext} /></Suspense> : null}
      </div>
    </main>
  );
}
