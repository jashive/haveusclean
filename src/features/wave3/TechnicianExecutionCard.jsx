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
      const taskLabel = typeof task === "string" ? task : task.label;
      const taskKey = typeof task === "string" ? index : task.key || index;
      const key = `${assignmentId}:${taskKey}`;
      const checked = completedTasks.includes(key);
      return <label className={`field-checklist-item ${checked ? "is-complete" : ""}`} key={key}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(key)} />
        <span>{taskLabel}</span><b aria-hidden="true">{checked ? "✓" : index + 1}</b>
      </label>;
    })}</div>
  </section>;
}

export function ResilientEvidenceUploader({ entries, requirements = [], disabled, onFiles, onRetry }) {
  const configuredRequirements = requirements.length ? requirements : [{ requirement_key: "service_after", evidence_type: "photo_after", evidence_tag: "after_clean", label: "Completed service", required_count: 1 }];
  return <section className="field-photo-zone resilient-evidence-uploader" aria-labelledby="field-photo-title">
    <div><p className="admin-eyebrow">Quality evidence</p><h3 id="field-photo-title">Add completion photos</h3><p>Each photo is tracked independently and safely retried on weak mobile connections.</p></div>
    <div className="field-evidence-requirements">{configuredRequirements.map((requirement) => <label className="field-photo-button" key={requirement.requirement_key} data-evidence-tag={requirement.evidence_tag}>
      <input type="file" accept="image/*" capture="environment" multiple disabled={disabled} onChange={(event) => onFiles(Array.from(event.target.files || []), requirement)} />
      <span>＋ {requirement.label || humanize(requirement.evidence_tag)} · {requirement.required_count || 1}</span>
    </label>)}</div>
    {entries.length ? <ul className="mobile-evidence-list">{entries.map((entry) => <li key={entry.id} className={`is-${entry.state}`}>
      <div><strong>{entry.name}</strong><small>{entry.requirement?.evidence_tag ? `${humanize(entry.requirement.evidence_tag)} · ` : ""}{entry.state === "uploading" ? `Uploading · attempt ${entry.attempt}/${4}` : entry.state === "verifying" ? "Verifying secure evidence link" : entry.state === "linked" ? "Securely linked" : entry.state === "error" ? entry.error : "Queued for submission"}</small></div>
      <StatusBadge tone={entry.state === "linked" ? "success" : entry.state === "error" ? "danger" : entry.state === "queued" ? "neutral" : "warning"}>{humanize(entry.state)}</StatusBadge>
      {entry.state === "error" ? <button type="button" disabled={disabled} onClick={() => onRetry(entry.id)}>Retry photo</button> : null}
    </li>)}</ul> : null}
  </section>;
}
