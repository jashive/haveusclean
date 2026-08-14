import React, { useState, useCallback, useRef } from "react";
import {
  buildOperationalJobPayload,
  buildScheduleWindowPayload,
  buildWorkerAssignmentPayload,
  buildWorkOrderPayload,
  buildWorkOrderEventPayload,
  buildCompletionEvidencePayload,
  buildChecklistResultPayload,
  buildQaInspectionPayload,
  buildOperationalHandoffPayload,
} from "../../lib/serviceosOperationsUtils.js";
import {
  fetchJobHandoffById,
  fetchConversionRecordById,
  fetchServiceLocationById,
  createOperationalJob,
  createScheduleWindow,
  createWorkerAssignment,
  createWorkOrder,
  createWorkOrderEvent,
  createCompletionEvidence,
  createChecklistResult,
  createQaInspection,
  createOperationalHandoff,
  updateOperationalJobStatus,
  updateScheduleWindowStatus,
  updateWorkerAssignmentStatus,
  updateWorkOrderStatus,
  updateQaInspectionStatus,
  cleanupOperationsPilotSession,
  getOperationsCreatedRecords,
  attachOperationsCreatedRecords,
} from "../../lib/serviceosOperationsClient.js";

// ── Feature flags ─────────────────────────────────────────────────────────────

const OPERATIONS_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_OPERATIONS_ENABLED === "true";

const OPERATIONS_PILOT_UI_ENABLED =
  OPERATIONS_ENABLED &&
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_OPERATIONS_PILOT_UI === "true";

// ── Inline styles (follows ServiceOSPilotPanel.jsx pattern) ───────────────────

