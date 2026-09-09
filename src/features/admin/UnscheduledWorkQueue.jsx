import React from "react";
import { StatusBadge } from "../../components/ui.jsx";
import DispatchJobBadge from "./DispatchJobBadge.jsx";

export default function UnscheduledWorkQueue({ jobs, onAssign }) {
  const unscheduled = jobs.filter((job) => !job.scheduledStart && !["closed", "cancelled"].includes(job.operationalStatus));
  return <section className="dispatch-panel unscheduled-work-queue" aria-labelledby="unscheduled-title">
    <header><div><p className="admin-eyebrow">Needs attention</p><h3 id="unscheduled-title">Unscheduled work</h3></div><StatusBadge tone={unscheduled.length ? "warning" : "success"}>{unscheduled.length} waiting</StatusBadge></header>
    <div className="unscheduled-work-queue__list">{unscheduled.length ? unscheduled.map((job) => <article key={job.id} data-tip="Click or drag to assign an operable contractor and schedule a slot."><div className="dispatch-job-heading"><strong>{job.customerName}</strong><DispatchJobBadge job={job} /></div><p>{job.address}</p>{job.isCommercial ? <small>{job.squareFeet ? `${job.squareFeet.toLocaleString()} sq ft` : "Walkthrough scope"} · {job.facilityContact || "Facility contact pending"}</small> : <small>{job.serviceFamily.replaceAll("_", " ")} · received {new Date(job.createdAt).toLocaleDateString()}</small>}<button className="huc-button" onClick={() => onAssign(job)}>Assign & schedule</button></article>) : <p className="dispatch-empty-state">Every accepted job in this territory has a governed schedule.</p>}</div>
  </section>;
}
