// ── Wave 4: ServiceOS Wave 4 Preview Pilot Panel ─────────────────────────────
//
// Feature flags required:
//   VITE_SERVICEOS_OPERATIONS_ENABLED === "true"
//   VITE_SERVICEOS_WAVE4_PILOT_UI     === "true"
//
// This panel works ONLY with explicit canonical IDs entered by the user.
// It does NOT:
//   - invoke runOperationsPilot()
//   - construct a new Wave 3 chain
//   - invoke cleanupOperationsPilotSession()
//   - delete work_order_event or completion_evidence rows
//   - recreate old deleted Wave 3 checklist/QA records

import React, { useState, useCallback } from "react";

import {
  buildProviderNeutralEvidenceReference,
  attachProviderNeutralEvidence,
  materializeWave4Governance,
  assessWave4Readiness,
  runExceptionReworkFlow,
  createAndAdvanceCustomerOutcome,
  loadWave4QualitySignals,
} from "../../lib/serviceosWave4Runtime.js";

import {
  fetchWave4ApplicabilityForWorkOrder,
  fetchGovernanceLinkForWorkOrder,
  fetchEvidenceRequirementsForWorkOrder,
  fetchEvidenceForWorkOrder,
  fetchQaInspectionsForJob,
  fetchCorrectiveActionsForJob,
  fetchServiceExceptionsForJob,
  fetchCustomerOutcomesForJob,
  fetchRequiredEvidencePoliciesByConfigurationVersion,
  fetchOperationalJobById,
} from "../../lib/serviceosOperationsClient.js";

// ── Feature guards ─────────────────────────────────────────────────────────────

const OPERATIONS_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_OPERATIONS_ENABLED === "true";

const WAVE4_PILOT_ENABLED =
  OPERATIONS_ENABLED &&
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_WAVE4_PILOT_UI === "true";

// ── Inline styles (mirrors ServiceOSOperationsPilotPanel.jsx) ─────────────────

