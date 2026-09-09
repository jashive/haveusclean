import React from "react";
import { StatusBadge } from "../../components/ui.jsx";

function rows(value) { return Array.isArray(value) ? value : []; }

export default function ApplicantReviewModal({ applicant, inspector, busy, onClose, onAdvance }) {
  if (!applicant) return null;
  const canActivate = Boolean(applicant.engagement_id) && (inspector?.readiness?.status === "ready" || applicant.canonicalStage === "ServiceOS Ready");
  const documents = rows(inspector?.documents);
  return <div className="team-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="team-review-modal" role="dialog" aria-modal="true" aria-labelledby="applicant-review-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="admin-eyebrow">Applicant review · {applicant.marketCode}</p><h3 id="applicant-review-title">{applicant.name}</h3><p>{applicant.nextAction}</p></div><button className="huc-button huc-button--secondary" onClick={onClose}>Close</button></header>
      <div className="team-review-summary"><div><span>Hiring stage</span><strong>{applicant.stage}</strong></div><div><span>Canonical state</span><StatusBadge tone="info">{applicant.canonicalStage}</StatusBadge></div><div><span>Documents</span><strong>{documents.length ? `${documents.length} submitted` : "None submitted"}</strong></div></div>
      {inspector ? <div className="team-review-details"><p><strong>Role</strong><span>{inspector.applied_role_code || inspector.engagement_type || "Field technician"}</span></p><p><strong>Readiness</strong><span>{inspector.readiness?.status || inspector.training_readiness?.activation_note || "Governed review required"}</span></p>{documents.map((document) => <p key={document.document_capture_id || document.evidence_id}><strong>{document.document_code || document.requirement_code}</strong><StatusBadge tone={document.status === "verified" ? "success" : "warning"}>{document.status || document.capture_status}</StatusBadge></p>)}</div> : <div className="team-review-loading" role="status">Loading governed review…</div>}
      <footer><p>{canActivate ? "All governed controls are ready. Activation creates the operable ServiceOS worker." : "Earlier stages advance only after their governed screening, evidence, and training controls are satisfied."}</p><button className="huc-button" disabled={!canActivate || busy} onClick={onAdvance}>{busy ? "Activating…" : canActivate ? "Advance to Operable / Hired" : applicant.nextAction}</button></footer>
    </section>
  </div>;
}
