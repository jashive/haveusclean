import React from "react";
import { StatusBadge } from "../../components/ui.jsx";

function rows(value) { return Array.isArray(value) ? value : []; }

export default function ApplicantReviewModal({ applicant, inspector, busy, onClose, onAdvance }) {
  if (!applicant) return null;
  const canActivate = Boolean(applicant.engagement_id) && (inspector?.readiness?.status === "ready" || applicant.canonicalStage === "ServiceOS Ready");
  const documents = rows(inspector?.documents);
  const email = inspector?.email || inspector?.email_normalized || applicant.email || applicant.email_normalized;
  const phone = inspector?.phone || inspector?.phone_e164 || applicant.phone || applicant.phone_e164;
  const notes = inspector?.screening_notes || inspector?.activation_note || inspector?.applicant_statement || applicant.nextAction;
  return <div className="team-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="team-review-modal" role="dialog" aria-modal="true" aria-labelledby="applicant-review-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="admin-eyebrow">Applicant review · {applicant.marketCode}</p><h3 id="applicant-review-title">{applicant.name}</h3><p>{applicant.nextAction}</p></div><button className="huc-button huc-button--secondary" onClick={onClose}>Close</button></header>
      <div className="team-review-summary"><div><span>Hiring stage</span><strong>{applicant.stage}</strong></div><div><span>Canonical state</span><StatusBadge tone="info">{applicant.canonicalStage}</StatusBadge></div><div><span>Documents</span><strong>{documents.length ? `${documents.length} submitted` : "None submitted"}</strong></div></div>
      <nav className="applicant-contact-links" aria-label="Applicant contact links">{email ? <a href={`mailto:${email}`}>Email applicant</a> : <span>Email unavailable</span>}{phone ? <a href={`tel:${phone}`}>Call applicant</a> : <span>Phone unavailable</span>}</nav>
      <section className="applicant-screening-notes"><strong>Screening notes</strong><p>{notes || "No screening notes recorded."}</p></section>
      {inspector ? <div className="team-review-details"><p><strong>Role</strong><span>{inspector.applied_role_code || inspector.engagement_type || "Field technician"}</span></p><p><strong>Readiness</strong><span>{inspector.readiness?.status || inspector.training_readiness?.activation_note || "Governed review required"}</span></p>{documents.map((document) => <p key={document.document_capture_id || document.evidence_id}><strong>{document.document_code || document.requirement_code}</strong><StatusBadge tone={document.status === "verified" ? "success" : "warning"}>{document.status || document.capture_status}</StatusBadge></p>)}</div> : <div className="team-review-loading" role="status">Loading governed review…</div>}
      <footer><p>{canActivate ? "All governed controls are ready. Activation creates the operable ServiceOS worker." : "Stage advancement unlocks only after its governed screening, evidence, and training controls are satisfied."}</p><div className="applicant-review-actions"><button className="huc-button huc-button--secondary" data-tip="Promote applicant to next onboarding milestone" disabled={!canActivate || busy} onClick={onAdvance}>Advance stage</button><button className="huc-button" data-tip="Create the dispatch-ready worker only after every governed readiness check passes." disabled={!canActivate || busy} onClick={onAdvance}>{busy ? "Activating…" : "Mark Operable"}</button></div></footer>
    </section>
  </div>;
}