const styles = {
  panel: {
    position: "fixed",
    bottom: 16,
    right: 16,
    width: 390,
    background: "#1A2235",
    border: "1px solid #2d3f5a",
    borderRadius: 8,
    padding: "1.25rem",
    fontFamily: "system-ui, sans-serif",
    color: "#f0f6ff",
    zIndex: 9996,
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
  section: {
    borderTop: "1px solid #2d3f5a",
    paddingTop: "0.75rem",
    marginTop: "0.75rem",
  },
  sectionTitle: {
    fontSize: "0.82rem",
    fontWeight: 600,
    color: "#93c5fd",
    marginBottom: "0.5rem",
  },
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
  btn: {
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
  btnRun: { background: "#0369a1", color: "#fff", border: "none" },
  btnDisabled: { opacity: 0.45, cursor: "not-allowed" },
  ok: { fontSize: "0.78rem", color: "#00D4AA", margin: "0.2rem 0" },
  warn: { fontSize: "0.78rem", color: "#FF4757", margin: "0.2rem 0" },
  info: { fontSize: "0.78rem", color: "#8899AA", margin: "0.2rem 0" },
  pre: {
    fontSize: "0.7rem",
    background: "#0f1927",
    color: "#a3e4d7",
    padding: "0.5rem",
    borderRadius: 4,
    overflowX: "auto",
    maxHeight: 160,
    marginTop: "0.4rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};

// ── Small helpers ──────────────────────────────────────────────────────────────

function StatusLine({ ok, label }) {
  return (
    <div style={ok ? styles.ok : styles.warn}>
      {ok ? "✓" : "✗"} {label}
    </div>
  );
}

function SectionBox({ title, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <>
      <label style={styles.label}>{label}</label>
      <input
        style={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ""}
      />
    </>
  );
}

// ── Main panel component ───────────────────────────────────────────────────────

export default function ServiceOSWave4PilotPanel({ session }) {
  if (!WAVE4_PILOT_ENABLED) return null;

  const accessToken = session?.access_token ?? null;
  const appUserId = session?.user?.id ?? null;

  // ── Shared IDs (required for all sections) ────────────────────────────────
  const [jobId, setJobId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");

  // ── Section A: Refresh/Readiness ──────────────────────────────────────────
  const [loadingRefresh, setLoadingRefresh] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);
  const [refreshError, setRefreshError] = useState(null);

  const handleRefresh = useCallback(async () => {
    setRefreshError(null);
    setRefreshResult(null);
    setLoadingRefresh(true);
    try {
      const [
        applicability,
        governanceLink,
        requirements,
        evidence,
        qaInspections,
        correctiveActions,
        exceptions,
        outcomes,
        qualitySignals,
      ] = await Promise.all([
        fetchWave4ApplicabilityForWorkOrder(workOrderId, accessToken).catch(() => null),
        fetchGovernanceLinkForWorkOrder(workOrderId, accessToken).catch(() => null),
        fetchEvidenceRequirementsForWorkOrder(workOrderId, accessToken).catch(() => []),
        fetchEvidenceForWorkOrder(workOrderId, accessToken).catch(() => []),
        fetchQaInspectionsForJob(jobId, accessToken).catch(() => []),
        fetchCorrectiveActionsForJob(jobId, accessToken).catch(() => []),
        fetchServiceExceptionsForJob(jobId, accessToken).catch(() => []),
        fetchCustomerOutcomesForJob(jobId, accessToken).catch(() => []),
        loadWave4QualitySignals({ operationalJobId: jobId, workOrderId, accessToken }).catch(
          () => null
        ),
      ]);

      const readiness = assessWave4Readiness({
        applicability,
        governanceLink,
        requirements,
        evidence,
        qaInspections,
        correctiveActions,
      });

      setRefreshResult({
        applicability,
        governanceLink,
        requirements,
        evidence,
        qaInspections,
        correctiveActions,
        exceptions,
        outcomes,
        readiness,
        qualitySignals,
      });
    } catch (err) {
      setRefreshError(err.message);
    } finally {
      setLoadingRefresh(false);
    }
  }, [jobId, workOrderId, accessToken]);

  // ── Section B: Materialize Governance ────────────────────────────────────
  const [configVersionId, setConfigVersionId] = useState("");
  const [checklistVersionRef, setChecklistVersionRef] = useState("");
  const [taskDefinitionRef, setTaskDefinitionRef] = useState("");
  const [loadingGov, setLoadingGov] = useState(false);
  const [govResult, setGovResult] = useState(null);
  const [govError, setGovError] = useState(null);

  const handleMaterializeGovernance = useCallback(async () => {
    setGovError(null);
    setGovResult(null);
    setLoadingGov(true);
    try {
      // Resolve org/bu/jurisdiction from operational_job
      const job = await fetchOperationalJobById(jobId, accessToken);
      if (!job) throw new Error("operational_job not found for id: " + jobId);

      // Load required_evidence_policy rows for this configuration version
      const policyRows = await fetchRequiredEvidencePoliciesByConfigurationVersion(
        configVersionId,
        accessToken
      );
      if (!Array.isArray(policyRows) || policyRows.length === 0) {
        throw new Error(
          `No required_evidence_policy rows found for configurationVersionId="${configVersionId}"`
        );
      }

      const result = await materializeWave4Governance({
        organizationId: job.organization_id,
        businessUnitId: job.business_unit_id,
        jurisdictionId: job.jurisdiction_id,
        operationalJobId: jobId,
        workOrderId,
        configurationVersionId: configVersionId,
        checklistVersionReference: checklistVersionRef || null,
        taskDefinitionReference: taskDefinitionRef || null,
        sopReferenceSnapshot: [],
        governanceSnapshot: {},
        sourcePolicyRows: policyRows,
        accessToken,
        appUserId,
      });
      setGovResult(result);
    } catch (err) {
      setGovError(err.message);
    } finally {
      setLoadingGov(false);
    }
  }, [jobId, workOrderId, configVersionId, checklistVersionRef, taskDefinitionRef, accessToken, appUserId]);

  // ── Section C: Attach Provider-Neutral Evidence ──────────────────────────
  const [evidenceProvider, setEvidenceProvider] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [evidenceReqKey, setEvidenceReqKey] = useState("");
  const [workerAssignmentId, setWorkerAssignmentId] = useState("");
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceResult, setEvidenceResult] = useState(null);
  const [evidenceError, setEvidenceError] = useState(null);

  const handleAttachEvidence = useCallback(async () => {
    setEvidenceError(null);
    setEvidenceResult(null);
    setLoadingEvidence(true);
    try {
      // Resolve org/bu from job
      const job = await fetchOperationalJobById(jobId, accessToken);
      if (!job) throw new Error("operational_job not found for id: " + jobId);

      // Resolve evidence requirement from requirement_key
      const allReqs = await fetchEvidenceRequirementsForWorkOrder(workOrderId, accessToken);
      const req = Array.isArray(allReqs)
        ? allReqs.find((r) => r.requirement_key === evidenceReqKey)
        : null;
      if (!req) {
        throw new Error(`No evidence requirement found with requirement_key="${evidenceReqKey}"`);
      }

      const ref = buildProviderNeutralEvidenceReference({
        provider: evidenceProvider,
        reference: evidenceReference,
        metadata: {},
      });

      const created = await attachProviderNeutralEvidence(
        {
          organizationId: job.organization_id,
          businessUnitId: job.business_unit_id,
          operationalJobId: jobId,
          workOrderId,
        },
        req,
        ref,
        {
          workerAssignmentId: workerAssignmentId || null,
          accessToken,
          appUserId,
        }
      );
      setEvidenceResult(created);
    } catch (err) {
      setEvidenceError(err.message);
    } finally {
      setLoadingEvidence(false);
    }
  }, [jobId, workOrderId, evidenceProvider, evidenceReference, evidenceReqKey, workerAssignmentId, accessToken, appUserId]);

  // ── Section D: Exception / Rework Proof ──────────────────────────────────
  const [failedQaId, setFailedQaId] = useState("");
  const [exceptionDesc, setExceptionDesc] = useState("");
  const [correctiveDesc, setCorrectiveDesc] = useState("");
  const [loadingRework, setLoadingRework] = useState(false);
  const [reworkResult, setReworkResult] = useState(null);
  const [reworkError, setReworkError] = useState(null);

  const handleRunRework = useCallback(async () => {
    setReworkError(null);
    setReworkResult(null);
    setLoadingRework(true);
    try {
      const job = await fetchOperationalJobById(jobId, accessToken);
      if (!job) throw new Error("operational_job not found for id: " + jobId);

      const result = await runExceptionReworkFlow({
        organizationId: job.organization_id,
        businessUnitId: job.business_unit_id,
        operationalJobId: jobId,
        workOrderId,
        failedQaInspectionId: failedQaId,
        exceptionDescription: exceptionDesc,
        correctiveDescription: correctiveDesc,
        accessToken,
        appUserId,
      });
      setReworkResult(result);
    } catch (err) {
      setReworkError(err.message);
    } finally {
      setLoadingRework(false);
    }
  }, [jobId, workOrderId, failedQaId, exceptionDesc, correctiveDesc, accessToken, appUserId]);

  // ── Section E: Customer Outcome ───────────────────────────────────────────
  const [outcomeType, setOutcomeType] = useState("service_issue");
  const [outcomeDesc, setOutcomeDesc] = useState("");
  const [loadingOutcome, setLoadingOutcome] = useState(false);
  const [outcomeResult, setOutcomeResult] = useState(null);
  const [outcomeError, setOutcomeError] = useState(null);

  const OUTCOME_TYPES = [
    "complaint",
    "praise",
    "service_issue",
    "reclean_request",
    "damage_concern",
    "resolution",
    "other",
  ];

  const handleCreateOutcome = useCallback(async () => {
    setOutcomeError(null);
    setOutcomeResult(null);
    setLoadingOutcome(true);
    try {
      const job = await fetchOperationalJobById(jobId, accessToken);
      if (!job) throw new Error("operational_job not found for id: " + jobId);

      // Resolve customer from job lineage (job.customer_id from conversion record context)
      const customerId =
        job.customer_id ?? job.metadata?.customer_id ?? null;
      if (!customerId) {
        throw new Error(
          "Cannot resolve customer_id from operational_job — ensure job has customer lineage"
        );
      }

      const result = await createAndAdvanceCustomerOutcome({
        organizationId: job.organization_id,
        businessUnitId: job.business_unit_id,
        operationalJobId: jobId,
        workOrderId: workOrderId || null,
        customerId,
        outcomeType,
        description: outcomeDesc,
        transitions: [],
        accessToken,
        appUserId,
      });
      setOutcomeResult(result);
    } catch (err) {
      setOutcomeError(err.message);
    } finally {
      setLoadingOutcome(false);
    }
  }, [jobId, workOrderId, outcomeType, outcomeDesc, accessToken, appUserId]);

  const canAct = !!accessToken && !!jobId.trim() && !!workOrderId.trim();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={styles.panel}>
      <h3 style={styles.heading}>
        ⚙ ServiceOS <span style={styles.badge}>Wave 4</span> Preview
      </h3>
      <p style={{ fontSize: "0.72rem", color: "#8899AA", margin: "0 0 0.75rem" }}>
        Preview only. Works with explicit existing canonical IDs.
      </p>

      {/* Shared IDs */}
      <Field label="Operational Job ID *" value={jobId} onChange={setJobId} placeholder="uuid" />
      <Field label="Work Order ID *" value={workOrderId} onChange={setWorkOrderId} placeholder="uuid" />

      {/* ── A. Refresh / Readiness ────────────────────────────────────────── */}
      <SectionBox title="A. Refresh / Readiness">
        <button
          style={{ ...styles.btn, ...styles.btnRun, ...((!canAct || loadingRefresh) ? styles.btnDisabled : {}) }}
          disabled={!canAct || loadingRefresh}
          onClick={handleRefresh}
        >
          {loadingRefresh ? "Loading…" : "Load & Assess Readiness"}
        </button>
        {refreshError && <div style={styles.warn}>✗ {refreshError}</div>}
        {refreshResult && (
          <>
            <StatusLine ok={refreshResult.readiness.enrolled} label="Enrolled" />
            <StatusLine ok={refreshResult.readiness.hasGovernance} label="Governance frozen" />
            <StatusLine ok={refreshResult.readiness.hasRequirements} label="Requirements present" />
            <StatusLine ok={refreshResult.readiness.mandatoryEvidenceSatisfied} label="Mandatory evidence satisfied" />
            <StatusLine ok={refreshResult.readiness.qaSatisfied} label="QA satisfied (passed/waived)" />
            <StatusLine ok={refreshResult.readiness.correctiveActionsSatisfied} label="Corrective actions satisfied" />
            <StatusLine ok={refreshResult.readiness.readyToClose} label="Ready to close (preflight)" />
            {refreshResult.readiness.missingRequirementKeys.length > 0 && (
              <div style={styles.warn}>
                Missing keys: {refreshResult.readiness.missingRequirementKeys.join(", ")}
              </div>
            )}
            {refreshResult.qualitySignals && (
              <pre style={styles.pre}>
                {JSON.stringify(refreshResult.qualitySignals, null, 2)}
              </pre>
            )}
          </>
        )}
      </SectionBox>

      {/* ── B. Materialize Governance ─────────────────────────────────────── */}
      <SectionBox title="B. Materialize Governance">
        <Field
          label="Configuration Version ID *"
          value={configVersionId}
          onChange={setConfigVersionId}
          placeholder="uuid"
        />
        <Field
          label="Checklist Version Reference"
          value={checklistVersionRef}
          onChange={setChecklistVersionRef}
          placeholder="e.g. checklist-v2.1"
        />
        <Field
          label="Task Definition Reference"
          value={taskDefinitionRef}
          onChange={setTaskDefinitionRef}
          placeholder="e.g. task-residential-std-v1"
        />
        <p style={{ fontSize: "0.72rem", color: "#8899AA", margin: "0 0 0.5rem" }}>
          Policy rows are loaded from the DB for the given configuration version.
          No policy rows are invented in the UI.
        </p>
        <button
          style={{
            ...styles.btn,
            ...styles.btnRun,
            ...(!canAct || !configVersionId.trim() || loadingGov ? styles.btnDisabled : {}),
          }}
          disabled={!canAct || !configVersionId.trim() || loadingGov}
          onClick={handleMaterializeGovernance}
        >
          {loadingGov ? "Materializing…" : "Materialize Governance"}
        </button>
        {govError && <div style={styles.warn}>✗ {govError}</div>}
        {govResult && (
          <>
            <div style={styles.ok}>✓ Governance materialized</div>
            <div style={styles.info}>
              Requirements: {govResult.requirements?.length ?? 0}
            </div>
            <pre style={styles.pre}>{JSON.stringify(govResult, null, 2)}</pre>
          </>
        )}
      </SectionBox>

      {/* ── C. Attach Provider-Neutral Evidence ──────────────────────────── */}
      <SectionBox title="C. Attach Provider-Neutral Evidence">
        <Field
          label="Requirement Key *"
          value={evidenceReqKey}
          onChange={setEvidenceReqKey}
          placeholder="e.g. photo_after_kitchen"
        />
        <Field
          label="Storage Provider / System *"
          value={evidenceProvider}
          onChange={setEvidenceProvider}
          placeholder="e.g. s3 | gcs | azure-blob | cdn"
        />
        <Field
          label="Storage Reference (URL/key) *"
          value={evidenceReference}
          onChange={setEvidenceReference}
          placeholder="e.g. bucket/path/file.jpg"
        />
        <Field
          label="Worker Assignment ID (optional)"
          value={workerAssignmentId}
          onChange={setWorkerAssignmentId}
          placeholder="uuid"
        />
        <p style={{ fontSize: "0.72rem", color: "#FF4757", margin: "0 0 0.5rem" }}>
          No binary/base64 data. Storage reference only.
        </p>
        <button
          style={{
            ...styles.btn,
            ...styles.btnRun,
            ...(!canAct || !evidenceReqKey.trim() || !evidenceProvider.trim() || !evidenceReference.trim() || loadingEvidence
              ? styles.btnDisabled
              : {}),
          }}
          disabled={
            !canAct || !evidenceReqKey.trim() || !evidenceProvider.trim() || !evidenceReference.trim() || loadingEvidence
          }
          onClick={handleAttachEvidence}
        >
          {loadingEvidence ? "Attaching…" : "Attach Evidence Reference"}
        </button>
        {evidenceError && <div style={styles.warn}>✗ {evidenceError}</div>}
        {evidenceResult && (
          <>
            <div style={styles.ok}>✓ Evidence attached and verified</div>
            <div style={styles.info}>
              storage_system: {evidenceResult.storage_system} |{" "}
              storage_reference: {evidenceResult.storage_reference}
            </div>
          </>
        )}
      </SectionBox>

      {/* ── D. Exception / Rework Proof ──────────────────────────────────── */}
      <SectionBox title="D. Exception / Rework Proof">
        <p style={{ fontSize: "0.72rem", color: "#93c5fd", margin: "0 0 0.5rem" }}>
          Original failed QA is retained unchanged. Reinspection is a separate new row.
        </p>
        <Field
          label="Failed QA Inspection ID *"
          value={failedQaId}
          onChange={setFailedQaId}
          placeholder="existing failed qa_inspection uuid"
        />
        <Field
          label="Exception Description *"
          value={exceptionDesc}
          onChange={setExceptionDesc}
          placeholder="What was observed / found"
        />
        <Field
          label="Corrective Action Description *"
          value={correctiveDesc}
          onChange={setCorrectiveDesc}
          placeholder="What rework/corrective action was taken"
        />
        <button
          style={{
            ...styles.btn,
            ...styles.btnRun,
            ...(!canAct || !failedQaId.trim() || !exceptionDesc.trim() || !correctiveDesc.trim() || loadingRework
              ? styles.btnDisabled
              : {}),
          }}
          disabled={
            !canAct || !failedQaId.trim() || !exceptionDesc.trim() || !correctiveDesc.trim() || loadingRework
          }
          onClick={handleRunRework}
        >
          {loadingRework ? "Running…" : "Run Exception → Rework → Reinspection"}
        </button>
        {reworkError && <div style={styles.warn}>✗ {reworkError}</div>}
        {reworkResult && (
          <>
            <div style={styles.ok}>✓ Exception/rework flow completed</div>
            <div style={styles.info}>
              Original QA ({failedQaId.slice(0, 8)}…) — retained as failed
            </div>
            <div style={styles.ok}>
              Reinspection ({reworkResult.reinspection?.id?.slice(0, 8)}…) — passed
            </div>
            <div style={styles.ok}>
              Exception ({reworkResult.exception?.id?.slice(0, 8)}…) — closed
            </div>
          </>
        )}
      </SectionBox>

      {/* ── E. Customer Outcome ──────────────────────────────────────────── */}
      <SectionBox title="E. Customer Outcome">
        <label style={styles.label}>Outcome Type *</label>
        <select
          style={styles.input}
          value={outcomeType}
          onChange={(e) => setOutcomeType(e.target.value)}
        >
          {OUTCOME_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Field
          label="Description *"
          value={outcomeDesc}
          onChange={setOutcomeDesc}
          placeholder="Customer feedback or issue description"
        />
        <p style={{ fontSize: "0.72rem", color: "#8899AA", margin: "0 0 0.5rem" }}>
          Customer/contact resolved from operational_job lineage.
        </p>
        <button
          style={{
            ...styles.btn,
            ...styles.btnRun,
            ...(!canAct || !outcomeDesc.trim() || loadingOutcome ? styles.btnDisabled : {}),
          }}
          disabled={!canAct || !outcomeDesc.trim() || loadingOutcome}
          onClick={handleCreateOutcome}
        >
          {loadingOutcome ? "Creating…" : "Create Customer Outcome"}
        </button>
        {outcomeError && <div style={styles.warn}>✗ {outcomeError}</div>}
        {outcomeResult && (
          <div style={styles.ok}>
            ✓ Outcome created — id: {outcomeResult.outcome?.id?.slice(0, 8)}…
          </div>
        )}
      </SectionBox>

      {/* ── F. Quality / Governance Status (inline with A refresh) ──────── */}
      <SectionBox title="F. Quality / Governance Status">
        <p style={{ fontSize: "0.72rem", color: "#8899AA", margin: "0 0 0.5rem" }}>
          Use &quot;Load &amp; Assess Readiness&quot; above to populate these signals.
        </p>
        {refreshResult ? (
          <>
            <StatusLine ok={refreshResult.readiness.enrolled} label="Enrolled" />
            <StatusLine ok={refreshResult.readiness.hasGovernance} label="Governance frozen" />
            <StatusLine ok={refreshResult.readiness.hasRequirements} label="Requirements present" />
            <StatusLine ok={refreshResult.readiness.mandatoryEvidenceSatisfied} label="Mandatory evidence satisfied" />
            <StatusLine ok={refreshResult.readiness.qaSatisfied} label="QA satisfied" />
            <StatusLine ok={refreshResult.readiness.correctiveActionsSatisfied} label="Corrective actions satisfied" />
            <StatusLine ok={refreshResult.readiness.readyToClose} label="readyToClose (preflight)" />
            {refreshResult.qualitySignals && (
              <>
                <div style={styles.info}>
                  Exceptions: {refreshResult.qualitySignals.exception_count} (
                  {refreshResult.qualitySignals.unresolved_exception_count} unresolved)
                </div>
                <div style={styles.info}>
                  Evidence: {refreshResult.qualitySignals.evidence_count} /{" "}
                  {refreshResult.qualitySignals.required_evidence_count} required
                </div>
                <div style={styles.info}>
                  QA: {refreshResult.qualitySignals.qa_passed_count} passed,{" "}
                  {refreshResult.qualitySignals.qa_failed_count} failed
                </div>
                <div style={styles.info}>
                  Corrective actions: {refreshResult.qualitySignals.corrective_action_count} (
                  {refreshResult.qualitySignals.unverified_corrective_action_count} unverified)
                </div>
                <div style={styles.info}>
                  Customer outcomes: {refreshResult.qualitySignals.customer_outcome_count}
                </div>
              </>
            )}
          </>
        ) : (
          <div style={styles.info}>No data loaded yet.</div>
        )}
      </SectionBox>
    </div>
  );
}