const styles = {
  panel: {
    position: "fixed",
    bottom: 16,
    right: 390,
    width: 380,
    background: "#1A2235",
    border: "1px solid #2d3f5a",
    borderRadius: 8,
    padding: "1.25rem",
    fontFamily: "system-ui, sans-serif",
    color: "#f0f6ff",
    zIndex: 9997,
    boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    maxHeight: "90vh",
    overflowY: "auto",
  },
  heading: {
    margin: "0 0 0.75rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#7dd3fc",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  badge: {
    background: "#7c3aed",
    color: "#fff",
    fontSize: "0.65rem",
    padding: "1px 5px",
    borderRadius: 4,
    fontWeight: 700,
  },
  step: { fontSize: "0.8rem", color: "#8899AA", margin: "0.25rem 0" },
  stepDone: { fontSize: "0.8rem", color: "#00D4AA", margin: "0.25rem 0" },
  stepError: { fontSize: "0.8rem", color: "#FF4757", margin: "0.25rem 0" },
  actions: { display: "flex", gap: 8, marginTop: "1rem" },
  btn: {
    flex: 1,
    padding: "0.5rem",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    fontSize: "0.82rem",
    fontWeight: 500,
  },
  btnRun: { background: "#0369a1", color: "#fff" },
  btnClean: { background: "#4b1c1c", color: "#FF4757" },
  btnDisabled: { opacity: 0.45, cursor: "not-allowed" },
  divider: { borderColor: "#2d3f5a", margin: "0.75rem 0" },
  label: { fontSize: "0.78rem", color: "#8899AA", display: "block", marginBottom: 2 },
  input: {
    width: "100%",
    padding: "0.4rem 0.5rem",
    background: "#0f1927",
    border: "1px solid #2d3f5a",
    borderRadius: 4,
    color: "#f0f6ff",
    fontSize: "0.8rem",
    boxSizing: "border-box",
    marginBottom: "0.6rem",
  },
  debugToggle: {
    fontSize: "0.75rem",
    color: "#7dd3fc",
    cursor: "pointer",
    marginTop: "0.5rem",
    textDecoration: "underline",
  },
  debugBox: {
    background: "#0f1927",
    border: "1px solid #2d3f5a",
    borderRadius: 4,
    padding: "0.5rem",
    fontSize: "0.72rem",
    color: "#8899AA",
    marginTop: "0.4rem",
    maxHeight: 160,
    overflowY: "auto",
    wordBreak: "break-all",
  },
};

// ── Pilot runner ──────────────────────────────────────────────────────────────

async function runOperationsPilot({
  jobHandoffId,
  workerId,
  accessToken,
  appUserId,
  setLog,
}) {
  const log = (msg, kind = "step") =>
    setLog((prev) => [...prev, { msg, kind }]);

  const sessionId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `pilot-${Date.now()}`;

  const pilotMeta = {
    source: "operations_pilot_ui",
    synthetic: true,
    session_id: sessionId,
  };

  const created = {};

  try {
    // ── Step 1: Fetch existing job_handoff ──
    log("Fetching job_handoff…");
    const jobHandoff = await fetchJobHandoffById(jobHandoffId, accessToken);
    if (!jobHandoff) throw attachOperationsCreatedRecords(new Error("job_handoff not found"), created);
    log(`job_handoff fetched: ${jobHandoff.id}`, "done");

    // Resolve required IDs from canonical job_handoff
    const {
      organization_id: organizationId,
      business_unit_id: businessUnitId,
      conversion_record_id: conversionRecordId,
      quote_version_id: quoteVersionId,
      pricing_snapshot_id: pricingSnapshotId,
    } = jobHandoff;

    if (!organizationId || !businessUnitId || !conversionRecordId || !quoteVersionId || !pricingSnapshotId) {
      throw attachOperationsCreatedRecords(
        new Error("job_handoff is missing required upstream IDs"),
        created
      );
    }

    // ── Step 2: Resolve conversion_record ──
    log("Resolving conversion_record…");
    const convRecord = await fetchConversionRecordById(conversionRecordId, accessToken);
    if (!convRecord) throw attachOperationsCreatedRecords(new Error("conversion_record not found"), created);
    const { customer_id: customerId, contact_id: contactId, service_location_id: serviceLocationId } = convRecord;
    if (!customerId || !contactId || !serviceLocationId) {
      throw attachOperationsCreatedRecords(
        new Error("conversion_record missing customer_id / contact_id / service_location_id"),
        created
      );
    }
    log("conversion_record resolved", "done");

    // ── Step 3: Resolve service_location → jurisdiction_id ──
    log("Resolving service_location…");
    const serviceLocation = await fetchServiceLocationById(serviceLocationId, accessToken);
    if (!serviceLocation) throw attachOperationsCreatedRecords(new Error("service_location not found"), created);
    const jurisdictionId = serviceLocation.jurisdiction_id;
    if (!jurisdictionId) {
      throw attachOperationsCreatedRecords(
        new Error("service_location missing jurisdiction_id"),
        created
      );
    }
    log("Lineage resolved: org / bu / jurisdiction / customer / contact / location", "done");

    // ── Step 4: Create operational_job ready_to_schedule ──
    log("Creating operational_job (ready_to_schedule)…");
    const ojPayload = buildOperationalJobPayload({
      organizationId,
      businessUnitId,
      jurisdictionId,
      jobHandoffId,
      conversionRecordId,
      quoteVersionId,
      pricingSnapshotId,
      customerId,
      contactId,
      serviceLocationId,
      serviceFamily: "residential",
      operationalStatus: "ready_to_schedule",
      metadata: pilotMeta,
      appUserId,
    });
    const operationalJob = await createOperationalJob(ojPayload, accessToken);
    created.operationalJob = operationalJob;
    log(`operational_job created: ${operationalJob.id}`, "done");

    // ── Step 5: Create schedule_window planned ──
    log("Creating schedule_window (planned)…");
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const swPayload = buildScheduleWindowPayload({
      organizationId,
      businessUnitId,
      jurisdictionId,
      operationalJobId: operationalJob.id,
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      timezone: "America/Toronto",
      status: "planned",
      schedulingNotes: "[PILOT] synthetic window",
      metadata: pilotMeta,
      appUserId,
    });
    const scheduleWindow = await createScheduleWindow(swPayload, accessToken);
    created.scheduleWindow = scheduleWindow;
    log(`schedule_window created: ${scheduleWindow.id}`, "done");

    // ── Step 6: Transition schedule_window planned → confirmed ──
    log("Transitioning schedule_window → confirmed…");
    await updateScheduleWindowStatus(scheduleWindow.id, "confirmed", accessToken, appUserId);
    log("schedule_window confirmed", "done");

    // ── Step 7: Transition operational_job → scheduled ──
    log("Transitioning operational_job → scheduled…");
    await updateOperationalJobStatus(operationalJob.id, "scheduled", accessToken, appUserId);
    log("operational_job scheduled", "done");

    // ── Step 8/9: Create worker_assignment (requires workerId) ──
    if (!workerId) {
      throw attachOperationsCreatedRecords(
        new Error("worker_id is required for assignment step — provide a safe Preview worker ID"),
        created
      );
    }
    log("Creating worker_assignment (proposed)…");
    const waPayload = buildWorkerAssignmentPayload({
      organizationId,
      businessUnitId,
      operationalJobId: operationalJob.id,
      scheduleWindowId: scheduleWindow.id,
      workerId,
      assignmentRole: "service_worker",
      assignmentStatus: "proposed",
      metadata: pilotMeta,
      appUserId,
    });
    const workerAssignment = await createWorkerAssignment(waPayload, accessToken);
    created.workerAssignment = workerAssignment;
    log(`worker_assignment created: ${workerAssignment.id}`, "done");

    // ── Step 10: Transition assignment proposed → assigned → acknowledged ──
    log("Transitioning assignment → assigned…");
    await updateWorkerAssignmentStatus(workerAssignment.id, "assigned", accessToken, appUserId);
    log("Transitioning assignment → acknowledged…");
    await updateWorkerAssignmentStatus(workerAssignment.id, "acknowledged", accessToken, appUserId);
    log("worker_assignment acknowledged", "done");

    // ── Step 11: Create work_order draft ──
    log("Creating work_order (draft)…");
    const woPayload = buildWorkOrderPayload({
      organizationId,
      businessUnitId,
      jurisdictionId,
      operationalJobId: operationalJob.id,
      scheduleWindowId: scheduleWindow.id,
      workOrderStatus: "draft",
      metadata: pilotMeta,
      appUserId,
    });
    const workOrder = await createWorkOrder(woPayload, accessToken);
    created.workOrder = workOrder;
    log(`work_order created: ${workOrder.id}`, "done");

    // ── Step 12: work_order draft → published ──
    log("Transitioning work_order → published…");
    await updateWorkOrderStatus(workOrder.id, "published", accessToken, appUserId);
    log("work_order published", "done");

    // ── Step 13: operational_job → dispatched ──
    log("Transitioning operational_job → dispatched…");
    await updateOperationalJobStatus(operationalJob.id, "dispatched", accessToken, appUserId);

    // ── Step 14/15: work_order / operational_job → in_progress ──
    log("Transitioning work_order → in_progress…");
    await updateWorkOrderStatus(workOrder.id, "in_progress", accessToken, appUserId);
    log("Transitioning operational_job → in_progress…");
    await updateOperationalJobStatus(operationalJob.id, "in_progress", accessToken, appUserId);
    log("Both in_progress", "done");

    // ── Step 16: Append arrived + work_started events ──
    log("Appending arrived event…");
    const arrivedEvt = await createWorkOrderEvent(
      buildWorkOrderEventPayload({
        organizationId,
        businessUnitId,
        operationalJobId: operationalJob.id,
        workOrderId: workOrder.id,
        workerAssignmentId: workerAssignment.id,
        eventType: "arrived",
        actorAppUserId: appUserId,
        metadata: pilotMeta,
      }),
      accessToken
    );
    created.workOrderEventArrived = arrivedEvt;

    log("Appending work_started event…");
    const startedEvt = await createWorkOrderEvent(
      buildWorkOrderEventPayload({
        organizationId,
        businessUnitId,
        operationalJobId: operationalJob.id,
        workOrderId: workOrder.id,
        workerAssignmentId: workerAssignment.id,
        eventType: "work_started",
        actorAppUserId: appUserId,
        metadata: pilotMeta,
      }),
      accessToken
    );
    created.workOrderEventWorkStarted = startedEvt;
    log("Execution events appended", "done");

    // ── Step 18: Create evidence references ──
    log("Creating completion_evidence reference…");
    const evidence = await createCompletionEvidence(
      buildCompletionEvidencePayload({
        organizationId,
        businessUnitId,
        operationalJobId: operationalJob.id,
        workOrderId: workOrder.id,
        workerAssignmentId: workerAssignment.id,
        evidenceType: "note",
        evidencePayload: { note: "[PILOT] synthetic evidence reference", ...pilotMeta },
        capturedAt: new Date().toISOString(),
        capturedByAppUserId: appUserId,
        metadata: pilotMeta,
      }),
      accessToken
    );
    created.completionEvidence = evidence;
    log(`completion_evidence created: ${evidence.id}`, "done");

    // ── Step 19: Create checklist pass results ──
    log("Creating checklist pass result…");
    const checklistResult = await createChecklistResult(
      buildChecklistResultPayload({
        organizationId,
        businessUnitId,
        operationalJobId: operationalJob.id,
        workOrderId: workOrder.id,
        checklistItemKey: "pilot_item_01",
        checklistItemLabel: "[PILOT] Synthetic checklist item",
        resultStatus: "pass",
        completedByAppUserId: appUserId,
        completedAt: new Date().toISOString(),
        metadata: pilotMeta,
      }),
      accessToken
    );
    created.checklistResult = checklistResult;
    log(`checklist_result created: ${checklistResult.id}`, "done");

    // ── Step 20: Append work_completed event ──
    log("Appending work_completed event…");
    const completedEvt = await createWorkOrderEvent(
      buildWorkOrderEventPayload({
        organizationId,
        businessUnitId,
        operationalJobId: operationalJob.id,
        workOrderId: workOrder.id,
        workerAssignmentId: workerAssignment.id,
        eventType: "work_completed",
        actorAppUserId: appUserId,
        metadata: pilotMeta,
      }),
      accessToken
    );
    created.workOrderEventCompleted = completedEvt;

    // ── Step 21/22: work_order / operational_job → service_complete ──
    log("Transitioning work_order → service_complete…");
    await updateWorkOrderStatus(workOrder.id, "service_complete", accessToken, appUserId);
    log("Transitioning operational_job → service_complete…");
    await updateOperationalJobStatus(operationalJob.id, "service_complete", accessToken, appUserId);
    log("Service complete", "done");

    // ── Step 23: operational_job → qa_pending ──
    log("Transitioning operational_job → qa_pending…");
    await updateOperationalJobStatus(operationalJob.id, "qa_pending", accessToken, appUserId);

    // ── Step 24: Create qa_inspection ──
    log("Creating qa_inspection (pending)…");
    const qaInspection = await createQaInspection(
      buildQaInspectionPayload({
        organizationId,
        businessUnitId,
        operationalJobId: operationalJob.id,
        workOrderId: workOrder.id,
        inspectorAppUserId: appUserId,
        inspectionStatus: "pending",
        inspectionType: "standard",
        metadata: pilotMeta,
      }),
      accessToken
    );
    created.qaInspection = qaInspection;
    log(`qa_inspection created: ${qaInspection.id}`, "done");

    // ── Step 25/26: Transition QA: pending → in_progress → passed ──
    log("Transitioning QA → in_progress…");
    await updateQaInspectionStatus(qaInspection.id, "in_progress", accessToken, appUserId);
    log("Transitioning QA → passed…");
    await updateQaInspectionStatus(qaInspection.id, "passed", accessToken, appUserId, { score: 100 });
    log("QA passed", "done");

    // ── Step 26: operational_job → qa_passed ──
    log("Transitioning operational_job → qa_passed…");
    await updateOperationalJobStatus(operationalJob.id, "qa_passed", accessToken, appUserId);

    // ── Step 27: work_order → qa_complete → closed ──
    log("Transitioning work_order → qa_complete…");
    await updateWorkOrderStatus(workOrder.id, "qa_complete", accessToken, appUserId);
    log("Transitioning work_order → closed…");
    await updateWorkOrderStatus(workOrder.id, "closed", accessToken, appUserId);

    // ── Step 28: operational_job → closed ──
    log("Transitioning operational_job → closed…");
    await updateOperationalJobStatus(operationalJob.id, "closed", accessToken, appUserId);
    log("operational_job closed", "done");

    // ── Step 29: Create operational_handoff ready ──
    log("Creating operational_handoff (ready)…");
    const handoff = await createOperationalHandoff(
      buildOperationalHandoffPayload({
        organizationId,
        businessUnitId,
        operationalJobId: operationalJob.id,
        workOrderId: workOrder.id,
        qaInspectionId: qaInspection.id,
        pricingSnapshotId,
        quoteVersionId,
        handoffStatus: "ready",
        handoffPayload: pilotMeta,
        metadata: pilotMeta,
        appUserId,
      }),
      accessToken
    );
    created.operationalHandoff = handoff;
    log(`operational_handoff created: ${handoff.id}`, "done");
    log("Wave 3 pilot chain complete ✓", "done");

    return created;
  } catch (error) {
    throw attachOperationsCreatedRecords(error, created);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServiceOSOperationsPilotPanel({ session, revenueContext }) {
  const [jobHandoffId, setJobHandoffId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [createdIds, setCreatedIds] = useState(null);
  const [error, setError] = useState(null);
  const [showDebug, setShowDebug] = useState(false);

  const accessToken = session?.access_token ?? null;
  const appUserId = revenueContext?.appUserId ?? null;

  const canRun = !!(accessToken && jobHandoffId.trim());

  const handleRun = useCallback(async () => {
    if (running || !canRun) return;
    setRunning(true);
    setError(null);
    setLog([]);
    setCreatedIds(null);
    try {
      const created = await runOperationsPilot({
        jobHandoffId: jobHandoffId.trim(),
        workerId: workerId.trim() || null,
        accessToken,
        appUserId,
        setLog,
      });
      setCreatedIds(created);
    } catch (err) {
      const partial = getOperationsCreatedRecords(err);
      if (partial && Object.keys(partial).length > 0) setCreatedIds(partial);
      setError(err?.message ?? "Operations pilot failed");
      setLog((prev) => [
        ...prev,
        { msg: err?.message ?? "Operations pilot failed", kind: "error" },
      ]);
    } finally {
      setRunning(false);
    }
  }, [running, canRun, accessToken, appUserId, jobHandoffId, workerId]);

  const handleCleanup = useCallback(async () => {
    if (cleaning || !createdIds || !accessToken) return;
    setCleaning(true);
    setError(null);
    try {
      await cleanupOperationsPilotSession(createdIds, accessToken);
      setLog((prev) => [...prev, { msg: "Operations pilot records cleaned up", kind: "done" }]);
      setCreatedIds(null);
    } catch (err) {
      setError(err?.message ?? "Cleanup failed");
      setLog((prev) => [
        ...prev,
        { msg: err?.message ?? "Cleanup failed", kind: "error" },
      ]);
    } finally {
      setCleaning(false);
    }
  }, [cleaning, createdIds, accessToken]);

  if (!OPERATIONS_PILOT_UI_ENABLED) return null;

  return (
    <div style={styles.panel}>
      <h3 style={styles.heading}>
        Wave 3 Operations Pilot <span style={styles.badge}>W3-PILOT</span>
      </h3>

      <label style={styles.label}>job_handoff_id (required)</label>
      <input
        style={styles.input}
        value={jobHandoffId}
        onChange={(e) => setJobHandoffId(e.target.value)}
        placeholder="Paste existing job_handoff UUID"
        disabled={running}
      />

      <label style={styles.label}>worker_id (required for assignment step)</label>
      <input
        style={styles.input}
        value={workerId}
        onChange={(e) => setWorkerId(e.target.value)}
        placeholder="Preview worker UUID"
        disabled={running}
      />

      {log.length > 0 && (
        <>
          <hr style={styles.divider} />
          {log.map((entry, i) => {
            const s =
              entry.kind === "done"
                ? styles.stepDone
                : entry.kind === "error"
                ? styles.stepError
                : styles.step;
            const prefix =
              entry.kind === "done" ? "✓ " : entry.kind === "error" ? "✗ " : "· ";
            return (
              <div key={i} style={s}>
                {prefix}
                {entry.msg}
              </div>
            );
          })}
        </>
      )}

      {error && <div style={styles.stepError}>✗ {error}</div>}

      {createdIds && Object.keys(createdIds).length > 0 && (
        <>
          <span
            style={styles.debugToggle}
            onClick={() => setShowDebug((v) => !v)}
          >
            {showDebug ? "▲ Hide IDs" : "▼ Show created IDs"}
          </span>
          {showDebug && (
            <div style={styles.debugBox}>
              <pre style={{ margin: 0 }}>
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(createdIds).map(([k, v]) => [k, v?.id ?? v])
                  ),
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </>
      )}

      <div style={styles.actions}>
        <button
          style={{
            ...styles.btn,
            ...styles.btnRun,
            ...(!canRun || running ? styles.btnDisabled : {}),
          }}
          onClick={handleRun}
          disabled={!canRun || running}
          title={
            !accessToken
              ? "Requires authenticated session"
              : !jobHandoffId.trim()
              ? "Enter a job_handoff_id to start"
              : ""
          }
        >
          {running ? "Running…" : "Run Operations Pilot"}
        </button>
        <button
          style={{
            ...styles.btn,
            ...styles.btnClean,
            ...(!createdIds || cleaning ? styles.btnDisabled : {}),
          }}
          onClick={handleCleanup}
          disabled={!createdIds || cleaning}
        >
          {cleaning ? "Cleaning…" : "Clean Up"}
        </button>
      </div>

      {!OPERATIONS_ENABLED && (
        <div style={{ ...styles.step, marginTop: 6, color: "#FF4757" }}>
          VITE_SERVICEOS_OPERATIONS_ENABLED is not true — all calls will fail.
        </div>
      )}
    </div>
  );
}
