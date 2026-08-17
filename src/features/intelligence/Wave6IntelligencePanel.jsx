// ── Wave 6: Intelligence / Governance / Continuity Panel ─────────────────────
//
// Feature-flagged by VITE_SERVICEOS_W6_INTELLIGENCE_ENABLED.
//
// This panel renders only data it actually read from the database through
// serviceosIntelligenceClient.js. There is no sample data, no simulated chart
// series, and no placeholder control: when a period has no evidence the panel
// states that truthfully.

import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  loadCanonicalEvents,
  loadChangeControlRecords,
  loadContinuitySessions,
  loadKpiDefinitions,
  loadKpiSnapshots,
  loadManagementReviews,
  loadReleaseGates,
  loadServiceModuleProfiles,
  computePeriodKpis,
} from "../../lib/serviceosIntelligenceClient.js";
import { formatPeriodLabel, getPeriodBoundaries } from "../../lib/serviceosIntelligenceUtils.js";
import ChangeControlPanel from "./ChangeControlPanel.jsx";
import ContinuityPanel from "./ContinuityPanel.jsx";
import KpiReviewPanel from "./KpiReviewPanel.jsx";
import ManagementReviewPanel from "./ManagementReviewPanel.jsx";
import ModuleReadinessPanel from "./ModuleReadinessPanel.jsx";
import { formatErrorMessage, formatFreshness, formatTimestamp } from "./wave6Formatters.js";

const TABS = [
  { id: "TODAY", label: "Today", periodType: "DAILY" },
  { id: "MONTHLY", label: "Monthly", periodType: "MONTHLY" },
  { id: "QUARTERLY", label: "Quarterly", periodType: "QUARTERLY" },
  { id: "YEARLY", label: "Yearly", periodType: "YEARLY" },
];

const SECTIONS = [
  { id: "kpi", label: "KPI review" },
  { id: "management", label: "Mgmt review" },
  { id: "change", label: "Change control" },
  { id: "continuity", label: "Continuity" },
  { id: "readiness", label: "Module readiness" },
];

const DEFAULT_TIMEZONE = "America/Toronto";

const styles = {
  wrap: {
    position: "fixed",
    right: 16,
    bottom: 16,
    width: 460,
    maxHeight: "78vh",
    overflowY: "auto",
    background: "#0b1220",
    border: "1px solid #1e3a5f",
    borderRadius: 10,
    padding: "0.85rem 0.9rem",
    color: "#e8f4ff",
    fontFamily: "system-ui, -apple-system, sans-serif",
    zIndex: 9000,
    boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: "0.85rem", fontWeight: 700, letterSpacing: 0.4 },
  subtitle: { fontSize: "0.66rem", color: "#94a3b8", marginTop: 2 },
  tabs: { display: "flex", gap: 5, flexWrap: "wrap", margin: "0.6rem 0 0.5rem" },
  tab: {
    background: "#0a1628",
    border: "1px solid #1e3a5f",
    borderRadius: 999,
    color: "#94a3b8",
    fontSize: "0.66rem",
    fontWeight: 600,
    padding: "0.22rem 0.6rem",
    cursor: "pointer",
  },
  tabActive: {
    background: "#1d4ed8",
    border: "1px solid #1d4ed8",
    borderRadius: 999,
    color: "#e8f4ff",
    fontSize: "0.66rem",
    fontWeight: 600,
    padding: "0.22rem 0.6rem",
    cursor: "pointer",
  },
  button: {
    background: "#1d4ed8",
    border: "none",
    borderRadius: 4,
    color: "#e8f4ff",
    fontSize: "0.66rem",
    fontWeight: 600,
    padding: "0.25rem 0.55rem",
    cursor: "pointer",
  },
  meta: { fontSize: "0.65rem", color: "#94a3b8", lineHeight: 1.5, marginBottom: "0.5rem" },
  error: {
    background: "#3f1d1d",
    border: "1px solid #7f1d1d",
    borderRadius: 6,
    color: "#fecaca",
    fontSize: "0.7rem",
    padding: "0.4rem 0.55rem",
    marginBottom: "0.5rem",
    lineHeight: 1.4,
  },
  loading: { fontSize: "0.72rem", color: "#94a3b8", padding: "0.4rem 0" },
};

const EMPTY_STATE = {
  definitions: [],
  kpis: [],
  snapshots: [],
  events: [],
  changeRecords: [],
  continuitySessions: [],
  profiles: [],
  gates: [],
  reviews: [],
};

