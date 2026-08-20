// ── Wave 5: Acceptance Runner ─────────────────────────────────────────────────
//
// Preview-only guided runner that resumes an existing Wave 5 acceptance sequence
// from whatever gate has already been completed.
//
// IMPORTANT: This runner NEVER recreates records that already exist.
// Each invocation loads canonical state and advances exactly ONE gate.
//
// Gate progression:
//   a. assignment acknowledged  → complete it
//   b. assignment completed, no payable → create payable
//   c. payable pending          → approve payable (owner/admin)
//   d. payable approved/paid, no profitability → capture profitability
//   e. profitability exists     → load/verify finance status
//
// Fail closed if:
//   - multiple active/completed assignments
//   - multiple payables for same assignment
//   - multiple ambiguous effective compensation versions
//   - lineage mismatches
//   - wrong org/BU
//   - missing canonical records
//   - invalid statuses

import {
  fetchAssignmentsForJob,
  fetchOperationalJobById,
  fetchWorkOrderForJob,
  updateWorkerAssignmentStatus,
} from "./serviceosOperationsClient.js";

import {
  fetchContractorPayablesByJobId,
  fetchJobProfitabilitySnapshotByJobId,
} from "./serviceosWave5FinanceClient.js";

import {
  createPayableForAssignment,
  approveContractorPayable,
  captureJobProfitabilitySnapshot,
  loadWave5FinanceStatus,
} from "./serviceosWave5Runtime.js";

import { authenticatedRestFetchWithRefresh } from "./serviceosAuthClient.js";

// ── Feature guard ─────────────────────────────────────────────────────────────

