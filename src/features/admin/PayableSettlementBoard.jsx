import React from "react";
import { StatusBadge } from "../../components/ui.jsx";
import { formatFinancialAmount } from "../../lib/serviceosFinancialPerformance.js";

export default function PayableSettlementBoard({ rows = [], currencyCode, roleCode, busyId, onApprove }) {
  const outstanding = rows.filter((row) => ["pending", "approved"].includes(row.status));
  return <section className="financial-ledger-panel" aria-labelledby="settlement-board-title">
    <header><div><p className="admin-eyebrow">Governed contractor liabilities</p><h2 id="settlement-board-title">Payable settlement</h2><p>Approve accrued labor here; disbursement and payment evidence remain downstream controls.</p></div><StatusBadge tone="warning">{outstanding.length} outstanding</StatusBadge></header>
    {outstanding.length ? <div className="settlement-card-grid">{outstanding.map((row) => <article className="settlement-card" key={row.id}>
      <div><strong>{row.worker_name}</strong><StatusBadge tone={row.status === "pending" ? "warning" : "success"}>{row.status === "pending" ? "Pending approval" : "Approved to pay"}</StatusBadge></div>
      <span className="settlement-card__amount">{formatFinancialAmount(row.amount, row.currency_code || currencyCode)}</span>
      <p>{row.compensation_method === "hourly" ? `${Number(row.actual_hours || 0).toFixed(2)} hours × ${formatFinancialAmount(row.hourly_rate, row.currency_code || currencyCode)}/hr` : "Flat-rate compensation"}</p>
      <footer><a className="admin-inline-link" href="/admin/dispatch">{row.work_order_number || "View work order"}</a>{row.status === "pending" && roleCode === "owner_admin" ? <button className="huc-button" disabled={busyId === row.id} onClick={() => onApprove(row)}>{busyId === row.id ? "Approving…" : "Approve payout"}</button> : <span>Ready for disbursement</span>}</footer>
    </article>)}</div> : <div className="financial-empty-state"><StatusBadge tone="success">Current</StatusBadge><h3>No outstanding payables</h3><p>Accrued compensation appears here immediately after governed QA approval.</p></div>}
  </section>;
}