export default function Wave6IntelligencePanel({ session, revenueContext }) {
  const [activeTab, setActiveTab] = useState("TODAY");
  const [activeSection, setActiveSection] = useState("kpi");
  const [state, setState] = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);

  const organizationId = revenueContext?.orgId ?? null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId ?? null;
  const jurisdictionId = revenueContext?.primaryJurisdictionId ?? null;
  const timezone = revenueContext?.timezone ?? DEFAULT_TIMEZONE;

  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
  const periodType = tab.periodType;

  const period = useMemo(
    () => getPeriodBoundaries(periodType, new Date(), timezone),
    [periodType, timezone]
  );

  const periodLabel = useMemo(
    () => formatPeriodLabel(periodType, period.periodStart, timezone),
    [periodType, period.periodStart, timezone]
  );

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setError("No ServiceOS organization is bound to this session — nothing can be read.");
      setState(EMPTY_STATE);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [
        definitions,
        kpis,
        snapshots,
        events,
        changeRecords,
        continuitySessions,
        profiles,
        gates,
        reviews,
      ] = await Promise.all([
        loadKpiDefinitions(session, { organizationId }),
        computePeriodKpis(session, {
          organizationId,
          businessUnitId,
          jurisdictionId,
          periodType,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          timezone,
        }),
        loadKpiSnapshots(session, {
          organizationId,
          businessUnitId,
          jurisdictionId,
          periodType,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        }),
        loadCanonicalEvents(session, { organizationId, businessUnitId, periodStart: period.periodStart, periodEnd: period.periodEnd }),
        loadChangeControlRecords(session, { organizationId, businessUnitId }),
        loadContinuitySessions(session, { organizationId, businessUnitId }),
        loadServiceModuleProfiles(session, { organizationId }),
        loadReleaseGates(session, { organizationId }),
        loadManagementReviews(session, {
          organizationId,
          businessUnitId,
          periodType,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          timezone,
        }),
      ]);
      setState({
        definitions,
        kpis,
        snapshots,
        events,
        changeRecords,
        continuitySessions,
        profiles,
        gates,
        reviews,
      });
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setState(EMPTY_STATE);
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [
    session,
    organizationId,
    businessUnitId,
    jurisdictionId,
    periodType,
    period.periodStart,
    period.periodEnd,
    timezone,
  ]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const exceptionCount = state.events.filter(
    (event) => event.event_name === "quality.exception.opened"
  ).length;

  const freshestEvent = state.events.reduce(
    (latest, event) =>
      !latest || (event.occurred_at && event.occurred_at > latest) ? event.occurred_at : latest,
    null
  );

  return (
    <div style={styles.wrap} data-testid="wave6-intelligence-panel">
      <div style={styles.header}>
        <div>
          <div style={styles.title}>ServiceOS Wave 6 — Intelligence &amp; Governance</div>
          <div style={styles.subtitle}>
            {periodLabel} · {timezone}
          </div>
        </div>
        <button type="button" style={styles.button} onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div style={styles.tabs}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            style={entry.id === activeTab ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div style={styles.tabs}>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            style={entry.id === activeSection ? styles.tabActive : styles.tab}
            onClick={() => setActiveSection(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div style={styles.meta}>
        Period {formatTimestamp(period.periodStart, timezone)} →{" "}
        {formatTimestamp(period.periodEnd, timezone)}
        <br />
        Data read {loadedAt ? formatFreshness(loadedAt) : "not yet"} · canonical events{" "}
        {state.events.length} · latest event {freshestEvent ? formatFreshness(freshestEvent) : "—"}
        <br />
        Captured snapshots this period: {state.snapshots.length} · exceptions opened:{" "}
        {exceptionCount}
        <br />
        Lineage: values are computed live from governed Wave 1-5 source tables and canonical
        events where available; snapshots are the append-only evidence of a capture.
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <div style={styles.loading}>Reading governed data…</div>}

      {!loading && activeSection === "management" && (
        <ManagementReviewPanel
          session={session}
          organizationId={organizationId}
          businessUnitId={businessUnitId}
          jurisdictionId={jurisdictionId}
          periodType={periodType}
          period={period}
          timezone={timezone}
          kpis={state.kpis}
          kpiDefinitions={state.definitions}
          reviews={state.reviews}
          onChanged={refresh}
        />
      )}

      {!loading && activeSection === "kpi" && (
        <KpiReviewPanel
          kpis={state.kpis}
          definitions={state.definitions}
          organizationId={organizationId}
          periodType={periodType}
          periodStart={period.periodStart.toISOString()}
          periodEnd={period.periodEnd.toISOString()}
          periodLabel={periodLabel}
          timezone={timezone}
        />
      )}

      {!loading && activeSection === "change" && (
        <ChangeControlPanel
          session={session}
          organizationId={organizationId}
          businessUnitId={businessUnitId}
          records={state.changeRecords}
          onChanged={refresh}
        />
      )}

      {!loading && activeSection === "continuity" && (
        <ContinuityPanel
          session={session}
          organizationId={organizationId}
          businessUnitId={businessUnitId}
          sessions={state.continuitySessions}
          onChanged={refresh}
        />
      )}

      {!loading && activeSection === "readiness" && (
        <ModuleReadinessPanel profiles={state.profiles} gates={state.gates} />
      )}
    </div>
  );
}