function isWave5PilotEnabled() {
  try {
    const env = typeof import.meta !== "undefined" ? import.meta.env : {};
    return (
      env?.VITE_SERVICEOS_FINANCE_ENABLED === "true" &&
      env?.VITE_SERVICEOS_WAVE5_PILOT_UI === "true"
    );
  } catch {
    return false;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function failClosed(reason) {
  const err = new Error(`Wave5AcceptanceRunner [FAIL CLOSED]: ${reason}`);
  err.failClosed = true;
  err.blockerReason = reason;
  return err;
}

// ── Canonical effective compensation version resolution ───────────────────────

async function resolveEffectiveCompensationVersion(workerId, organizationId, businessUnitId, serviceFamily, serviceCompletedAt) {
  // Build filter: exact worker, org, BU, status approved or active
  let filter =
    `worker_id=eq.${encodeURIComponent(workerId)}` +
    `&organization_id=eq.${encodeURIComponent(organizationId)}` +
    `&business_unit_id=eq.${encodeURIComponent(businessUnitId)}` +
    `&compensation_status=in.(approved,active)`;

  // Effective date filtering: effective_from <= serviceCompletedAt
  if (serviceCompletedAt) {
    filter += `&effective_from=lte.${encodeURIComponent(serviceCompletedAt)}`;
    // effective_to IS NULL OR effective_to >= serviceCompletedAt
    filter += `&or=(effective_to.is.null,effective_to.gte.${encodeURIComponent(serviceCompletedAt)})`;
  }

  // service_family: IS NULL OR matches job.service_family
  if (serviceFamily) {
    filter += `&or=(service_family.is.null,service_family.eq.${encodeURIComponent(serviceFamily)})`;
  } else {
    filter += `&service_family=is.null`;
  }

  filter += `&order=effective_from.desc`;

  const res = await authenticatedRestFetchWithRefresh(
    `contractor_compensation_version?${filter}`
  );
  if (!res || !res.ok) {
    throw failClosed("failed to load compensation versions");
  }
  const versions = await res.json();
  const effectiveVersions = Array.isArray(versions) ? versions : [];

  if (effectiveVersions.length === 0) {
    throw failClosed(
      `no effective compensation version found for worker ${workerId} (org=${organizationId} bu=${businessUnitId})`
    );
  }
  if (effectiveVersions.length > 1) {
    throw failClosed(
      `multiple genuinely effective compensation versions found for worker ${workerId} (count=${effectiveVersions.length}); cannot determine single effective version`
    );
  }
  return effectiveVersions[0];
}

// ── Finance core pass evaluation ──────────────────────────────────────────────

function evaluateFinanceCorePass(financeStatus, payable) {
  if (!financeStatus) return { pass: false, reason: "no finance status" };
  if (!financeStatus.billing_ready) return { pass: false, reason: "billing_ready is false" };
  if (!financeStatus.invoice_request_id) return { pass: false, reason: "invoice_request_id is null" };
  if ((financeStatus.payment_count ?? 0) < 1) return { pass: false, reason: "payment_count < 1" };
  if (!payable) return { pass: false, reason: "no contractor payable" };
  if (!["approved", "paid"].includes(payable.payable_status)) {
    return { pass: false, reason: `payable_status is ${payable.payable_status}` };
  }
  if (!financeStatus.profitability_snapshot_id) return { pass: false, reason: "profitability_snapshot_id is null" };
  if (financeStatus.gross_contribution == null) return { pass: false, reason: "gross_contribution is null" };
  if (financeStatus.gross_margin_percent == null) return { pass: false, reason: "gross_margin_percent is null" };
  return { pass: true };
}

// ── Main exported runner ──────────────────────────────────────────────────────

/**
 * Load existing canonical Wave 5 state and advance exactly one gate.
 *
 * @param {object} params
 * @param {string}  params.operationalJobId         – canonical operational_job.id
 * @param {string}  params.approverAppUserId        – owner/admin app_user.id
 * @param {number}  [params.basisValue]             – hours or revenue basis (0 for flat)
 * @param {number}  [params.otherDirectCost]        – default 0
 * @param {string}  [params.directCostSourceReference] – required when otherDirectCost > 0
 * @param {string}  params.accessToken              – valid JWT (kept for backward-compat signature; session token used for refresh)
 * @returns {object} { gate, result, status }
 *   gate:   which gate was executed (string) or null if no gate ran
 *   result: the record returned by the mutation (if applicable)
 *   status: current Wave 5 finance status after the gate
 */
export async function runWave5NextGate(params) {
  if (!isWave5PilotEnabled()) {
    throw failClosed("Wave 5 pilot is not enabled (VITE_SERVICEOS_FINANCE_ENABLED and VITE_SERVICEOS_WAVE5_PILOT_UI must both be true)");
  }

  const {
    operationalJobId,
    approverAppUserId,
    basisValue = 0,
    otherDirectCost = 0,
    directCostSourceReference = null,
    accessToken,
  } = params;

  if (!operationalJobId) throw failClosed("operationalJobId required");
  if (!approverAppUserId) throw failClosed("approverAppUserId required");
  if (!accessToken) throw failClosed("accessToken required");

  // ── 1. Load canonical operational job and derive scope ──
  const job = await fetchOperationalJobById(operationalJobId, accessToken);
  if (!job) throw failClosed(`operational_job not found (id=${operationalJobId})`);

  const organizationId = job.organization_id;
  const businessUnitId = job.business_unit_id;
  if (!organizationId) throw failClosed("operational_job.organization_id is null");
  if (!businessUnitId) throw failClosed("operational_job.business_unit_id is null");

  const scope = { organizationId, businessUnitId };

  // ── 2. Load work order and validate lineage ──
  const workOrder = await fetchWorkOrderForJob(operationalJobId, accessToken);
  if (!workOrder) throw failClosed(`work_order not found for job ${operationalJobId}`);
  if (workOrder.organization_id && workOrder.organization_id !== organizationId) {
    throw failClosed(`work_order.organization_id mismatch: job=${organizationId}, wo=${workOrder.organization_id}`);
  }
  if (workOrder.business_unit_id && workOrder.business_unit_id !== businessUnitId) {
    throw failClosed(`work_order.business_unit_id mismatch: job=${businessUnitId}, wo=${workOrder.business_unit_id}`);
  }

  // ── 3. Load assignments — fail closed on multiple acknowledged/completed ──
  const allAssignments = await fetchAssignmentsForJob(operationalJobId, accessToken);
  const liveAssignments = (allAssignments || []).filter((a) =>
    ["acknowledged", "completed"].includes(a.assignment_status)
  );
  if (liveAssignments.length === 0) {
    throw failClosed("no acknowledged/completed assignment found for this job");
  }
  if (liveAssignments.length > 1) {
    throw failClosed(
      `multiple active/completed assignments found (count=${liveAssignments.length}); cannot proceed`
    );
  }
  const assignment = liveAssignments[0];

  // ── 4. Gate a: complete acknowledged assignment ──
  if (assignment.assignment_status === "acknowledged") {
    const completed = await updateWorkerAssignmentStatus(
      assignment.id,
      "completed",
      accessToken,
      approverAppUserId
    );
    const status = await loadWave5FinanceStatus(operationalJobId, { accessToken });
    return { gate: "complete_assignment", result: completed, status };
  }

  // assignment is completed from here on
  if (assignment.assignment_status !== "completed") {
    throw failClosed(`unexpected assignment status: ${assignment.assignment_status}`);
  }

  // ── 5. Validate assignment lineage ──
  if (assignment.organization_id && assignment.organization_id !== organizationId) {
    throw failClosed(`worker_assignment.organization_id mismatch: job=${organizationId}, wa=${assignment.organization_id}`);
  }

  // ── 6. Load payables ──
  const allPayables = await fetchContractorPayablesByJobId(operationalJobId, accessToken);
  const assignmentPayables = (allPayables || []).filter(
    (p) => p.worker_assignment_id === assignment.id
  );

  if (assignmentPayables.length > 1) {
    throw failClosed(
      `multiple payables found for assignment ${assignment.id} (count=${assignmentPayables.length})`
    );
  }

  // ── 7. Gate b: create payable if none exists ──
  if (assignmentPayables.length === 0) {
    const workerId = assignment.worker_id;
    if (!workerId) throw failClosed("assignment has no worker_id");

    // Resolve single effective compensation version
    const serviceCompletedAt = workOrder.service_completed_at ?? null;
    const serviceFamily = job.service_family ?? null;
    const compensationVersion = await resolveEffectiveCompensationVersion(
      workerId,
      organizationId,
      businessUnitId,
      serviceFamily,
      serviceCompletedAt
    );

    // Validate compensation version lineage
    if (compensationVersion.organization_id && compensationVersion.organization_id !== organizationId) {
      throw failClosed(`compensation_version.organization_id mismatch`);
    }

    // For flat_amount compensation, basis_value must resolve to 0
    const resolvedBasisValue =
      compensationVersion.compensation_method === "flat_amount" ? 0 : Number(basisValue ?? 0);

    const payable = await createPayableForAssignment(
      scope,
      assignment,
      job,
      workOrder,
      compensationVersion,
      resolvedBasisValue,
      { accessToken, appUserId: approverAppUserId }
    );

    // Validate created payable lineage
    if (payable.organization_id && payable.organization_id !== organizationId) {
      throw failClosed("created payable.organization_id lineage mismatch");
    }

    const status = await loadWave5FinanceStatus(operationalJobId, { accessToken });
    return { gate: "create_payable", result: payable, status };
  }

  const payable = assignmentPayables[0];

  // Validate payable lineage
  if (payable.organization_id && payable.organization_id !== organizationId) {
    throw failClosed(`payable.organization_id mismatch: job=${organizationId}, payable=${payable.organization_id}`);
  }

  // ── 8. Gate c: approve pending payable ──
  if (payable.payable_status === "pending") {
    const approved = await approveContractorPayable(
      payable.id,
      approverAppUserId,
      accessToken
    );
    const status = await loadWave5FinanceStatus(operationalJobId, { accessToken });
    return { gate: "approve_payable", result: approved, status };
  }

  // ── 9. Gate d: capture profitability (payable approved or paid) ──
  if (!["approved", "paid"].includes(payable.payable_status)) {
    throw failClosed(
      `payable has unexpected status ${payable.payable_status}; expected pending, approved, or paid`
    );
  }

  const profitability = await fetchJobProfitabilitySnapshotByJobId(
    operationalJobId,
    accessToken
  );

  if (!profitability) {
    // Load invoice request for profitability capture
    const invoiceRes = await authenticatedRestFetchWithRefresh(
      `invoice_request?operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=created_at.desc&limit=1`
    );
    if (!invoiceRes || !invoiceRes.ok) {
      throw failClosed("failed to load invoice_request for profitability capture");
    }
    const invoiceRows = await invoiceRes.json();
    const invoiceRequest = Array.isArray(invoiceRows) ? invoiceRows[0] ?? null : null;
    if (!invoiceRequest) {
      throw failClosed(`invoice_request not found for job ${operationalJobId}`);
    }

    // Lineage guard
    if (invoiceRequest.operational_job_id !== operationalJobId) {
      throw failClosed("invoice_request.operational_job_id lineage mismatch");
    }
    if (invoiceRequest.organization_id && invoiceRequest.organization_id !== organizationId) {
      throw failClosed(`invoice_request.organization_id mismatch: job=${organizationId}, ir=${invoiceRequest.organization_id}`);
    }

    const snapshot = await captureJobProfitabilitySnapshot(
      scope,
      invoiceRequest,
      {
        accessToken,
        appUserId: approverAppUserId,
        otherDirectCost: Number(otherDirectCost ?? 0),
        directCostSourceReference: directCostSourceReference ?? null,
      }
    );
    const status = await loadWave5FinanceStatus(operationalJobId, { accessToken });
    return { gate: "capture_profitability", result: snapshot, status };
  }

  // ── 10. Gate e: evaluate finance core pass ──
  const status = await loadWave5FinanceStatus(operationalJobId, { accessToken });
  const { pass: financeCorePass } = evaluateFinanceCorePass(status, payable);
  if (financeCorePass) {
    return {
      gate: "finance_core_pass",
      result: null,
      status,
      financeCoreStatus: "pass",
      nextGate: null,
    };
  }
  return { gate: "verify_status", result: status, status };
}

/**
 * Load the current Wave 5 canonical state for a job without mutating anything.
 *
 * Returns a summary object describing current gate position and next recommended action.
 *
 * @param {string} operationalJobId
 * @param {string} accessToken
 * @returns {object} { assignment, compensationVersion, payable, profitability, financeStatus, nextGate, financeCoreStatus, blockerReason }
 */
export async function loadWave5AcceptanceState(operationalJobId, accessToken) {
  if (!operationalJobId) throw new Error("loadWave5AcceptanceState: operationalJobId required");
  if (!accessToken) throw new Error("loadWave5AcceptanceState: accessToken required");

  let assignment = null;
  let compensationVersion = null;
  let payable = null;
  let profitability = null;
  let financeStatus = null;
  let nextGate = null;
  let financeCoreStatus = null;
  let blockerReason = null;

  try {
    const allAssignments = await fetchAssignmentsForJob(operationalJobId, accessToken);
    const liveAssignments = (allAssignments || []).filter((a) =>
      ["acknowledged", "completed"].includes(a.assignment_status)
    );

    if (liveAssignments.length > 1) {
      blockerReason = `multiple active/completed assignments (count=${liveAssignments.length})`;
      return { assignment: null, compensationVersion: null, payable: null, profitability: null, financeStatus: null, nextGate: null, financeCoreStatus: null, blockerReason };
    }

    assignment = liveAssignments[0] ?? null;

    if (!assignment) {
      blockerReason = "no acknowledged/completed assignment found";
      return { assignment: null, compensationVersion: null, payable: null, profitability: null, financeStatus: null, nextGate: null, financeCoreStatus: null, blockerReason };
    }

    if (assignment.assignment_status === "acknowledged") {
      nextGate = "complete_assignment";
    } else {
      const allPayables = await fetchContractorPayablesByJobId(operationalJobId, accessToken);
      const assignmentPayables = (allPayables || []).filter(
        (p) => p.worker_assignment_id === assignment.id
      );

      if (assignmentPayables.length > 1) {
        blockerReason = `multiple payables for assignment ${assignment.id}`;
      } else {
        payable = assignmentPayables[0] ?? null;

        // Load compensation version for display if payable has one
        if (payable?.contractor_compensation_version_id) {
          try {
            const cvRes = await authenticatedRestFetchWithRefresh(
              `contractor_compensation_version?id=eq.${encodeURIComponent(payable.contractor_compensation_version_id)}&limit=1`
            );
            if (cvRes && cvRes.ok) {
              const cvRows = await cvRes.json();
              compensationVersion = Array.isArray(cvRows) ? cvRows[0] ?? null : null;
            }
          } catch {
            // non-fatal
          }
        }

        if (!payable) {
          nextGate = "create_payable";
        } else if (payable.payable_status === "pending") {
          nextGate = "approve_payable";
        } else if (["approved", "paid"].includes(payable.payable_status)) {
          profitability = await fetchJobProfitabilitySnapshotByJobId(operationalJobId, accessToken);
          if (!profitability) {
            nextGate = "capture_profitability";
          } else {
            financeStatus = await loadWave5FinanceStatus(operationalJobId, { accessToken });
            const { pass } = evaluateFinanceCorePass(financeStatus, payable);
            if (pass) {
              financeCoreStatus = "pass";
              nextGate = null;
            } else {
              nextGate = "verify_status";
            }
            return { assignment, compensationVersion, payable, profitability, financeStatus, nextGate, financeCoreStatus, blockerReason };
          }
        } else {
          blockerReason = `unexpected payable status: ${payable.payable_status}`;
        }
      }
    }

    financeStatus = await loadWave5FinanceStatus(operationalJobId, { accessToken });
  } catch (err) {
    blockerReason = err.message;
  }

  return { assignment, compensationVersion, payable, profitability, financeStatus, nextGate, financeCoreStatus, blockerReason };
}
