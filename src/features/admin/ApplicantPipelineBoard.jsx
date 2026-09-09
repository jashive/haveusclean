import React from "react";
import { StatusBadge } from "../../components/ui.jsx";
import { HIRING_STAGES } from "../../lib/serviceosTeamHiring.js";

function age(days) { return days == null ? "Age unavailable" : days === 0 ? "Applied today" : `${days}d in pipeline`; }
function documents(applicant) { return applicant.documentRequired == null ? "Documents · Review required" : `Documents ${applicant.documentCompleted}/${applicant.documentRequired}`; }

export default function ApplicantPipelineBoard({ applicants, onReview }) {
  return <section className="team-panel applicant-pipeline" aria-labelledby="applicant-pipeline-title">
    <header><div><p className="admin-eyebrow">Applicant pipeline</p><h3 id="applicant-pipeline-title">From application to dispatch-ready</h3></div><StatusBadge tone="info">{applicants.length} candidates</StatusBadge></header>
    <div className="applicant-pipeline__board">{HIRING_STAGES.map((stage) => {
      const items = applicants.filter((applicant) => applicant.stage === stage);
      return <section className="applicant-stage" key={stage} aria-label={`${stage} applicants`} data-tip="5-stage screening pipeline"><header><h4>{stage}</h4><span>{items.length}</span></header><div>{items.map((applicant) => <button className="applicant-card" type="button" key={applicant.id} onClick={() => onReview(applicant)}><strong>{applicant.name}</strong><span>{applicant.marketCode} · {age(applicant.ageDays)}</span><span className="applicant-card__documents">{documents(applicant)}</span><small>{applicant.nextAction}</small></button>)}{!items.length ? <p className="applicant-stage__empty">No candidates</p> : null}</div></section>;
    })}</div>
  </section>;
}
