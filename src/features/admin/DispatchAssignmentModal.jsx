import React, { lazy, Suspense, useEffect, useState } from "react";
import { fetchActiveWorkers, updateScheduledDispatchAssignment } from "../../lib/serviceosPipelineDispatch.js";

const ServiceOSOperationsWorkspace = lazy(() => import("../wave3/ServiceOSOperationsWorkspace"));

export default function DispatchAssignmentModal({ job, session, revenueContext, onClose }) {
  const [workers, setWorkers] = useState([]); const [workerId, setWorkerId] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    if (!job) return undefined;
    const timer = window.setTimeout(() => window.dispatchEvent(new CustomEvent("serviceos:open-dispatch", { detail: { handoffId: job.handoffId, operationalJobId: job.id } })), 100);
    return () => window.clearTimeout(timer);
  }, [job]);
  useEffect(() => {
    if (!job?.scheduledStart) return;
    const local = (value) => value ? new Date(value).toISOString().slice(0, 16) : "";
    setStart(local(job.scheduledStart)); setEnd(local(job.scheduledEnd)); setWorkerId(job.workerId || "");
    fetchActiveWorkers().then((rows) => setWorkers((rows || []).filter((worker) => !worker.business_unit_id || worker.business_unit_id === job.businessUnitId))).catch((nextError) => setError(nextError?.message || "Operable contractors could not be loaded."));
  }, [job]);
  async function save(event) { event.preventDefault(); setBusy(true); setError(""); try { await updateScheduledDispatchAssignment({ job, workerId, scheduledStart: start, scheduledEnd: end, appUserId: revenueContext?.appUserId }); window.dispatchEvent(new CustomEvent("serviceos:workspace-invalidated", { detail: { businessUnitId: job.businessUnitId, reason: "dispatch_assignment_updated" } })); onClose(); } catch (nextError) { setError(nextError?.message || "Assignment could not be updated."); } finally { setBusy(false); } }
  if (!job) return null;
  return <div className="dispatch-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="dispatch-assignment-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-assignment-title" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="admin-eyebrow">Assignment · {job.customerName}</p><h2 id="dispatch-assignment-title">Schedule and assign an operable contractor</h2><p>{job.address}</p></div><button className="huc-button huc-button--secondary" onClick={onClose}>Close</button></header>{job.scheduledStart ? <form className="dispatch-assignment-form" onSubmit={save}>{error ? <div className="financial-alert" role="alert">{error}</div> : null}<label>Start<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label>End<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label><label>Operable contractor<select value={workerId} onChange={(event) => setWorkerId(event.target.value)} required><option value="">Select contractor</option>{workers.map((worker) => <option value={worker.id} key={worker.id}>{worker.display_name}</option>)}</select></label><button className="huc-button" disabled={busy}>{busy ? "Saving…" : "Save assignment"}</button></form> : <Suspense fallback={<div role="status">Loading governed assignment controls…</div>}><ServiceOSOperationsWorkspace session={session} revenueContext={revenueContext} /></Suspense>}</section></div>;
}
