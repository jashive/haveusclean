import React, { useCallback, useEffect, useState } from "react";
import { StatusBadge, TechnicalDetails } from "../../components/ui.jsx";
import { fetchOs10IntelligenceDashboard, isoDate } from "../../lib/serviceosIntelligenceDashboard.js";

function Empty({ children = "No governed data is available for this period." }) {
  return <div className="intelligence-empty"><StatusBadge tone="neutral">No governed data</StatusBadge><p>{children}</p></div>;
}

function AdvisoryCard({ title, description, children }) {
  return <article className="intelligence-card"><header><h3>{title}</h3><p>{description}</p></header>{children}</article>;
}

export function RouteDensityPanel({ rows }) {
  const data = (rows || []).filter((row) => row.jobs > 0);
  return <AdvisoryCard title="Route density" description="Daily proximity of consecutive scheduled stops.">{data.length ? <ul>{data.map(row => <li key={row.date}><span>{row.date} · {row.jobs} jobs</span><StatusBadge tone={row.density_score >= 70 ? "success" : "warning"}>{row.density_score == null ? "Coordinates needed" : `${row.density_score}/100`}</StatusBadge></li>)}</ul> : <Empty />}</AdvisoryCard>;
}

export function CapacityForecastPanel({ rows }) {
  const data = (rows || []).filter(row => row.available_minutes != null || row.scheduled_minutes > 0);
  return <AdvisoryCard title="Capacity forecast" description="Declared cleaner availability compared with scheduled hours.">{data.length ? <ul>{data.map(row => <li key={row.date}><span>{row.date} · {(row.scheduled_minutes / 60).toFixed(1)}h scheduled</span><StatusBadge tone={row.status === "overbooked" ? "danger" : row.status === "warning" ? "warning" : row.status === "available" ? "success" : "neutral"}>{row.utilization_percent == null ? "Capacity needed" : `${row.utilization_percent}%`}</StatusBadge></li>)}</ul> : <Empty>Declare worker capacity to enable forecasting.</Empty>}</AdvisoryCard>;
}

export function RetentionChurnPanel({ rows }) {
  return <AdvisoryCard title="Retention & churn" description="Recurring-account cadence drift; signals are advisory.">{rows?.length ? <ul>{rows.map(row => <li key={row.cadence}><span>{row.cadence} · {row.accounts} accounts</span><StatusBadge tone={row.churn_signal > 0 ? "danger" : row.at_risk > 0 ? "warning" : "success"}>{row.churn_signal} churn · {row.at_risk} at risk</StatusBadge></li>)}</ul> : <Empty>Completed recurring service history is required.</Empty>}</AdvisoryCard>;
}

export function MarginDriftPanel({ rows, currencyCode }) {
  const money=(value)=>value==null?"—":new Intl.NumberFormat("en",{style:"currency",currency:currencyCode}).format(Number(value));
  return <AdvisoryCard title="Margin drift" description={`Active projections and sealed completed-job results in ${currencyCode}.`}>{rows?.length ? <ul>{rows.map((row,index) => <li key={`${row.job_label}-${row.record_type}-${index}`}><span><b>{row.job_label}</b> · {row.record_type === "realized" ? `Quoted margin ${money(row.quoted_margin)} → realized ${money(row.actual_margin)} (${row.actual_margin_percent ?? "—"}%)` : `${row.elapsed_hours}h elapsed / ${row.quoted_hours}h quoted`}</span><StatusBadge tone={row.drift_status === "negative" ? "danger" : row.drift_status === "watch" ? "warning" : "success"}>{row.record_type === "realized" ? "realized" : row.drift_status.replaceAll("_", " ")}</StatusBadge></li>)}</ul> : <Empty>No active timing projection or completed profitability snapshot is available.</Empty>}</AdvisoryCard>;
}

export default function Os10IntelligenceDashboard({ revenueContext }) {
  const [data,setData] = useState(null); const [error,setError] = useState(""); const [loading,setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!revenueContext?.orgId || !revenueContext?.primaryBusinessUnitId) return;
    setLoading(true); setError("");
    const start = new Date(); const end = new Date(); end.setDate(end.getDate()+13);
    try { setData(await fetchOs10IntelligenceDashboard({ organizationId: revenueContext.orgId, businessUnitId: revenueContext.primaryBusinessUnitId, dateFrom: isoDate(start), dateTo: isoDate(end) })); }
    catch (err) { setData(null); setError(err?.message || "Intelligence dashboard could not be loaded."); }
    finally { setLoading(false); }
  }, [revenueContext?.orgId,revenueContext?.primaryBusinessUnitId]);
  useEffect(() => { load(); }, [load]);
  return <section className="intelligence-dashboard" aria-labelledby="intelligence-title"><header className="intelligence-dashboard__header"><div><p className="admin-eyebrow">OS 1.0 advisory layer</p><h2 id="intelligence-title">Operational intelligence</h2><p>Forward-looking signals never change schedules, pricing, or customer status automatically.</p></div><button className="huc-button huc-button--secondary" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></header>
    {error ? <div className="financial-alert" role="alert">{error}</div> : null}
    <div className="intelligence-grid"><RouteDensityPanel rows={data?.route_density}/><CapacityForecastPanel rows={data?.capacity}/><RetentionChurnPanel rows={data?.retention}/><MarginDriftPanel rows={data?.margin_drift} currencyCode={data?.scope?.currency_code || "—"}/></div>
    <TechnicalDetails><span>Market: {data?.scope?.market_code || "Unavailable"}</span><span>Generated: {data?.generated_at || "Not loaded"}</span></TechnicalDetails>
  </section>;
}
