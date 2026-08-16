// ── Wave 5: ServiceOS Finance Preview Pilot Panel ─────────────────────────────
//
// Feature flags required:
//   VITE_SERVICEOS_FINANCE_ENABLED   === "true"
//   VITE_SERVICEOS_WAVE5_PILOT_UI    === "true"
//
// This panel works ONLY with explicit canonical IDs entered by the user.
// It does NOT:
//   - modify Wave 1–4 data
//   - delete or void historical records
//   - execute SQL migrations
//   - invoke cleanup
//   - enable Production flags
//
// Production flags remain OFF.

import React, { useState, useCallback } from "react";

import {
  assessBillingReadiness,
  createAndFreezeInvoiceRequest,
  createCompensationVersion,
  approveCompensationVersion,
  createPayableForAssignment,
  approveContractorPayable,
  captureJobProfitabilitySnapshot,
  loadWave5FinanceStatus,
} from "../../lib/serviceosWave5Runtime.js";
import {
  runWave5NextGate,
  loadWave5AcceptanceState,
} from "../../lib/serviceosWave5AcceptanceRunner.js";
import {
  fetchContractorCompensationVersionById,
  fetchInvoiceRequestById,
} from "../../lib/serviceosWave5FinanceClient.js";
import { authenticatedRestFetchWithRefresh } from "../../lib/serviceosAuthClient.js";
import {
  fetchOperationalHandoffForJob,
  fetchOperationalJobById,
  fetchWorkOrderForJob,
  fetchQaInspectionsForJob,
  fetchCorrectiveActionsForJob,
  createOperationalHandoff,
} from "../../lib/serviceosOperationsClient.js";
import { buildOperationalHandoffPayload } from "../../lib/serviceosOperationsUtils.js";

const FINANCE_ENABLED =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_FINANCE_ENABLED === "true";

const WAVE5_PILOT_ENABLED =
  FINANCE_ENABLED &&
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_SERVICEOS_WAVE5_PILOT_UI === "true";

