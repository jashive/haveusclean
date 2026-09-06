import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge, TechnicalDetails } from "../../components/ui.jsx";
import { fetchFinancialPerformance, formatContributionMargin, formatFinancialAmount, MARKET_CURRENCY } from "../../lib/serviceosFinancialPerformance.js";

export function FinancialKpiGrid({ kpis, currencyCode }) {
  const cards = [
    ["Gross bookings", formatFinancialAmount(kpis?.gross_bookings, currencyCode), "Accepted quote subtotal, excluding tax"],
    ["Cleaner payouts", formatFinancialAmount(kpis?.cleaner_payouts, currencyCode), "Approved and paid contractor payables"],
    ["Net contribution", formatFinancialAmount(kpis?.net_contribution, currencyCode), "Recognized revenue less direct costs"],
    ["Contribution margin", formatContributionMargin(kpis?.contribution_margin_percent), "Weighted across governed job snapshots"],
  ];
  return <div className="financial-kpi-grid">{cards.map(([label, value, hint]) => <article className="financial-kpi-card" key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</div>;
}

export function UnitEconomicsBreakdown({ data, currencyCode }) {
  const rows = Array.isArray(data?.jobs) ? data.jobs : [];
  if (!rows.length) return <div className="financial-empty-state"><StatusBadge tone="neutral">No governed data</StatusBadge><h3>No completed job economics in this period</h3><p>Metrics appear after a governed profitability snapshot is recorded.</p></div>;
  return <div className="financial-table" role="table" aria-label="Job-level unit economics">
    <div className="financial-table__row financial-table__head" role="row"><span>Job</span><span>Revenue</span><span>Cleaner cost</span><span>Other direct</span><span>Contribution</span><span>Margin</span></div>
    {rows.map((row, index) => <div className="financial-table__row" role="row" key={row.operational_job_id}>
      <span><b>{row.job_label || `Completed job ${index + 1}`}</b><small>{new Date(row.snapshot_taken_at).toLocaleDateString()}</small></span>
      <span>{formatFinancialAmount(row.recognized_revenue, currencyCode)}</span><span>{formatFinancialAmount(row.cleaner_cost, currencyCode)}</span><span>{formatFinancialAmount(row.other_direct_cost, currencyCode)}</span><span>{formatFinancialAmount(row.net_contribution, currencyCode)}</span><span>{formatContributionMargin(row.contribution_margin_percent)}</span>
      <TechnicalDetails><span>Operational job: {row.operational_job_id}</span><span>Snapshot: {row.snapshot_id}</span></TechnicalDetails>
    </div>)}
  </div>;
}

export default function FinancialPerformancePanel({ revenueContext }) {
  const organizationId = revenueContext?.orgId;
  const businessUnitId = revenueContext?.primaryBusinessUnitId;
  const marketCode = revenueContext?.activeBusinessUnitCode;
  const currencyCode = MARKET_CURRENCY[marketCode];
  const [data, setData] = useState(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const period = useMemo(() => ({ end: new Date().toISOString(), start: new Date(Date.now() - 30 * 86400000).toISOString() }), [businessUnitId]);
  const load = useCallback(async () => { if (!organizationId || !businessUnitId || !currencyCode) return; setLoading(true); setError(""); try { setData(await fetchFinancialPerformance({ organizationId, businessUnitId, periodStart: period.start, periodEnd: period.end })); } catch (e) { setError(e?.message || "Financial performance could not be loaded."); } finally { setLoading(false); } }, [organizationId, businessUnitId, currencyCode, period]);
  useEffect(() => { load(); }, [load]);
  return <section className="financial-performance-panel" data-financial-performance="territory-isolated">
    <header><div><p className="admin-eyebrow">Financial performance · last 30 days</p><h2>{marketCode} unit economics</h2><p>Governed values are isolated in {currencyCode}. Tax is excluded from operating contribution.</p></div><button className="huc-button huc-button--secondary" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></header>
    {error ? <div className="financial-alert" role="alert">{error}</div> : <><FinancialKpiGrid kpis={data?.kpis} currencyCode={currencyCode} /><div className="financial-section-heading"><div><h3>Job-level unit economics</h3><p>Latest append-only profitability snapshot per job.</p></div><StatusBadge tone="info">{data?.unit_economics?.jobs_count ?? 0} jobs</StatusBadge></div><UnitEconomicsBreakdown data={data} currencyCode={currencyCode} /></>}
    <TechnicalDetails summary="Metric definitions"><p><b>Gross bookings:</b> accepted quote subtotal, excluding tax.</p><p><b>Cleaner payouts:</b> approved or paid contractor payables.</p><p><b>Net contribution:</b> recognized revenue less cleaner and other direct costs.</p><p><b>Contribution margin:</b> total net contribution divided by total recognized revenue.</p></TechnicalDetails>
  </section>;
}
