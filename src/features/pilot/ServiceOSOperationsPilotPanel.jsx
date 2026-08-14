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
  fetchEligibleJobHandoffs,
  fetchActiveWorkers,
  fetchConversionRecordById,
  fetchServiceLocationById,
  isWorkerScopeCompatibleWithHandoff,
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
  verifyPilotSessionState,
  getOperationsCreatedRecords,
  attachOperationsCreatedRecords,
  fetchLegacyWorkerCandidates,
  promoteWorkerToCanonical,
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
  select: {
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
  helper: { fontSize: "0.72rem", color: "#8899AA", marginBottom: "0.5rem" },
  btnSmall: {
    width: "100%",
    padding: "0.45rem 0.5rem",
    borderRadius: 4,
    border: "1px solid #2d3f5a",
    cursor: "pointer",
    fontSize: "0.78rem",
    fontWeight: 600,
    background: "#0f1927",
    color: "#7dd3fc",
    marginBottom: "0.5rem",
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

    if (!workerId) {
      throw attachOperationsCreatedRecords(
        new Error("worker_id is required for assignment step — provide a safe Preview worker ID"),
        created
      );
    }

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
  const [eligibleHandoffs, setEligibleHandoffs] = useState([]);
  const [selectedEligibleHandoffId, setSelectedEligibleHandoffId] = useState("");
  const [activeWorkers, setActiveWorkers] = useState([]);
  const [selectedActiveWorkerId, setSelectedActiveWorkerId] = useState("");
  const [loadingHandoffs, setLoadingHandoffs] = useState(false);
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState("");
  const [workerNotice, setWorkerNotice] = useState("");
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [createdIds, setCreatedIds] = useState(null);
  const [error, setError] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [retainedEvidence, setRetainedEvidence] = useState(null);
  const [verifyJson, setVerifyJson] = useState("");
  const [verifyResults, setVerifyResults] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyJsonError, setVerifyJsonError] = useState(null);

  // ── Legacy workforce bootstrap state ────────────────────────────────────────
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [legacyCandidates, setLegacyCandidates] = useState([]);
  const [selectedCandidateSourceId, setSelectedCandidateSourceId] = useState("");
  const [promotingWorker, setPromotingWorker] = useState(false);
  const [promotionResult, setPromotionResult] = useState(null);
  const [candidateNotice, setCandidateNotice] = useState("");

  const accessToken = session?.access_token ?? null;
  const appUserId = revenueContext?.appUserId ?? null;

  const canRun = !!(accessToken && jobHandoffId.trim() && workerId.trim());

  const selectedHandoff = eligibleHandoffs.find((h) => h?.id === selectedEligibleHandoffId) ?? null;

  const handleLoadEligibleHandoffs = useCallback(async () => {
    if (!accessToken || loadingHandoffs || running) return;
    setLoadingHandoffs(true);
    setError(null);
    setHandoffNotice("");
    setWorkerNotice("");
    try {
      const rows = await fetchEligibleJobHandoffs(accessToken);
      setEligibleHandoffs(rows);
      setActiveWorkers([]);
      setSelectedActiveWorkerId("");
      setWorkerId("");
      if (rows.length === 0) {
        setSelectedEligibleHandoffId("");
        setHandoffNotice("No unused ready canonical job handoffs were found.");
        return;
      }
      const nextSelected = rows.find((h) => h?.id === selectedEligibleHandoffId)?.id ?? rows[0]?.id ?? "";
      setSelectedEligibleHandoffId(nextSelected);
      setJobHandoffId(nextSelected);
    } catch (err) {
      setHandoffNotice(err?.message ?? "Failed to load eligible job handoffs.");
    } finally {
      setLoadingHandoffs(false);
    }
  }, [accessToken, loadingHandoffs, running, selectedEligibleHandoffId]);

  const handleSelectEligibleHandoff = useCallback(
    (nextId) => {
      setSelectedEligibleHandoffId(nextId);
      setJobHandoffId(nextId);
      setActiveWorkers([]);
      setSelectedActiveWorkerId("");
      setWorkerId("");
      setWorkerNotice("");
    },
    []
  );

  const handleLoadActiveWorkers = useCallback(async () => {
    if (!accessToken || loadingWorkers || running) return;
    setLoadingWorkers(true);
    setError(null);
    setWorkerNotice("");
    try {
      let handoff = selectedHandoff;
      const typedHandoffId = jobHandoffId.trim();
      if (!handoff && typedHandoffId) {
        handoff = await fetchJobHandoffById(typedHandoffId, accessToken);
      }
      if (!handoff) {
        setActiveWorkers([]);
        setSelectedActiveWorkerId("");
        setWorkerId("");
        setWorkerNotice("Select an eligible canonical job handoff first.");
        return;
      }
      const workers = await fetchActiveWorkers(accessToken);
      const compatible = workers.filter((worker) =>
        isWorkerScopeCompatibleWithHandoff(worker, handoff)
      );
      setActiveWorkers(compatible);
      if (compatible.length === 0) {
        setSelectedActiveWorkerId("");
        setWorkerId("");
        setWorkerNotice("No active compatible canonical workers were found.");
        return;
      }
      const nextSelected =
        compatible.find((w) => w?.id === selectedActiveWorkerId)?.id ?? compatible[0]?.id ?? "";
      setSelectedActiveWorkerId(nextSelected);
      setWorkerId(nextSelected);
    } catch (err) {
      setWorkerNotice(err?.message ?? "Failed to load active workers.");
    } finally {
      setLoadingWorkers(false);
    }
  }, [
    accessToken,
    loadingWorkers,
    running,
    selectedHandoff,
    jobHandoffId,
    selectedActiveWorkerId,
  ]);

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
    setRetainedEvidence(null);
    try {
      const result = await cleanupOperationsPilotSession(createdIds, accessToken);
      if (result && typeof result === "object" && result.mode === "retained_test_evidence") {
        // Completed E2E — records are governed canonical test evidence, not deleted
        setRetainedEvidence(result);
        setLog((prev) => [
          ...prev,
          {
            msg: "Wave 3 test evidence retained under canonical append-only governance.",
            kind: "done",
          },
        ]);
        // Keep createdIds so the UI still shows the retained chain
      } else {
        setLog((prev) => [...prev, { msg: "Operations pilot records cleaned up", kind: "done" }]);
        setCreatedIds(null);
        setRetainedEvidence(null);
      }
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

  const handleVerify = useCallback(async () => {
    if (verifying || !accessToken) return;
    setVerifyJsonError(null);
    setVerifyResults(null);

    // Resolve the ID map: prefer current createdIds, fall back to manual JSON
    let idsToVerify;
    if (createdIds && Object.keys(createdIds).length > 0) {
      idsToVerify = Object.fromEntries(
        Object.entries(createdIds).map(([k, v]) => [k, v?.id ?? v])
      );
    } else {
      // Parse manually supplied JSON
      if (!verifyJson.trim()) {
        setVerifyJsonError("No pilot IDs available — paste verification JSON or run the pilot first.");
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(verifyJson.trim());
      } catch {
        setVerifyJsonError("Malformed JSON — fix the input before verifying. No network requests were made.");
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setVerifyJsonError("JSON must be a flat object of label → UUID. No network requests were made.");
        return;
      }
      idsToVerify = parsed;
    }

    setVerifying(true);
    try {
      const results = await verifyPilotSessionState(idsToVerify, accessToken);
      setVerifyResults(results);
    } catch (err) {
      setVerifyJsonError(err?.message ?? "Verification failed");
    } finally {
      setVerifying(false);
    }
  }, [verifying, accessToken, createdIds, verifyJson]);

  // ── Legacy workforce bootstrap handlers ─────────────────────────────────────

  const handleLoadLegacyCandidates = useCallback(async () => {
    if (!accessToken || loadingCandidates || running) return;
    setLoadingCandidates(true);
    setCandidateNotice("");
    setPromotionResult(null);
    try {
      const candidates = await fetchLegacyWorkerCandidates(accessToken);
      setLegacyCandidates(candidates);
      if (candidates.length === 0) {
        setSelectedCandidateSourceId("");
        setCandidateNotice("No legacy worker candidates found (or all already promoted).");
        return;
      }
      const nextId =
        candidates.find((c) => c?.source_id === selectedCandidateSourceId)?.source_id ??
        candidates[0]?.source_id ??
        "";
      setSelectedCandidateSourceId(nextId);
    } catch (err) {
      setCandidateNotice(err?.message ?? "Failed to load legacy candidates.");
    } finally {
      setLoadingCandidates(false);
    }
  }, [accessToken, loadingCandidates, running, selectedCandidateSourceId]);

  const handlePromoteWorker = useCallback(async () => {
    if (promotingWorker || running || !accessToken) return;
    const candidate = legacyCandidates.find((c) => c?.source_id === selectedCandidateSourceId);
    if (!candidate) return;

    // Resolve canonical handoff for org/BU scope
    let handoff = selectedHandoff;
    const typedHandoffId = jobHandoffId.trim();
    if (!handoff && typedHandoffId) {
      handoff = await fetchJobHandoffById(typedHandoffId, accessToken);
    }
    if (!handoff) {
      setCandidateNotice("Select or enter a canonical job_handoff to provide organization/BU scope.");
      return;
    }

    setPromotingWorker(true);
    setCandidateNotice("");
    setPromotionResult(null);
    try {
      const result = await promoteWorkerToCanonical(candidate, handoff, accessToken, appUserId);
      setPromotionResult(result);
      // Auto-place canonical worker UUID into worker_id field
      setWorkerId(result.worker.id);
      setSelectedActiveWorkerId(result.worker.id);
      // Refresh active workers list
      const refreshed = await fetchActiveWorkers(accessToken);
      const compatible = refreshed.filter((w) =>
        isWorkerScopeCompatibleWithHandoff(w, handoff)
      );
      setActiveWorkers(compatible);
      // Remove the promoted candidate from the candidates list
      setLegacyCandidates((prev) => prev.filter((c) => c.source_id !== candidate.source_id));
      setSelectedCandidateSourceId("");
    } catch (err) {
      setCandidateNotice(err?.message ?? "Worker promotion failed.");
    } finally {
      setPromotingWorker(false);
    }
  }, [
    promotingWorker,
    running,
    accessToken,
    legacyCandidates,
    selectedCandidateSourceId,
    selectedHandoff,
    jobHandoffId,
    appUserId,
  ]);

  const formatCandidateOptionLabel = (c) => {
    const parts = [
      `id:${c.source_id}`,
      c.name ?? "no name",
      c.email ? `email:${c.email}` : null,
      c.partner_type ? `type:${c.partner_type}` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  };

  const formatHandoffOptionLabel = (handoff) => {
    const marker = handoff?.metadata?.marker || handoff?.metadata?.source || "n/a";
    const date = handoff?.handed_off_at ?? handoff?.created_at ?? "n/a";
    return `${handoff?.id} · BU ${handoff?.business_unit_id ?? "n/a"} · ${handoff?.handoff_status ?? "n/a"} · ${date} · ${marker}`;
  };

  const formatWorkerOptionLabel = (worker) => {
    const scope = worker?.business_unit_id ? `BU ${worker.business_unit_id}` : "enterprise";
    return `${worker?.display_name ?? "Unnamed"} · ${worker?.worker_type ?? "n/a"} · ${worker?.id} · ${scope}`;
  };

  if (!OPERATIONS_PILOT_UI_ENABLED) return null;

  return (
    <div style={styles.panel}>
      <h3 style={styles.heading}>
        Wave 3 Operations Pilot <span style={styles.badge}>W3-PILOT</span>
      </h3>

      <button
        style={{ ...styles.btnSmall, ...(loadingHandoffs || running || !accessToken ? styles.btnDisabled : {}) }}
        onClick={handleLoadEligibleHandoffs}
        disabled={loadingHandoffs || running || !accessToken}
      >
        {loadingHandoffs ? "Loading Eligible Handoffs…" : "Load Eligible Handoffs"}
      </button>
      <label style={styles.label}>eligible canonical job_handoff</label>
      <select
        style={styles.select}
        value={selectedEligibleHandoffId}
        onChange={(e) => handleSelectEligibleHandoff(e.target.value)}
        disabled={running || loadingHandoffs || eligibleHandoffs.length === 0}
      >
        <option value="">
          {eligibleHandoffs.length > 0
            ? "Select an eligible handoff"
            : "No eligible handoffs loaded"}
        </option>
        {eligibleHandoffs.map((handoff) => (
          <option key={handoff.id} value={handoff.id}>
            {formatHandoffOptionLabel(handoff)}
          </option>
        ))}
      </select>
      {handoffNotice && <div style={styles.helper}>{handoffNotice}</div>}

      <label style={styles.label}>job_handoff_id (required, manual fallback)</label>
      <input
        style={styles.input}
        value={jobHandoffId}
        onChange={(e) => {
          setJobHandoffId(e.target.value);
          setSelectedEligibleHandoffId("");
        }}
        placeholder="Paste existing job_handoff UUID"
        disabled={running}
      />

      <button
        style={{ ...styles.btnSmall, ...(loadingWorkers || running || !accessToken ? styles.btnDisabled : {}) }}
        onClick={handleLoadActiveWorkers}
        disabled={loadingWorkers || running || !accessToken}
      >
        {loadingWorkers ? "Loading Active Workers…" : "Load Active Workers"}
      </button>
      <label style={styles.label}>active canonical worker (scope-compatible)</label>
      <select
        style={styles.select}
        value={selectedActiveWorkerId}
        onChange={(e) => {
          setSelectedActiveWorkerId(e.target.value);
          setWorkerId(e.target.value);
        }}
        disabled={running || loadingWorkers || activeWorkers.length === 0}
      >
        <option value="">
          {activeWorkers.length > 0
            ? "Select an active compatible worker"
            : "No active workers loaded"}
        </option>
        {activeWorkers.map((worker) => (
          <option key={worker.id} value={worker.id}>
            {formatWorkerOptionLabel(worker)}
          </option>
        ))}
      </select>
      {workerNotice && <div style={styles.helper}>{workerNotice}</div>}

      <label style={styles.label}>worker_id (required for assignment step, manual fallback)</label>
      <input
        style={styles.input}
        value={workerId}
        onChange={(e) => {
          setWorkerId(e.target.value);
          setSelectedActiveWorkerId("");
        }}
        placeholder="Preview worker UUID"
        disabled={running}
      />

      {/* ── Legacy Workforce Bootstrap ────────────────────────────────────── */}
      <hr style={styles.divider} />
      <div style={{ ...styles.step, color: "#7dd3fc", fontWeight: 600, marginBottom: "0.4rem" }}>
        Legacy Workforce Bootstrap <span style={{ ...styles.badge, background: "#065f46" }}>PREVIEW ONLY</span>
      </div>

      <button
        style={{ ...styles.btnSmall, ...(loadingCandidates || running || !accessToken ? styles.btnDisabled : {}) }}
        onClick={handleLoadLegacyCandidates}
        disabled={loadingCandidates || running || !accessToken}
      >
        {loadingCandidates ? "Loading Legacy Worker Candidates…" : "Load Legacy Worker Candidates"}
      </button>
      <label style={styles.label}>legacy huc_partners candidate (read-only source)</label>
      <select
        style={styles.select}
        value={selectedCandidateSourceId}
        onChange={(e) => {
          setSelectedCandidateSourceId(e.target.value);
          setPromotionResult(null);
          setCandidateNotice("");
        }}
        disabled={running || loadingCandidates || legacyCandidates.length === 0}
      >
        <option value="">
          {legacyCandidates.length > 0
            ? "Select a legacy candidate"
            : "No legacy candidates loaded"}
        </option>
        {legacyCandidates.map((c) => (
          <option key={c.source_id} value={c.source_id}>
            {formatCandidateOptionLabel(c)}
          </option>
        ))}
      </select>
      {candidateNotice && <div style={styles.helper}>{candidateNotice}</div>}

      {promotionResult && (
        <div style={{ ...styles.stepDone, margin: "0.3rem 0" }}>
          ✓ Canonical worker {promotionResult.wasExisting ? "already existed" : "created"}:{" "}
          <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
            {promotionResult.worker?.id}
          </span>
        </div>
      )}

      <button
        style={{
          ...styles.btnSmall,
          background: "#064e3b",
          color: "#6ee7b7",
          border: "1px solid #065f46",
          ...(promotingWorker || running || !accessToken || !selectedCandidateSourceId || (!selectedHandoff && !jobHandoffId.trim())
            ? styles.btnDisabled
            : {}),
        }}
        onClick={handlePromoteWorker}
        disabled={
          promotingWorker ||
          running ||
          !accessToken ||
          !selectedCandidateSourceId ||
          (!selectedHandoff && !jobHandoffId.trim())
        }
        title={
          !accessToken
            ? "Requires authenticated session"
            : !selectedCandidateSourceId
            ? "Select a legacy candidate first"
            : !selectedHandoff && !jobHandoffId.trim()
            ? "Select or enter a job_handoff for org/BU scope"
            : "Promote selected legacy record to canonical worker"
        }
      >
        {promotingWorker ? "Promoting…" : "Promote Selected Worker to Canonical"}
      </button>
      {/* ── End Legacy Workforce Bootstrap ───────────────────────────────── */}

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

      {retainedEvidence && (
        <div style={{ ...styles.stepDone, marginTop: "0.5rem", lineHeight: 1.6 }}>
          <strong>Wave 3 test evidence retained under canonical append-only governance.</strong>
          <div>
            <em>Immutable records (append-only, retained):</em>
            {retainedEvidence.immutableRecordsRetained.map((r, i) => (
              <div key={i} style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>
                {r.table}: {r.id}
              </div>
            ))}
          </div>
          {retainedEvidence.mutableRecordsRetained.length > 0 && (
            <div>
              <em>Mutable records (preserved with chain):</em>
              {retainedEvidence.mutableRecordsRetained.map((r, i) => (
                <div key={i} style={{ fontFamily: "monospace", fontSize: "0.72rem" }}>
                  {r.table}: {r.id}
                </div>
              ))}
            </div>
          )}
          {retainedEvidence.upstreamPreserved && (
            <div style={{ marginTop: "0.2rem" }}>✓ Upstream Wave 2 job_handoff authority preserved</div>
          )}
        </div>
      )}

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
              : !workerId.trim()
              ? "Enter a worker_id to start"
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

      {/* ── Preview-only: Read-only recovery verifier ───────────────────── */}
      {OPERATIONS_PILOT_UI_ENABLED && (
        <div style={{ borderTop: "1px solid #374151", marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: "#93c5fd" }}>
            Verify Current Pilot Records{" "}
            <span style={{ ...styles.badge, background: "#1e3a5f" }}>PREVIEW ONLY</span>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
            Reads exact pilot record IDs. No writes. No mutations.
          </div>

          {/* Manual recovery textarea — only shown when no createdIds in memory */}
          {(!createdIds || Object.keys(createdIds).length === 0) && (
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: "#d1d5db", display: "block", marginBottom: 2 }}>
                Pilot verification IDs (read-only verification only)
              </label>
              <textarea
                value={verifyJson}
                onChange={(e) => {
                  setVerifyJson(e.target.value);
                  setVerifyJsonError(null);
                }}
                placeholder={'{\n  "checklistResult": "uuid-here",\n  ...\n}'}
                rows={5}
                style={{
                  width: "100%",
                  background: "#111827",
                  color: "#f9fafb",
                  border: "1px solid #374151",
                  borderRadius: 4,
                  padding: "4px 6px",
                  fontSize: 11,
                  fontFamily: "monospace",
                  boxSizing: "border-box",
                  resize: "vertical",
                }}
              />
            </div>
          )}

          {verifyJsonError && (
            <div style={{ color: "#FF4757", fontSize: 11, marginBottom: 6 }}>
              {verifyJsonError}
            </div>
          )}

          <button
            style={{
              ...styles.btn,
              background: "#1e40af",
              ...(!accessToken || verifying ? styles.btnDisabled : {}),
            }}
            onClick={handleVerify}
            disabled={!accessToken || verifying}
          >
            {verifying ? "Verifying…" : "Verify Current Pilot Records"}
          </button>

          {verifyResults && (
            <div style={{ marginTop: 8 }}>
              {(() => {
                const present = verifyResults.filter((r) => r.status === "present").length;
                const absent = verifyResults.filter((r) => r.status === "absent").length;
                const errCount = verifyResults.filter((r) => r.status === "error").length;
                const unsupported = verifyResults.filter((r) => r.status === "unsupported").length;
                return (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>
                    present: {present} · absent: {absent} · error: {errCount}
                    {unsupported > 0 ? ` · unsupported: ${unsupported}` : ""}
                  </div>
                );
              })()}
              {verifyResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    padding: "2px 0",
                    color:
                      r.status === "present"
                        ? "#34d399"
                        : r.status === "absent"
                        ? "#fbbf24"
                        : r.status === "unsupported"
                        ? "#9ca3af"
                        : "#FF4757",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{r.label}</span>
                  {r.table ? ` · ${r.table}` : ""}
                  {" · "}
                  <span style={{ fontFamily: "monospace" }}>{r.id}</span>
                  {" · "}
                  <span>{r.status}</span>
                  {r.error ? ` (${r.error})` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
