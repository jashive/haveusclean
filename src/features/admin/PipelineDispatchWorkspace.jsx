import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/ui.jsx";
import { fetchPipelineDispatchJobs, fetchUnscheduledDispatchHandoffs } from "../../lib/serviceosPipelineDispatch.js";
import { SERVICEOS_WORKSPACE_INVALIDATED_EVENT, serviceOSInvalidationMatches } from "../../lib/serviceosFinancialPerformance.js";
import DispatchCalendar from "./DispatchCalendar.jsx";
import UnscheduledWorkQueue from "./UnscheduledWorkQueue.jsx";
import WorkOrderHistoryTable from "./WorkOrderHistoryTable.jsx";
import DispatchAssignmentModal from "./DispatchAssignmentModal.jsx";

export default function PipelineDispatchWorkspace({ session, revenueContext }) {
  const businessUnitId = revenueContext?.primaryBusinessUnitId;
  const [jobs, setJobs] = useState([]); const [unscheduled, setUnscheduled] = useState([]); const [weekStart, setWeekStart] = useState(new Date());
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [assignmentJob, setAssignmentJob] = useState(null);
  const load = useCallback(async () => { if (!businessUnitId) return; setLoading(true); setError(""); try { const [nextJobs, nextUnscheduled] = await Promise.all([fetchPipelineDispatchJobs({ businessUnitId }), fetchUnscheduledDispatchHandoffs(businessUnitId)]); setJobs(nextJobs); setUnscheduled(nextUnscheduled); } catch (nextError) { setError(nextError?.message || "Dispatch records could not be loaded."); } finally { setLoading(false); } }, [businessUnitId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const refresh = (event) => serviceOSInvalidationMatches(event, businessUnitId) && load(); window.addEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh); return () => window.removeEventListener(SERVICEOS_WORKSPACE_INVALIDATED_EVENT, refresh); }, [businessUnitId, load]);
  const scheduled = useMemo(() => jobs.filter((job) => job.scheduledStart && !["closed", "cancelled"].includes(job.operationalStatus)), [jobs]);
  const assign = (job) => setAssignmentJob(job);
  return <section className="pipeline-dispatch-workspace" aria-labelledby="pipeline-dispatch-title">
    <header className="workspace-heading"><div><p className="admin-eyebrow">Pipeline & Dispatch · {revenueContext?.activeBusinessUnitCode}</p><h2 id="pipeline-dispatch-title">Schedule the right team, at the right time</h2><p>Live territory scheduling and searchable work-order history from governed ServiceOS records.</p></div><div><StatusBadge tone={error ? "danger" : "success"}>{jobs.length} records</StatusBadge><button className="huc-button huc-button--secondary" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></header>
    {error ? <div className="financial-alert" role="alert">{error}</div> : null}
    <div className="pipeline-dispatch-grid" aria-busy={loading} data-tour="dispatch-schedule"><DispatchCalendar jobs={scheduled} weekStart={weekStart} onWeekChange={setWeekStart} onAssign={assign} /><UnscheduledWorkQueue jobs={unscheduled} onAssign={assign} /></div>
    <WorkOrderHistoryTable jobs={jobs} />
    <DispatchAssignmentModal job={assignmentJob} session={session} revenueContext={revenueContext} onClose={() => setAssignmentJob(null)} />
  </section>;
}
