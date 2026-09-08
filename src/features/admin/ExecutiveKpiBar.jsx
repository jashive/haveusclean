import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/ui.jsx";
import {
  fetchFinancialPerformance,
  formatContributionMargin,
  formatFinancialAmount,
  MARKET_CURRENCY,
  SERVICEOS_WORKSPACE_INVALIDATED_EVENT,
  serviceOSInvalidationMatches,
} from "../../lib/serviceosFinancialPerformance.js";

function percentage(numerator, denominator) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return "No governed data";
  return `${((top / bottom) * 100).toFixed(1)}%`;
}

export default function ExecutiveKpiBar({ revenueContext }) {
  const organizationId = revenueContext?.orgId;
  const businessUnitId = revenueContext?.primaryBusinessUnitId;
  const marketCode = revenueContext?.activeBusinessUnitCode;
  const currencyCode = MARKET_CURRENCY[marketCode];
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const period = useMemo(() => ({
    start: new Date(Date.now() - 30 * 86400000).toISOString(),
    end: new Date().toISOString(),
  }), [businessUnitId]);

  const load = useCallback(async () => {
    if (!organizationId || !businessUnitId || !currencyCode) return;
    setLoading(true);
    setError("");
    try {
      setData(await fetchFinancialPerformance({ organizationId, businessUnitId, periodStart: period.start, periodEnd: period.end }));
    } catch (nextError) {
      setData(null);
      setError(nextError?.message || "Executive metrics could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, businessUnitId, currencyCode, period]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = (event) => { if (serviceOSInvalidationMatches(event, businessUnitId)) load(); };
    window.addEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh);
      window.removeEventListener("focus", load);
    };
  }, [businessUnitId, load]);

  const kpis = data?.kpis;
  const cards = [
    ["Gross Booking Value", formatFinancialAmount(kpis?.gross_bookings, currencyCode), "Accepted value · tax excluded"],
    ["Cleaner Labor Accrual %", percentage(kpis?.cleaner_labor_accrued, kpis?.recognized_revenue), `${formatFinancialAmount(kpis?.cleaner_labor_accrued, currencyCode)} accrued`],
    ["Net Realized Margin %", formatContributionMargin(kpis?.contribution_margin_percent), `${formatFinancialAmount(kpis?.net_contribution, currencyCode)} contribution`],
    ["Completed Jobs", Number.isFinite(Number(kpis?.jobs_count)) ? String(Number(kpis.jobs_count)) : "No governed data", "Governed profitability snapshots"],
  ];

  return <section className="executive-kpi-bar" aria-labelledby="executive-kpi-title" data-market-code={marketCode}>
    <header><div><p className="admin-eyebrow">Executive unit economics · last 30 days</p><h2 id="executive-kpi-title">{marketCode} flight metrics</h2></div><StatusBadge tone={error ? "danger" : "success"}>{currencyCode || "Market required"}</StatusBadge></header>
    {error ? <div className="financial-alert" role="alert">{error}</div> : <div className="executive-kpi-bar__grid" aria-busy={loading}>{cards.map(([label, value, hint]) => <article key={label}><span>{label}</span><strong>{loading ? "Refreshing…" : value}</strong><small>{hint}</small></article>)}</div>}
  </section>;
}
