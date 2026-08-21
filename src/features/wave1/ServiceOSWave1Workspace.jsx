import React from "react";
import { useServiceOSContext } from "../../auth/ServiceOSAuthGate";
import { canOpenServiceOSDiagnostics, SERVICEOS_DIAGNOSTICS_PATH } from "../../lib/serviceosUiPolicy";

const ROLE_LABELS = {
  owner_admin: "Owner / Admin",
  office_ops: "Office Operations",
  worker: "Worker",
  qa: "Quality Assurance",
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
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: 28,
  },
  eyebrow: { color: "#00D4AA", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" },
  title: { margin: "6px 0 4px", fontSize: 30, lineHeight: 1.15 },
  subtitle: { margin: 0, color: "#9AA9BC", fontSize: 14 },
  logout: {
    border: "1px solid #55657A",
    borderRadius: 8,
    background: "#151D2C",
    color: "#F5F8FC",
    padding: "10px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
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
};

export default function ServiceOSWave1Workspace() {
  const context = useServiceOSContext();
  const session = context?.session ?? null;
  const revenueContext = context?.revenueContext ?? null;
  const logout = context?.logout;
  const role = revenueContext?.roleCode ?? "unknown";
  const organizationId = revenueContext?.orgId ?? "Unavailable";
  const businessUnits = Array.isArray(revenueContext?.businessUnits) ? revenueContext.businessUnits : [];
  const email = session?.user?.email ?? "Unavailable";

  return (
    <main style={styles.page} data-serviceos-wave="wave1" data-canonical-workspace="true">
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Have Us Clean · ServiceOS 1.0</div>
            <h1 style={styles.title}>Wave 1 Access Workspace</h1>
            <p style={styles.subtitle}>Canonical authentication and role isolation pilot</p>
          </div>
          <button type="button" style={styles.logout} onClick={() => logout?.()} aria-label="Log out of ServiceOS">
            Logout
          </button>
        </header>

        <section style={styles.grid} aria-label="Authenticated ServiceOS context">
          <div style={styles.card}>
            <div style={styles.label}>Authenticated user</div>
            <div style={styles.value}>{email}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.label}>Canonical role</div>
            <div style={styles.value}>{ROLE_LABELS[role] ?? role}</div>
            <div style={styles.status}>{role}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.label}>Organization</div>
            <div style={styles.value}>Have Us Clean</div>
            <div style={{ ...styles.notice, marginTop: 6 }}>ID: {organizationId}</div>
          </div>
          <div style={styles.card}>
            <div style={styles.label}>Business-unit scope</div>
            <div style={styles.value}>{businessUnits.length ? businessUnits.join(", ") : "No visible business unit"}</div>
          </div>
        </section>

        <section style={{ ...styles.card, marginBottom: 14 }}>
          <h2 style={styles.sectionTitle}>Wave 1 status</h2>
          <p style={styles.notice}>
            Authentication is active and this workspace is intentionally isolated from the legacy HUC application data layer. No demo jobs, customers, invoices, partners, or other fixture data are loaded in canonical Production mode.
          </p>
          <div style={styles.status}>Canonical shell active</div>
        </section>

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Later ServiceOS waves</h2>
          <p style={styles.notice}>
            Revenue, Operations, QA, and Finance workflows remain unavailable from this Wave 1 shell until their rollout gates are explicitly enabled and accepted.
          </p>
          <div style={styles.actions}>
            {canOpenServiceOSDiagnostics(role) ? (
              <a href={SERVICEOS_DIAGNOSTICS_PATH} style={styles.link}>Open read-only diagnostics</a>
            ) : null}
            <span style={styles.disabled}>Revenue · disabled</span>
            <span style={styles.disabled}>Operations · disabled</span>
            <span style={styles.disabled}>QA · disabled</span>
            <span style={styles.disabled}>Finance · disabled</span>
          </div>
        </section>
      </div>
    </main>
  );
}
