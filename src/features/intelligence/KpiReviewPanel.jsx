// ── Wave 6: KPI Review Panel ─────────────────────────────────────────────────
//
// Renders governed KPI cards grouped by domain. Values are always rendered
// through wave6Formatters — a missing or non-computable value renders as an
// explicit "no data" marker, never as 0, NaN, or invented sample data.

import React from "react";

import { resolveGovernedKpiDefinition } from "../../lib/wave6DefinitionResolver.js";
import {
  NO_DATA,
  describeRateBasis,
  formatDomainLabel,
  formatFreshness,
  formatKpiValue,
  formatLineage,
} from "./wave6Formatters.js";

const styles = {
  group: { marginBottom: "0.9rem" },
  groupLabel: {
    fontSize: "0.7rem",
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#7dd3fc",
    marginBottom: 6,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 8,
  },
  card: {
    background: "#0a1628",
    border: "1px solid #1e3a5f",
    borderRadius: 6,
    padding: "0.55rem 0.6rem",
  },
  cardName: { fontSize: "0.7rem", color: "#94a3b8", marginBottom: 2 },
  cardValue: { fontSize: "1.1rem", fontWeight: 700, color: "#e8f4ff" },
  cardMeta: { fontSize: "0.63rem", color: "#64748b", marginTop: 3, lineHeight: 1.35 },
  empty: { fontSize: "0.75rem", color: "#94a3b8", padding: "0.4rem 0" },
};

const DOMAIN_ORDER = ["sales", "operations", "quality", "finance"];

function domainOf(kpiCode) {
  const domain = String(kpiCode ?? "").split(".")[0];
  return DOMAIN_ORDER.includes(domain) ? domain : "sales";
}

export default function KpiReviewPanel({
  kpis = [],
  definitions = [],
  organizationId,
  periodType,
  periodStart,
  periodEnd,
  periodLabel = "",
  timezone = "America/Toronto",
  currency = "CAD",
}) {
  if (!Array.isArray(kpis) || kpis.length === 0) {
    return (
      <div style={styles.empty}>
        No KPI values computed for {periodLabel || "this period"}. Canonical source tables
        returned no rows in range — nothing is estimated or back-filled.
      </div>
    );
  }

  return (
    <div>
      {DOMAIN_ORDER.map((domain) => {
        const domainKpis = kpis.filter((kpi) => domainOf(kpi.kpiCode) === domain);
        if (domainKpis.length === 0) return null;
        return (
          <div key={domain} style={styles.group}>
            <div style={styles.groupLabel}>{formatDomainLabel(domain)}</div>
            <div style={styles.grid}>
              {domainKpis.map((kpi) => {
                const resolved = resolveGovernedKpiDefinition(definitions, {
                  organizationId,
                  kpiCode: kpi.kpiCode,
                  periodType,
                  periodStart,
                  periodEnd,
                });
                const definition = resolved.definition;
                const unit = definition?.unit ?? null;
                const isRate = unit === "ratio";
                const unavailable = kpi.unavailable === true;
                const knownRowCounts = Object.values(kpi.rowCounts ?? {}).filter(
                  (count) => typeof count === "number"
                );
                const runtimeSourceTables = Array.isArray(kpi.sourceLineage?.runtime?.sources)
                  ? kpi.sourceLineage.runtime.sources.map((source) => source.table)
                  : null;
                return (
                  <div key={kpi.kpiCode} style={styles.card}>
                    <div style={styles.cardName}>{definition?.name ?? kpi.kpiCode}</div>
                    <div style={styles.cardValue}>
                      {definition === null
                        ? NO_DATA
                        : formatKpiValue(kpi.value, unit, currency)}
                    </div>
                    <div style={styles.cardMeta}>
                      {periodLabel ? `${periodLabel} · ${timezone}` : timezone}
                      <br />
                      {definition?.definition_version
                        ? `Definition v${definition.definition_version}`
                        : `Definition: ${resolved.error ?? NO_DATA}`}
                      <br />
                      {definition === null ? (
                        <>Governed value unavailable — {resolved.error ?? "no applicable definition"}</>
                      ) : unavailable ? (
                        `Source unavailable: ${formatLineage(kpi.unavailableSources)}`
                      ) : isRate ? (
                        describeRateBasis(kpi.numerator, kpi.denominator)
                      ) : (
                        `Rows: ${
                          knownRowCounts.length > 0
                            ? knownRowCounts.reduce((a, b) => a + b, 0)
                            : NO_DATA
                        }`
                      )}
                      <br />
                      Source: {formatLineage(runtimeSourceTables ?? kpi.sourceTables ?? definition?.source_lineage?.tables)}
                      <br />
                      {formatFreshness(kpi.freshnessAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