const styles = {
  panel: {
    position: "fixed",
    bottom: 16,
    left: 16,
    width: 410,
    background: "#0e1a2b",
    border: "1px solid #1e3a5f",
    borderRadius: 8,
    padding: "1.25rem",
    fontFamily: "system-ui, sans-serif",
    color: "#e8f4ff",
    zIndex: 9995,
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    maxHeight: "90vh",
    overflowY: "auto",
    fontSize: "0.82rem",
  },
  heading: {
    margin: "0 0 0.75rem",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#38bdf8",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  badge: {
    background: "#1e40af",
    color: "#bfdbfe",
    fontSize: "0.68rem",
    borderRadius: 4,
    padding: "2px 6px",
    fontWeight: 700,
  },
  section: {
    marginBottom: "0.9rem",
    borderTop: "1px solid #1e3a5f",
    paddingTop: "0.7rem",
  },
  sectionLabel: {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: "#7dd3fc",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    width: "100%",
    background: "#0a1628",
    border: "1px solid #2d4a6e",
    borderRadius: 4,
    color: "#e8f4ff",
    padding: "5px 8px",
    fontSize: "0.78rem",
    marginBottom: 6,
    boxSizing: "border-box",
  },
  btn: {
    background: "#1e40af",
    color: "#e8f4ff",
    border: "none",
    borderRadius: 4,
    padding: "5px 12px",
    fontSize: "0.78rem",
    cursor: "pointer",
    marginRight: 6,
  },
  statusBlock: {
    background: "#0a1628",
    border: "1px solid #1e3a5f",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: "0.75rem",
    marginTop: 6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  error: { color: "#f87171", fontSize: "0.75rem", marginTop: 4 },
};

function ResultBlock({ data, error }) {
  if (error) return <div style={styles.error}>{String(error)}</div>;
  if (data === undefined || data === null) return null;
  return (
    <div style={styles.statusBlock}>{JSON.stringify(data, null, 2)}</div>
  );
}

async function fetchExactRow(table, id, _accessToken) {
  const res = await authenticatedRestFetchWithRefresh(
    `${table}?id=eq.${encodeURIComponent(id)}&limit=1`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${table} ${id} lookup failed: HTTP ${res.status} ${text}`);
  }
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
  if (!row) throw new Error(`${table} ${id} not found`);
  return row;
}

async function fetchRows(table, filter, _accessToken) {
  const res = await authenticatedRestFetchWithRefresh(`${table}?${filter}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${table} lookup failed: HTTP ${res.status} ${text}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function parseNumberInput(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number`);
  return parsed;
}

function parseOptionalJsonObject(value, label) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return {};
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

export default function ServiceOSWave5FinancePilotPanel({ session, revenueContext }) {
  if (!WAVE5_PILOT_ENABLED) return null;

  const accessToken = session?.access_token ?? null;
  const appUserId = revenueContext?.appUserId ?? null;
  const canMutate = !!appUserId;

  // ── 0 · Operational handoff resolver ────────────────────────────────────────
  const [resolverJobId, setResolverJobId] = useState("");
  const [resolverWorkOrderId, setResolverWorkOrderId] = useState("");
  const [resolverResult, setResolverResult] = useState(null);
  const [resolverErr, setResolverErr] = useState(null);
  const [resolverLoading, setResolverLoading] = useState(false);

  const handleResolveHandoff = useCallback(async () => {
    const jobId = resolverJobId.trim();
    const workOrderId = resolverWorkOrderId.trim();
    if (!jobId || !workOrderId) {
      setResolverErr("operational_job_id and work_order_id are required");
      return;
    }
    if (!canMutate) {
      setResolverErr("Cannot resolve handoff: canonical ServiceOS app user could not be resolved. Preview-only.");
      return;
    }
    setResolverLoading(true);
    setResolverErr(null);
    setResolverResult(null);
    try {
      // A. Check for an existing handoff first
      const existing = await fetchOperationalHandoffForJob(jobId, accessToken);
      if (existing) {
        if (existing.handoff_status === "cancelled") {
          throw new Error(
            `Existing operational handoff ${existing.id} is cancelled — resolve this condition before proceeding. Do not reuse a cancelled handoff.`
          );
        }
        if (existing.work_order_id !== workOrderId) {
          throw new Error(
            `Existing operational handoff ${existing.id} belongs to work_order ${existing.work_order_id}, not ${workOrderId} — lineage mismatch.`
          );
        }
        setHandoffId1(existing.id);
        setResolverResult({
          resolved: "existing",
          handoff_id: existing.id,
          handoff_status: existing.handoff_status,
          message: `Canonical operational handoff already exists — reusing ID ${existing.id}`,
        });
        return;
      }

      // B. No existing handoff — verify all prerequisites before creating
      const [job, workOrder, qaInspections, correctiveActions] = await Promise.all([
        fetchOperationalJobById(jobId, accessToken),
        fetchWorkOrderForJob(jobId, accessToken),
        fetchQaInspectionsForJob(jobId, accessToken),
        fetchCorrectiveActionsForJob(jobId, accessToken),
      ]);

      if (!job) throw new Error(`operational_job ${jobId} not found`);
      if (!workOrder) throw new Error(`work_order for job ${jobId} not found`);
      if (workOrder.id !== workOrderId) {
        throw new Error(
          `work_order for job ${jobId} is ${workOrder.id}, not ${workOrderId} — lineage mismatch.`
        );
      }

      const VALID_JOB_STATUSES = ["qa_passed", "closed"];
      if (!VALID_JOB_STATUSES.includes(job.operational_status)) {
        throw new Error(
          `BLOCKER: operational_job status is "${job.operational_status}" — must be qa_passed or closed before handoff creation.`
        );
      }

      const VALID_WO_STATUSES = ["qa_complete", "closed"];
      if (!VALID_WO_STATUSES.includes(workOrder.work_order_status)) {
        throw new Error(
          `BLOCKER: work_order status is "${workOrder.work_order_status}" — must be qa_complete or closed before handoff creation.`
        );
      }

      const finalQa = Array.isArray(qaInspections)
        ? qaInspections.find(
            (q) => q.inspection_status === "passed" || q.inspection_status === "waived"
          )
        : null;
      if (!finalQa) {
        throw new Error(
          "BLOCKER: No QA inspection with outcome passed or waived found for this job — handoff creation blocked."
        );
      }

      const openCas = Array.isArray(correctiveActions)
        ? correctiveActions.filter(
            (ca) => ca.action_status !== "verified" && ca.action_status !== "cancelled"
          )
        : [];
      if (openCas.length > 0) {
        throw new Error(
          `BLOCKER: ${openCas.length} corrective action(s) are not verified or cancelled — resolve them before handoff creation.`
        );
      }

      if (!job.pricing_snapshot_id) throw new Error("BLOCKER: operational_job.pricing_snapshot_id is missing.");
      if (!job.quote_version_id) throw new Error("BLOCKER: operational_job.quote_version_id is missing.");
      if (!job.organization_id) throw new Error("BLOCKER: operational_job.organization_id is missing.");
      if (!job.business_unit_id) throw new Error("BLOCKER: operational_job.business_unit_id is missing.");

      const payload = buildOperationalHandoffPayload({
        organizationId: job.organization_id,
        businessUnitId: job.business_unit_id,
        operationalJobId: jobId,
        workOrderId: workOrder.id,
        qaInspectionId: finalQa.id,
        pricingSnapshotId: job.pricing_snapshot_id,
        quoteVersionId: job.quote_version_id,
        handoffStatus: "ready",
        appUserId,
      });

      const created = await createOperationalHandoff(payload, accessToken);
      if (!created?.id) throw new Error("createOperationalHandoff did not return a record ID.");

      setHandoffId1(created.id);
      setResolverResult({
        resolved: "created",
        handoff_id: created.id,
        message: `Canonical operational handoff created — ID ${created.id}`,
      });
    } catch (e) {
      setResolverErr(e.message);
    } finally {
      setResolverLoading(false);
    }
  }, [resolverJobId, resolverWorkOrderId, accessToken, appUserId, canMutate]);

  const [jobId1, setJobId1] = useState("");
  const [workOrderId1, setWorkOrderId1] = useState("");
  const [handoffId1, setHandoffId1] = useState("");
  const [gateResult, setGateResult] = useState(null);
  const [gateErr, setGateErr] = useState(null);
  const [gateLoading, setGateLoading] = useState(false);

  const handleAssessBillingReadiness = useCallback(async () => {
    if (!jobId1.trim() || !workOrderId1.trim()) {
      setGateErr("operational_job_id and work_order_id required");
      return;
    }
    if (!handoffId1.trim()) {
      setGateErr("Resolve the canonical operational handoff before assessing billing readiness.");
      return;
    }
    setGateLoading(true);
    setGateErr(null);
    setGateResult(null);
    try {
      const [job, workOrder, correctiveActions] = await Promise.all([
        fetchExactRow("operational_job", jobId1.trim(), accessToken),
        fetchExactRow("work_order", workOrderId1.trim(), accessToken),
        fetchRows(
          "corrective_action",
          `operational_job_id=eq.${encodeURIComponent(jobId1.trim())}&order=created_at.asc`,
          accessToken
        ),
      ]);
      const operationalHandoff = handoffId1.trim()
        ? await fetchExactRow("operational_handoff", handoffId1.trim(), accessToken)
        : null;
      const result = await assessBillingReadiness(
        {
          organizationId: job.organization_id,
          businessUnitId: job.business_unit_id,
          jurisdictionId: job.jurisdiction_id ?? workOrder.jurisdiction_id ?? null,
        },
        job,
        workOrder,
        operationalHandoff,
        correctiveActions,
        { accessToken, appUserId }
      );
      setGateResult(result);
    } catch (e) {
      setGateErr(e.message);
    } finally {
      setGateLoading(false);
    }
  }, [jobId1, workOrderId1, handoffId1, accessToken, appUserId]);

  const [gateId2, setGateId2] = useState("");
  const [psId2, setPsId2] = useState("");
  const [qvId2, setQvId2] = useState("");
  const [irResult, setIrResult] = useState(null);
  const [irErr, setIrErr] = useState(null);
  const [irLoading, setIrLoading] = useState(false);

  const handleCreateInvoiceRequest = useCallback(async () => {
    if (!gateId2.trim() || !psId2.trim() || !qvId2.trim()) {
      setIrErr("billing_readiness_gate_id, pricing_snapshot_id, and quote_version_id required");
      return;
    }
    setIrLoading(true);
    setIrErr(null);
    setIrResult(null);
    try {
      const [gate, pricingSnapshot, quoteVersion] = await Promise.all([
        fetchExactRow("billing_readiness_gate", gateId2.trim(), accessToken),
        fetchExactRow("pricing_snapshot", psId2.trim(), accessToken),
        fetchExactRow("quote_version", qvId2.trim(), accessToken),
      ]);
      const result = await createAndFreezeInvoiceRequest(
        {
          organizationId: gate.organization_id,
          businessUnitId: gate.business_unit_id,
          jurisdictionId: gate.jurisdiction_id ?? null,
        },
        gate,
        pricingSnapshot,
        quoteVersion,
        null,
        { accessToken, appUserId }
      );
      setIrResult(result);
    } catch (e) {
      setIrErr(e.message);
    } finally {
      setIrLoading(false);
    }
  }, [gateId2, psId2, qvId2, accessToken, appUserId]);

  const [irId3, setIrId3] = useState("");
  const [idempotencyKey3, setIdempotencyKey3] = useState("");
  const [syncResult, setSyncResult] = useState(null);
  const [syncErr, setSyncErr] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);

  const handleEnqueueAccountingSync = useCallback(async () => {
    if (!irId3.trim() || !idempotencyKey3.trim()) {
      setSyncErr("invoice_request_id and idempotency_key required");
      return;
    }
    if (!accessToken) {
      setSyncErr("ServiceOS access token required");
      return;
    }
    setSyncLoading(true);
    setSyncErr(null);
    setSyncResult(null);
    try {
      const response = await fetch("/api/wave5-accounting-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify({
          invoice_request_id: irId3.trim(),
          idempotency_key: idempotencyKey3.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || "Accounting sync request failed: HTTP " + response.status);
      }
      setSyncResult(payload);
    } catch (e) {
      setSyncErr(e.message);
    } finally {
      setSyncLoading(false);
    }
  }, [irId3, idempotencyKey3, accessToken]);

  const [irId4, setIrId4] = useState("");
  const [providerEventId4, setProviderEventId4] = useState("");
  const [payResult, setPayResult] = useState(null);
  const [payErr, setPayErr] = useState(null);
  const [payLoading, setPayLoading] = useState(false);

  const handleObservePayment = useCallback(async () => {
    if (!irId4.trim() || !providerEventId4.trim()) {
      setPayErr("invoice_request_id and provider_event_id required");
      return;
    }
    if (!accessToken) {
      setPayErr("ServiceOS access token required");
      return;
    }
    setPayLoading(true);
    setPayErr(null);
    setPayResult(null);
    try {
      const response = await fetch("/api/wave5-preview-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify({
          invoice_request_id: irId4.trim(),
          provider_event_id: providerEventId4.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || "Preview payment request failed: HTTP " + response.status);
      }
      setPayResult(payload);
    } catch (e) {
      setPayErr(e.message);
    } finally {
      setPayLoading(false);
    }
  }, [irId4, providerEventId4, accessToken]);

  const [orgId5, setOrgId5] = useState("");
  const [buId5, setBuId5] = useState("");
  const [workerId5, setWorkerId5] = useState("");
  const [serviceFamily5, setServiceFamily5] = useState("");
  const [serviceModuleKey5, setServiceModuleKey5] = useState("");
  const [version5, setVersion5] = useState("");
  const [method5, setMethod5] = useState("flat_amount");
  const [currency5, setCurrency5] = useState("CAD");
  const [rateValue5, setRateValue5] = useState("");
  const [effectiveFrom5, setEffectiveFrom5] = useState("");
  const [effectiveTo5, setEffectiveTo5] = useState("");
  const [governanceSnapshot5, setGovernanceSnapshot5] = useState("");
  const [compVersionResult, setCompVersionResult] = useState(null);
  const [compVersionErr, setCompVersionErr] = useState(null);
  const [compVersionLoading, setCompVersionLoading] = useState(false);

  const handleCreateCompensationVersion = useCallback(async () => {
    if (
      !orgId5.trim() ||
      !buId5.trim() ||
      !workerId5.trim() ||
      !version5.trim() ||
      !method5.trim() ||
      !currency5.trim() ||
      !rateValue5.trim() ||
      !effectiveFrom5.trim()
    ) {
      setCompVersionErr("organization_id, business_unit_id, worker_id, version, compensation_method, currency_code, rate_value, and effective_from required");
      return;
    }
    setCompVersionLoading(true);
    setCompVersionErr(null);
    setCompVersionResult(null);
    try {
      const result = await createCompensationVersion(
        {
          organizationId: orgId5.trim(),
          businessUnitId: buId5.trim(),
        },
        {
          workerId: workerId5.trim(),
          serviceFamily: serviceFamily5.trim() || null,
          serviceModuleKey: serviceModuleKey5.trim() || null,
          version: version5.trim(),
          compensationMethod: method5.trim(),
          currencyCode: currency5.trim(),
          rateValue: parseNumberInput(rateValue5, "rate_value"),
          effectiveFrom: effectiveFrom5.trim(),
          effectiveTo: effectiveTo5.trim() || null,
          governanceReferenceSnapshot: parseOptionalJsonObject(
            governanceSnapshot5,
            "governance_reference_snapshot"
          ),
        },
        { accessToken, appUserId }
      );
      setCompVersionResult(result);
    } catch (e) {
      setCompVersionErr(e.message);
    } finally {
      setCompVersionLoading(false);
    }
  }, [
    orgId5,
    buId5,
    workerId5,
    serviceFamily5,
    serviceModuleKey5,
    version5,
    method5,
    currency5,
    rateValue5,
    effectiveFrom5,
    effectiveTo5,
    governanceSnapshot5,
    accessToken,
    appUserId,
  ]);

  const [versionId6, setVersionId6] = useState("");
  const [approverId6, setApproverId6] = useState("");
  const [approveResult, setApproveResult] = useState(null);
  const [approveErr, setApproveErr] = useState(null);
  const [approveLoading, setApproveLoading] = useState(false);

  const handleApproveCompensationVersion = useCallback(async () => {
    if (!versionId6.trim() || !approverId6.trim()) {
      setApproveErr("contractor_compensation_version_id and approver_app_user_id required");
      return;
    }
    setApproveLoading(true);
    setApproveErr(null);
    setApproveResult(null);
    try {
      const result = await approveCompensationVersion(
        versionId6.trim(),
        approverId6.trim(),
        { accessToken }
      );
      setApproveResult(result);
    } catch (e) {
      setApproveErr(e.message);
    } finally {
      setApproveLoading(false);
    }
  }, [versionId6, approverId6, accessToken]);

  const [orgId7, setOrgId7] = useState("");
  const [buId7, setBuId7] = useState("");
  const [assignmentId7, setAssignmentId7] = useState("");
  const [jobId7, setJobId7] = useState("");
  const [workOrderId7, setWorkOrderId7] = useState("");
  const [versionId7, setVersionId7] = useState("");
  const [basisValue7, setBasisValue7] = useState("");
  const [payableResult, setPayableResult] = useState(null);
  const [payableErr, setPayableErr] = useState(null);
  const [payableLoading, setPayableLoading] = useState(false);

  const handleCreatePayable = useCallback(async () => {
    if (
      !orgId7.trim() ||
      !buId7.trim() ||
      !assignmentId7.trim() ||
      !jobId7.trim() ||
      !workOrderId7.trim() ||
      !versionId7.trim() ||
      !basisValue7.trim()
    ) {
      setPayableErr("organization_id, business_unit_id, worker_assignment_id, operational_job_id, work_order_id, contractor_compensation_version_id, and basis_value required");
      return;
    }
    setPayableLoading(true);
    setPayableErr(null);
    setPayableResult(null);
    try {
      const [workerAssignment, operationalJob, workOrder, compensationVersion] =
        await Promise.all([
          fetchExactRow("worker_assignment", assignmentId7.trim(), accessToken),
          fetchExactRow("operational_job", jobId7.trim(), accessToken),
          fetchExactRow("work_order", workOrderId7.trim(), accessToken),
          fetchContractorCompensationVersionById(versionId7.trim(), accessToken),
        ]);
      const result = await createPayableForAssignment(
        {
          organizationId: orgId7.trim(),
          businessUnitId: buId7.trim(),
        },
        workerAssignment,
        operationalJob,
        workOrder,
        compensationVersion,
        parseNumberInput(basisValue7, "basis_value"),
        { accessToken, appUserId }
      );
      setPayableResult(result);
    } catch (e) {
      setPayableErr(e.message);
    } finally {
      setPayableLoading(false);
    }
  }, [
    orgId7,
    buId7,
    assignmentId7,
    jobId7,
    workOrderId7,
    versionId7,
    basisValue7,
    accessToken,
    appUserId,
  ]);

  const [irId8, setIrId8] = useState("");
  const [otherDirectCost8, setOtherDirectCost8] = useState("0");
  const [directCostRef8, setDirectCostRef8] = useState("");
  const [profResult, setProfResult] = useState(null);
  const [profErr, setProfErr] = useState(null);
  const [profLoading, setProfLoading] = useState(false);

  const handleCaptureProfit = useCallback(async () => {
    if (!irId8.trim()) {
      setProfErr("invoice_request_id required");
      return;
    }
    setProfLoading(true);
    setProfErr(null);
    setProfResult(null);
    try {
      const otherDirectCost = parseNumberInput(otherDirectCost8 || "0", "other_direct_cost");
      if (otherDirectCost > 0 && !directCostRef8.trim()) {
        throw new Error("direct_cost_source_reference required when other_direct_cost > 0");
      }
      const invoiceRequest = await fetchInvoiceRequestById(irId8.trim(), accessToken);
      if (!invoiceRequest) throw new Error(`invoice_request ${irId8.trim()} not found`);
      const result = await captureJobProfitabilitySnapshot(
        {
          organizationId: invoiceRequest.organization_id,
          businessUnitId: invoiceRequest.business_unit_id,
        },
        invoiceRequest,
        {
          accessToken,
          appUserId,
          otherDirectCost,
          directCostSourceReference: directCostRef8.trim() || null,
        }
      );
      setProfResult(result);
    } catch (e) {
      setProfErr(e.message);
    } finally {
      setProfLoading(false);
    }
  }, [irId8, otherDirectCost8, directCostRef8, accessToken, appUserId]);

  const [jobId9, setJobId9] = useState("");
  const [statusResult, setStatusResult] = useState(null);
  const [statusErr, setStatusErr] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const handleLoadStatus = useCallback(async () => {
    if (!jobId9.trim()) {
      setStatusErr("operational_job_id required");
      return;
    }
    setStatusLoading(true);
    setStatusErr(null);
    setStatusResult(null);
    try {
      const result = await loadWave5FinanceStatus(jobId9.trim(), { accessToken });
      setStatusResult(result);
    } catch (e) {
      setStatusErr(e.message);
    } finally {
      setStatusLoading(false);
    }
  }, [jobId9, accessToken]);

  // ── Wave 5 Guided Acceptance (runner) ────────────────────────────────────────
  const [gaJobId, setGaJobId] = useState("");
  const [gaBasisValue, setGaBasisValue] = useState("");
  const [gaOtherDirectCost, setGaOtherDirectCost] = useState("0");
  const [gaDirectCostRef, setGaDirectCostRef] = useState("");
  const [gaState, setGaState] = useState(null);
  const [gaGateResult, setGaGateResult] = useState(null);
  const [gaRlsResult, setGaRlsResult] = useState(null);
  const [gaRlsErr, setGaRlsErr] = useState(null);
  const [gaErr, setGaErr] = useState(null);
  const [gaLoading, setGaLoading] = useState(false);
  const [gaRlsLoading, setGaRlsLoading] = useState(false);

  const handleGaLoad = useCallback(async () => {
    const jobId = gaJobId.trim();
    if (!jobId) { setGaErr("operational_job_id required"); return; }
    if (!accessToken) { setGaErr("No access token — please sign in"); return; }
    setGaLoading(true);
    setGaErr(null);
    setGaState(null);
    setGaGateResult(null);
    setGaRlsResult(null);
    setGaRlsErr(null);
    try {
      const state = await loadWave5AcceptanceState(jobId, accessToken);
      setGaState(state);
    } catch (e) {
      setGaErr(e.message);
    } finally {
      setGaLoading(false);
    }
  }, [gaJobId, accessToken]);

  const handleGaRunNextGate = useCallback(async () => {
    const jobId = gaJobId.trim();
    if (!jobId) { setGaErr("operational_job_id required"); return; }
    if (!accessToken) { setGaErr("No access token — please sign in"); return; }
    if (!appUserId) { setGaErr("Cannot run gate: canonical app user required"); return; }
    if (!gaState?.nextGate) { setGaErr("No next gate available — load state first"); return; }
    setGaLoading(true);
    setGaErr(null);
    setGaGateResult(null);
    setGaRlsResult(null);
    setGaRlsErr(null);
    try {
      const result = await runWave5NextGate({
        operationalJobId: jobId,
        approverAppUserId: appUserId,
        basisValue: gaBasisValue.trim() ? Number(gaBasisValue) : 0,
        otherDirectCost: Number(gaOtherDirectCost ?? 0),
        directCostSourceReference: gaDirectCostRef.trim() || null,
        accessToken,
      });
      setGaGateResult(result);
      // Refresh state after gate execution
      const state = await loadWave5AcceptanceState(jobId, accessToken);
      setGaState(state);
    } catch (e) {
      setGaErr(e.message);
    } finally {
      setGaLoading(false);
    }
  }, [gaJobId, gaBasisValue, gaOtherDirectCost, gaDirectCostRef, gaState, appUserId, accessToken, revenueContext]);

  const handleGaRunRlsAcceptance = useCallback(async () => {
    const jobId = gaJobId.trim();
    if (!jobId) { setGaRlsErr("operational_job_id required"); return; }
    if (!accessToken) { setGaRlsErr("No access token — please sign in"); return; }
    if (gaState?.financeCoreStatus !== "pass") {
      setGaRlsErr("FINANCE CORE PASS is required before running Wave 5 RLS Acceptance");
      return;
    }
    setGaRlsLoading(true);
    setGaRlsErr(null);
    setGaRlsResult(null);
    try {
      const response = await fetch("/api/wave4-rls-acceptance-harness", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify({
          wave: "wave5",
          contract_version: "wave5-rls-acceptance-v1",
          operational_job_id: jobId,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || "Wave 5 RLS acceptance failed: HTTP " + response.status);
      }
      setGaRlsResult(payload);
    } catch (e) {
      setGaRlsErr(e.message);
    } finally {
      setGaRlsLoading(false);
    }
  }, [gaJobId, gaState, accessToken]);

  return (
    <div style={styles.panel}>
      <h4 style={styles.heading}>
        💰 ServiceOS Wave 5 Finance Pilot
        <span style={styles.badge}>PREVIEW ONLY</span>
      </h4>

      {!canMutate && (
        <div style={{ ...styles.statusBlock, color: "#fbbf24", marginBottom: 8 }}>
          ⚠️ Preview-only: canonical ServiceOS app user could not be resolved. Mutation and assessment actions are disabled until the app user is authenticated through the ServiceOS revenue context.
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionLabel}>0 · Resolve / Load Operational Handoff</div>
        <input
          style={styles.input}
          placeholder="operational_job_id"
          value={resolverJobId}
          onChange={(e) => setResolverJobId(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="work_order_id"
          value={resolverWorkOrderId}
          onChange={(e) => setResolverWorkOrderId(e.target.value)}
        />
        <button
          style={styles.btn}
          onClick={handleResolveHandoff}
          disabled={resolverLoading || !canMutate}
        >
          {resolverLoading ? "…" : "Resolve / Load Operational Handoff"}
        </button>
        <ResultBlock data={resolverResult} error={resolverErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>1 · Billing readiness</div>
        <input
          style={styles.input}
          placeholder="operational_job_id"
          value={jobId1}
          onChange={(e) => setJobId1(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="work_order_id"
          value={workOrderId1}
          onChange={(e) => setWorkOrderId1(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="operational_handoff_id (required — resolve above first)"
          value={handoffId1}
          onChange={(e) => setHandoffId1(e.target.value)}
        />
        {!handoffId1.trim() && (
          <div style={{ ...styles.error, marginBottom: 4 }}>
            Resolve the canonical operational handoff before assessing billing readiness.
          </div>
        )}
        <button style={styles.btn} onClick={handleAssessBillingReadiness} disabled={gateLoading || !handoffId1.trim()}>
          {gateLoading ? "…" : "Assess Billing Readiness"}
        </button>
        <ResultBlock data={gateResult} error={gateErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>2 · Invoice request</div>
        <input style={styles.input} placeholder="billing_readiness_gate_id" value={gateId2} onChange={(e) => setGateId2(e.target.value)} />
        <input style={styles.input} placeholder="pricing_snapshot_id" value={psId2} onChange={(e) => setPsId2(e.target.value)} />
        <input style={styles.input} placeholder="quote_version_id" value={qvId2} onChange={(e) => setQvId2(e.target.value)} />
        <button style={styles.btn} onClick={handleCreateInvoiceRequest} disabled={irLoading}>
          {irLoading ? "…" : "Create Invoice Request"}
        </button>
        <ResultBlock data={irResult} error={irErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>3 · Server accounting sync</div>
        <input style={styles.input} placeholder="invoice_request_id" value={irId3} onChange={(e) => setIrId3(e.target.value)} />
        <input style={styles.input} placeholder="idempotency_key" value={idempotencyKey3} onChange={(e) => setIdempotencyKey3(e.target.value)} />
        <button style={styles.btn} onClick={handleEnqueueAccountingSync} disabled={syncLoading}>
          {syncLoading ? "…" : "Run Server Accounting Sync"}
        </button>
        <ResultBlock data={syncResult} error={syncErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>4 · Server Preview payment</div>
        <input style={styles.input} placeholder="invoice_request_id" value={irId4} onChange={(e) => setIrId4(e.target.value)} />
        <input style={styles.input} placeholder="provider_event_id" value={providerEventId4} onChange={(e) => setProviderEventId4(e.target.value)} />
        <button style={styles.btn} onClick={handleObservePayment} disabled={payLoading}>
          {payLoading ? "…" : "Run Server Preview Payment"}
        </button>
        <ResultBlock data={payResult} error={payErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>5 · Create contractor compensation version</div>
        <input style={styles.input} placeholder="organization_id" value={orgId5} onChange={(e) => setOrgId5(e.target.value)} />
        <input style={styles.input} placeholder="business_unit_id" value={buId5} onChange={(e) => setBuId5(e.target.value)} />
        <input style={styles.input} placeholder="worker_id" value={workerId5} onChange={(e) => setWorkerId5(e.target.value)} />
        <input style={styles.input} placeholder="service_family (optional)" value={serviceFamily5} onChange={(e) => setServiceFamily5(e.target.value)} />
        <input style={styles.input} placeholder="service_module_key (optional)" value={serviceModuleKey5} onChange={(e) => setServiceModuleKey5(e.target.value)} />
        <input style={styles.input} placeholder="version" value={version5} onChange={(e) => setVersion5(e.target.value)} />
        <input style={styles.input} placeholder="compensation_method" value={method5} onChange={(e) => setMethod5(e.target.value)} />
        <input style={styles.input} placeholder="currency_code" value={currency5} onChange={(e) => setCurrency5(e.target.value)} />
        <input style={styles.input} placeholder="rate_value" value={rateValue5} onChange={(e) => setRateValue5(e.target.value)} />
        <input style={styles.input} placeholder="effective_from (ISO timestamp)" value={effectiveFrom5} onChange={(e) => setEffectiveFrom5(e.target.value)} />
        <input style={styles.input} placeholder="effective_to (optional ISO timestamp)" value={effectiveTo5} onChange={(e) => setEffectiveTo5(e.target.value)} />
        <input style={styles.input} placeholder="governance_reference_snapshot JSON (optional)" value={governanceSnapshot5} onChange={(e) => setGovernanceSnapshot5(e.target.value)} />
        <button style={styles.btn} onClick={handleCreateCompensationVersion} disabled={compVersionLoading}>
          {compVersionLoading ? "…" : "Create Compensation Version"}
        </button>
        <ResultBlock data={compVersionResult} error={compVersionErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>6 · Approve contractor compensation version</div>
        <input style={styles.input} placeholder="contractor_compensation_version_id" value={versionId6} onChange={(e) => setVersionId6(e.target.value)} />
        <input style={styles.input} placeholder="approver_app_user_id" value={approverId6} onChange={(e) => setApproverId6(e.target.value)} />
        <button style={styles.btn} onClick={handleApproveCompensationVersion} disabled={approveLoading}>
          {approveLoading ? "…" : "Approve Compensation Version"}
        </button>
        <ResultBlock data={approveResult} error={approveErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>7 · Create contractor payable</div>
        <input style={styles.input} placeholder="organization_id" value={orgId7} onChange={(e) => setOrgId7(e.target.value)} />
        <input style={styles.input} placeholder="business_unit_id" value={buId7} onChange={(e) => setBuId7(e.target.value)} />
        <input style={styles.input} placeholder="worker_assignment_id" value={assignmentId7} onChange={(e) => setAssignmentId7(e.target.value)} />
        <input style={styles.input} placeholder="operational_job_id" value={jobId7} onChange={(e) => setJobId7(e.target.value)} />
        <input style={styles.input} placeholder="work_order_id" value={workOrderId7} onChange={(e) => setWorkOrderId7(e.target.value)} />
        <input style={styles.input} placeholder="contractor_compensation_version_id" value={versionId7} onChange={(e) => setVersionId7(e.target.value)} />
        <input style={styles.input} placeholder="basis_value" value={basisValue7} onChange={(e) => setBasisValue7(e.target.value)} />
        <button style={styles.btn} onClick={handleCreatePayable} disabled={payableLoading}>
          {payableLoading ? "…" : "Create Contractor Payable"}
        </button>
        <ResultBlock data={payableResult} error={payableErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>8 · Capture profitability snapshot</div>
        <input style={styles.input} placeholder="invoice_request_id" value={irId8} onChange={(e) => setIrId8(e.target.value)} />
        <input style={styles.input} placeholder="other_direct_cost" value={otherDirectCost8} onChange={(e) => setOtherDirectCost8(e.target.value)} />
        <input style={styles.input} placeholder="direct_cost_source_reference (required when other_direct_cost &gt; 0)" value={directCostRef8} onChange={(e) => setDirectCostRef8(e.target.value)} />
        <button style={styles.btn} onClick={handleCaptureProfit} disabled={profLoading}>
          {profLoading ? "…" : "Capture Profitability Snapshot"}
        </button>
        <ResultBlock data={profResult} error={profErr} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>9 · Load finance status</div>
        <input style={styles.input} placeholder="operational_job_id" value={jobId9} onChange={(e) => setJobId9(e.target.value)} />
        <button style={styles.btn} onClick={handleLoadStatus} disabled={statusLoading}>
          {statusLoading ? "…" : "Load Finance Status"}
        </button>
        <ResultBlock data={statusResult} error={statusErr} />
      </div>

      {/* ── Wave 5 Guided Acceptance ─────────────────────────────────────── */}
      <div style={{
        ...styles.section,
        borderTop: "2px solid #0ea5e9",
        paddingTop: "0.9rem",
        marginTop: "1rem",
      }}>
        <div style={{ ...styles.sectionLabel, color: "#38bdf8", fontSize: "0.78rem" }}>
          🧭 Wave 5 Guided Acceptance
          <span style={{ ...styles.badge, marginLeft: 8, background: "#0c4a6e" }}>PREVIEW ONLY</span>
        </div>

        <input
          style={styles.input}
          placeholder="operational_job_id (required)"
          value={gaJobId}
          onChange={(e) => setGaJobId(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="basis_value (optional — 0 for flat_amount)"
          value={gaBasisValue}
          onChange={(e) => setGaBasisValue(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="other_direct_cost (default 0)"
          value={gaOtherDirectCost}
          onChange={(e) => setGaOtherDirectCost(e.target.value)}
        />
        <input
          style={styles.input}
          placeholder="direct_cost_source_reference (optional)"
          value={gaDirectCostRef}
          onChange={(e) => setGaDirectCostRef(e.target.value)}
        />

        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button style={styles.btn} onClick={handleGaLoad} disabled={gaLoading}>
            {gaLoading ? "…" : "Load / Resume Wave 5"}
          </button>
          <button
            style={{
              ...styles.btn,
              background: gaState?.nextGate && !gaState?.blockerReason ? "#166534" : "#374151",
              cursor: gaState?.nextGate && !gaState?.blockerReason ? "pointer" : "not-allowed",
            }}
            onClick={handleGaRunNextGate}
            disabled={gaLoading || !gaState?.nextGate || !!gaState?.blockerReason}
          >
            {gaLoading ? "…" : "Run Next Gate"}
          </button>
          {gaState?.financeCoreStatus === "pass" && (
            <>
              <button style={styles.btn} onClick={handleGaLoad} disabled={gaLoading || gaRlsLoading}>
                {gaLoading ? "…" : "Refresh Status"}
              </button>
              <button style={styles.btn} onClick={handleGaRunRlsAcceptance} disabled={gaLoading || gaRlsLoading}>
                {gaRlsLoading ? "…" : "Run Wave 5 RLS Acceptance"}
              </button>
            </>
          )}
        </div>

        {gaErr && <div style={styles.error}>{gaErr}</div>}
        {gaRlsErr && <div style={styles.error}>{gaRlsErr}</div>}

        {gaState && (
          <div style={styles.statusBlock}>
            {/* Assignment */}
            <div><b>Assignment:</b> {gaState.assignment?.id ?? "—"} | status: {gaState.assignment?.assignment_status ?? "—"}</div>
            {/* Invoice */}
            <div><b>Invoice status:</b> {gaState.financeStatus?.invoice_request_status ?? "—"} | id: {gaState.financeStatus?.invoice_request_id ?? "—"}</div>
            {/* Payments */}
            <div><b>Payments:</b> {gaState.financeStatus?.payment_count ?? 0} | statuses: {(gaState.financeStatus?.payment_statuses ?? []).join(", ") || "—"}</div>
            {/* Compensation (from payable if available) */}
            <div><b>Payable:</b> {gaState.payable?.id ?? "—"} | status: {gaState.payable?.payable_status ?? "—"} | amount: {gaState.payable?.computed_amount ?? "—"} {gaState.payable?.currency_code ?? ""}</div>
            {/* Profitability */}
            <div><b>Profitability:</b> {gaState.profitability ? `snapshot ${gaState.profitability.id}` : "—"} | gross contribution: {gaState.profitability?.gross_contribution ?? "—"} | margin: {gaState.profitability?.gross_margin_percent != null ? `${(gaState.profitability.gross_margin_percent * 100).toFixed(2)}%` : "—"}</div>
            {/* Terminal state */}
            {gaState.financeCoreStatus === "pass" && (
              <div style={{ color: "#4ade80", marginTop: 4, fontWeight: "bold" }}>✅ FINANCE CORE PASS — proceed to RLS / HEMS closure</div>
            )}
            {/* Compensation version */}
            {gaState.compensationVersion && (
              <div><b>Comp version:</b> {gaState.compensationVersion.id} | method: {gaState.compensationVersion.compensation_method} | rate: {gaState.compensationVersion.rate_value} {gaState.compensationVersion.currency_code} | status: {gaState.compensationVersion.compensation_status}</div>
            )}
            {/* Next gate */}
            <div style={{ marginTop: 4 }}><b>Next gate:</b> <span style={{ color: "#4ade80" }}>{gaState.nextGate ?? "—"}</span></div>
            {gaState.blockerReason && (
              <div style={{ color: "#f87171", marginTop: 2 }}><b>Blocker:</b> {gaState.blockerReason}</div>
            )}
          </div>
        )}

        {gaGateResult && (
          <div style={{ ...styles.statusBlock, borderColor: "#166534", marginTop: 6 }}>
            <div style={{ color: "#4ade80", fontWeight: 700, marginBottom: 4 }}>
              ✓ Gate executed: {gaGateResult.gate}
            </div>
            {JSON.stringify(gaGateResult.result, null, 2)}
          </div>
        )}

        {gaRlsResult && (
          <div style={{ ...styles.statusBlock, borderColor: gaRlsResult.passed ? "#166534" : "#7f1d1d", marginTop: 6 }}>
            <div style={{ color: gaRlsResult.passed ? "#4ade80" : "#f87171", fontWeight: 700, marginBottom: 4 }}>
              {gaRlsResult.passed ? "✓" : "✕"} Wave 5 RLS Acceptance
            </div>
            {JSON.stringify(gaRlsResult, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}
