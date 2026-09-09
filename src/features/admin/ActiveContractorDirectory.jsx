import React from "react";
import { StatusBadge } from "../../components/ui.jsx";

function pay(contractor) {
  if (contractor.rateValue == null || !contractor.currencyCode) return "Rate not approved";
  const amount = new Intl.NumberFormat("en", { style: "currency", currency: contractor.currencyCode }).format(Number(contractor.rateValue));
  return `${amount}${contractor.compensationMethod === "hourly" ? "/hr" : ""}`;
}

export default function ActiveContractorDirectory({ contractors, marketCode, busyId, onReadiness }) {
  return <section className="team-panel contractor-directory" aria-labelledby="contractor-directory-title"><header><div><p className="admin-eyebrow">Active contractor directory</p><h3 id="contractor-directory-title">Dispatch readiness</h3></div><StatusBadge tone="success">{contractors.filter((item) => item.dispatchReady).length} ready</StatusBadge></header>
    <div className="contractor-directory__grid">{contractors.map((contractor) => <article className="contractor-card" key={contractor.id}><div className="contractor-card__identity"><span aria-hidden="true">{contractor.display_name?.slice(0, 1)?.toUpperCase()}</span><div><strong>{contractor.display_name}</strong><span data-tip="Assigned operating jurisdiction"><StatusBadge tone="info">{marketCode}</StatusBadge></span><small>{contractor.worker_type?.replaceAll("_", " ")}</small></div></div><dl><div><dt>Current assignment</dt><dd>{contractor.currentAssignment?.replaceAll("_", " ") || "Unassigned"}</dd></div><div><dt>Compensation</dt><dd>{pay(contractor)}</dd></div></dl><label className="dispatch-readiness-toggle" data-tip="Switch contractor between active roster and operable dispatch queue."><span><strong>Dispatch ready</strong><small>{contractor.dispatchReady ? "Eligible for assignment" : "Held from dispatch"}</small></span><input type="checkbox" aria-label={`Dispatch readiness for ${contractor.display_name}`} checked={contractor.dispatchReady} disabled={busyId === contractor.id} onChange={(event) => onReadiness(contractor, event.target.checked)} /></label></article>)}{!contractors.length ? <div className="admin-empty-state">No active or held contractors in this territory.</div> : null}</div>
  </section>;
}
