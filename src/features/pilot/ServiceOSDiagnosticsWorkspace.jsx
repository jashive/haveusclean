import React, { lazy, Suspense, useState } from "react";
import { canOpenServiceOSDiagnostics } from "../../lib/serviceosUiPolicy";

const diagnostics = [
  ["revenue", "Revenue", () => import("./ServiceOSPilotPanel")],
  ["operations", "Operations", () => import("./ServiceOSOperationsPilotPanel")],
  ["delivery", "Delivery & QA", () => import("./ServiceOSWave4PilotPanel")],
  ["finance", "Finance", () => import("./ServiceOSWave5FinancePilotPanel")],
  ["intelligence", "Intelligence", () => import("../intelligence/Wave6IntelligencePanel")],
];

const panels = Object.fromEntries(diagnostics.map(([id, , loader]) => [id, lazy(loader)]));

export default function ServiceOSDiagnosticsWorkspace({ session, revenueContext }) {
  const [selected, setSelected] = useState(null);
  const role = revenueContext?.roleCode;
  if (!canOpenServiceOSDiagnostics(role)) {
    return <main style={styles.message}><h1>Diagnostics unavailable</h1><p>This acceptance tool is restricted to owner administrators.</p></main>;
  }
  const SelectedPanel = selected ? panels[selected] : null;
  return (
    <main style={styles.page} data-testid="serviceos-diagnostics-workspace">
      <header style={styles.header}>
        <div><strong>ServiceOS diagnostics</strong><div style={styles.subtitle}>Acceptance tooling — select one controlled surface at a time.</div></div>
        <a href="/" style={styles.link}>Return to workspace</a>
      </header>
      <nav aria-label="ServiceOS diagnostic surfaces" style={styles.nav}>
        {diagnostics.map(([id, label]) => <button key={id} type="button" onClick={() => setSelected(id)} aria-pressed={selected === id} style={selected === id ? styles.activeButton : styles.button}>{label}</button>)}
      </nav>
      <section style={styles.content}>
        {!SelectedPanel && <div style={styles.empty}><h1>Choose a diagnostic surface</h1><p>Pilot and Wave panels are never mounted over the operator workspace.</p></div>}
        {SelectedPanel && <Suspense fallback={<p>Loading selected diagnostic…</p>}><SelectedPanel session={session} revenueContext={revenueContext} /></Suspense>}
      </section>
    </main>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#0a0f1e", color: "#f0f6ff", fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "14px clamp(12px, 3vw, 32px)", borderBottom: "1px solid #26324a", flexWrap: "wrap" },
  subtitle: { color: "#9aa9c2", fontSize: 13, marginTop: 4 }, link: { color: "#00d4aa" },
  nav: { display: "flex", gap: 8, padding: "12px clamp(12px, 3vw, 32px)", overflowX: "auto" },
  button: { padding: "10px 14px", borderRadius: 8, border: "1px solid #34425d", background: "#111a2d", color: "#c6d2e6", whiteSpace: "nowrap", cursor: "pointer" },
  activeButton: { padding: "10px 14px", borderRadius: 8, border: "1px solid #00d4aa", background: "#00d4aa22", color: "#00d4aa", whiteSpace: "nowrap", cursor: "pointer" },
  content: { padding: "0 clamp(12px, 3vw, 32px) 32px", overflow: "auto" }, empty: { maxWidth: 680, margin: "10vh auto", textAlign: "center" },
  message: { minHeight: "100vh", padding: 32, background: "#0a0f1e", color: "#f0f6ff", fontFamily: "system-ui, sans-serif" },
};
