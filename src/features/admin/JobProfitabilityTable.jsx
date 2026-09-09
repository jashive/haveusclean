import React from "react";
import { StatusBadge } from "../../components/ui.jsx";
import { formatFinancialAmount, formatContributionMargin } from "../../lib/serviceosFinancialPerformance.js";
import { profitabilityLabel, profitabilityTone } from "../../lib/serviceosFinancialLedgers.js";

export default function JobProfitabilityTable({ jobs = [], currencyCode }) {
  return <section className="financial-ledger-panel" aria-labelledby="profitability-table-title">
    <header><div><p className="admin-eyebrow">Sealed job snapshots · last 30 days</p><h2 id="profitability-table-title">Job profitability</h2><p>Revenue and direct labor are read from immutable profitability snapshots.</p></div><StatusBadge tone="neutral">{jobs.length} jobs</StatusBadge></header>
    {jobs.length ? <div className="profitability-table" role="table" aria-label="Job profitability"><div className="profitability-table__row profitability-table__head" role="row"><span>Work order</span><span>Completed</span><span>Revenue</span><span>Labor</span><span>Contribution</span><span>Margin</span></div>{jobs.map((job) => {
      const margin = job.contribution_margin_percent;
      return <div className="profitability-table__row" role="row" key={job.snapshot_id}><span><a className="admin-inline-link" href="/admin/dispatch">{job.work_order_number || job.job_label}</a><small>{job.job_label}</small></span><span>{job.service_completed_at ? new Date(job.service_completed_at).toLocaleDateString() : "—"}</span><span>{formatFinancialAmount(job.recognized_revenue, currencyCode)}</span><span>{formatFinancialAmount(job.cleaner_cost, currencyCode)}</span><span>{formatFinancialAmount(job.net_contribution, currencyCode)}</span><span data-tip="Healthy ≥50%, Watch ≥30%, At Risk <30%"><StatusBadge tone={profitabilityTone(margin)}>{profitabilityLabel(margin)} · {formatContributionMargin(margin)}</StatusBadge></span></div>;
    })}</div> : <div className="financial-empty-state"><StatusBadge tone="neutral">No governed data</StatusBadge><h3>No completed jobs in this period</h3><p>Profitability appears after QA seals a job snapshot.</p></div>}
  </section>;
}
