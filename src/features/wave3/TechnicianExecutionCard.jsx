import React from "react";
import { StatusBadge } from "../../components/ui.jsx";

function humanize(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export function EarnedPayoutBanner({ payable, qaPending }) {
  const status = payable?.payable_status === "paid" ? "Paid" : payable ? "Approved" : "Pending QA";
  const tone = status === "Paid" ? "success" : status === "Approved" ? "info" : "warning";
  const amount = payable?.computed_amount != null && payable?.currency_code
    ? new Intl.NumberFormat("en", { style: "currency", currency: payable.currency_code }).format(Number(payable.computed_amount))
    : "Calculated after QA";
  const detail = status === "Paid" ? "Payment recorded" : status === "Approved" ? `${humanize(payable.payable_status)} settlement` : qaPending ? "Office review in progress" : "Complete the job to begin QA";
  return <aside className={`earned-payout-banner is-${status.toLowerCase().replaceAll(" ", "-")}`} data-worker-earned-payout="true" aria-live="polite">
    <div><span>Earned payout</span><strong>{amount}</strong><small>{detail}</small></div><StatusBadge tone={tone}>{status}</StatusBadge>
  </aside>;
}

export function TechnicianExecutionCard({ tasks, completedTasks, assignmentId, disabled, onToggle }) {
  return <section className="technician-execution-card field-checklist" aria-labelledby="field-checklist-title">
    <div className="field-checklist__heading"><div><p className="admin-eyebrow">Service checklist</p><h3 id="field-checklist-title">Complete every required step</h3></div><StatusBadge tone={completedTasks.length === tasks.length ? "success" : "warning"}>{completedTasks.length}/{tasks.length}</StatusBadge></div>
    <div className="technician-execution-card__tasks">{tasks.map((task, index) => {
      const key = `${assignmentId}:${index}`;
      const checked = completedTasks.includes(key);
      return <label className={`field-checklist-item ${checked ? "is-complete" : ""}`} key={key}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(key)} />
        <span>{task}</span><b aria-hidden="true">{checked ? "✓" : index + 1}</b>
      </label>;
    })}</div>
  </section>;
}

export function ResilientEvidenceUploader({ entries, disabled, onFiles, onRetry }) {
  return <section className="field-photo-zone resilient-evidence-uploader" aria-labelledby="field-photo-title">
    <div><p className="admin-eyebrow">Quality evidence</p><h3 id="field-photo-title">Add completion photos</h3><p>Each photo is tracked independently and safely retried on weak mobile connections.</p></div>
    <label className="field-photo-button"><input type="file" accept="image/*" capture="environment" multiple disabled={disabled} onChange={(event) => onFiles(Array.from(event.target.files || []))} /><span>＋ Add photos</span></label>
    {entries.length ? <ul className="mobile-evidence-list">{entries.map((entry) => <li key={entry.id} className={`is-${entry.state}`}>
      <div><strong>{entry.name}</strong><small>{entry.state === "uploading" ? `Uploading · attempt ${entry.attempt}/${4}` : entry.state === "verifying" ? "Verifying secure evidence link" : entry.state === "linked" ? "Securely linked" : entry.state === "error" ? entry.error : "Queued for submission"}</small></div>
      <StatusBadge tone={entry.state === "linked" ? "success" : entry.state === "error" ? "danger" : entry.state === "queued" ? "neutral" : "warning"}>{humanize(entry.state)}</StatusBadge>
      {entry.state === "error" ? <button type="button" disabled={disabled} onClick={() => onRetry(entry.id)}>Retry photo</button> : null}
    </li>)}</ul> : null}
  </section>;
}
