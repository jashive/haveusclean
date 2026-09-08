import React, { useMemo, useState } from "react";
import { StatusBadge } from "../../components/ui.jsx";
import { filterWorkOrderHistory } from "../../lib/serviceosPipelineDispatch.js";

function money(value, currency) { return Number.isFinite(value) && currency ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value) : "—"; }

export default function WorkOrderHistoryTable({ jobs }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const visible = useMemo(() => filterWorkOrderHistory(jobs, query, status), [jobs, query, status]);
  return <section className="dispatch-panel work-order-history" aria-labelledby="history-title">
    <header><div><p className="admin-eyebrow">Customer record</p><h3 id="history-title">Work-order history</h3></div><div className="work-order-history__filters"><label><span>Search</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, address, cleaner, work order" /></label><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="qa_pending">QA pending</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label></div></header>
    <div className="work-order-history__scroll"><table><thead><tr><th>Customer</th><th>Service</th><th>Schedule</th><th>Team</th><th>Status</th><th>Value</th></tr></thead><tbody>{visible.map((job) => <tr key={job.id}><td><strong>{job.customerName}</strong><small>{job.address}</small></td><td>{job.serviceFamily.replaceAll("_", " ")}<small>{job.workOrderNumber || "Work order pending"}</small></td><td>{job.scheduledStart ? new Date(job.scheduledStart).toLocaleString() : "Unscheduled"}</td><td>{job.workerNames.join(", ") || "Unassigned"}</td><td><StatusBadge tone={job.operationalStatus === "closed" ? "success" : "info"}>{job.operationalStatus.replaceAll("_", " ")}</StatusBadge></td><td>{money(job.totalAmount, job.currencyCode)}</td></tr>)}</tbody></table>{!visible.length ? <p className="dispatch-empty-state">No governed work orders match these filters.</p> : null}</div>
  </section>;
}
