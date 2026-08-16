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
} from "./serviceosOperationsClient.js";

import {
  fetchActiveCompensationVersionForWorker,
  fetchContractorPayablesByJobId,
  fetchJobProfitabilitySnapshotByJobId,
} from "./serviceosWave5FinanceClient.js";

import {
  createPayableForAssignment,
  approveContractorPayable,
  captureJobProfitabilitySnapshot,
  loadWave5FinanceStatus,
} from "./serviceosWave5Runtime.js";

import { authenticatedRestFetch } from "./serviceosAuthClient.js";

// ── Internal helpers ──────────────────────────────────────────────────────────

function failClosed(reason) {
  const err = new Error(`Wave5AcceptanceRunner [FAIL CLOSED]: ${reason}`);
  err.failClosed = true;
  err.blockerReason = reason;
  return err;
}

async function completeAssignment(assignment, accessToken) {
  const res = await authenticatedRestFetch(
    `worker_assignment?id=eq.${encodeURIComponent(assignment.id)}`,
    accessToken,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        assignment_status: "completed",
        completed_at: new Date().toISOString(),
      }),
    }
  );
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `completeAssignment: PATCH failed for id=${assignment.id}: HTTP ${res?.status} ${text}`
    );
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

// ── Main exported runner ──────────────────────────────────────────────────────

/**
 * Load existing canonical Wave 5 state and advance exactly one gate.
 *
 * @param {object} params
 * @param {string}  params.operationalJobId         – canonical operational_job.id
 * @param {string}  params.organizationId           – canonical organization.id
 * @param {string}  params.businessUnitId           – canonical business_unit.id
 * @param {string}  params.approverAppUserId        – owner/admin app_user.id
 * @param {number}  [params.basisValue]             – hours or revenue basis (0 for flat)
 * @param {number}  [params.otherDirectCost]        – default 0
 * @param {string}  [params.directCostSourceReference] – required when otherDirectCost > 0
 * @param {string}  params.accessToken              – valid JWT
 * @returns {object} { gate, result, status }
 *   gate:   which gate was executed (string) or null if no gate ran
 *   result: the record returned by the mutation (if applicable)
 *   status: current Wave 5 finance status after the gate
 */
export async function runWave5NextGate(params) {
  const {
    operationalJobId,
    organizationId,
    businessUnitId,
    approverAppUserId,
    basisValue = 0,
    otherDirectCost = 0,
    directCostSourceReference = null,
    accessToken,
  } = params;

  if (!operationalJobId) throw failClosed("operationalJobId required");
  if (!organizationId) throw failClosed("organizationId required");
  if (!businessUnitId) throw failClosed("businessUnitId required");
  if (!approverAppUserId) throw failClosed("approverAppUserId required");
  if (!accessToken) throw failClosed("accessToken required");

  const scope = { organizationId, businessUnitId };

  // ── 1. Load canonical operational job ──
  const job = await fetchOperationalJobById(operationalJobId, accessToken);
  if (!job) throw failClosed(`operational_job not found (id=${operationalJobId})`);

  // ── 2. Org/BU lineage guard ──
  if (job.organization_id && job.organization_id !== organizationId) {
    throw failClosed(
      `operational_job.organization_id mismatch: expected ${organizationId}, got ${job.organization_id}`
    );
  }

  // ── 3. Load work order ──
  const workOrder = await fetchWorkOrderForJob(operationalJobId, accessToken);
  if (!workOrder) throw failClosed(`work_order not found for job ${operationalJobId}`);

  // ── 4. Load assignments — fail closed on multiple active/completed ──
  const allAssignments = await fetchAssignmentsForJob(operationalJobId, accessToken);
  const liveAssignments = (allAssignments || []).filter((a) =>
    ["acknowledged", "active", "completed"].includes(a.assignment_status)
  );
  if (liveAssignments.length === 0) {
    throw failClosed("no acknowledged/active/completed assignment found for this job");
  }
  if (liveAssignments.length > 1) {
    throw failClosed(
      `multiple active/completed assignments found (count=${liveAssignments.length}); cannot proceed`
    );
  }
  const assignment = liveAssignments[0];

  // ── 5. Gate a: complete acknowledged assignment ──
  if (assignment.assignment_status === "acknowledged") {
    const completed = await completeAssignment(assignment, accessToken);
    const status = await loadWave5FinanceStatus(operationalJobId, { accessToken });
    return { gate: "complete_assignment", result: completed, status };
  }

  // assignment is completed from here on
  if (assignment.assignment_status !== "completed") {
    throw failClosed(`unexpected assignment status: ${assignment.assignment_status}`);
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

    // Load effective compensation versions — fail closed if ambiguous
    const versionsRes = await authenticatedRestFetch(
      `contractor_compensation_version?worker_id=eq.${encodeURIComponent(workerId)}&organization_id=eq.${encodeURIComponent(organizationId)}&compensation_status=in.(approved,active)&order=effective_from.desc`,
      accessToken
    );
    if (!versionsRes || !versionsRes.ok) {
      throw failClosed("failed to load compensation versions");
    }
    const versions = await versionsRes.json();
    const effectiveVersions = Array.isArray(versions) ? versions : [];

    if (effectiveVersions.length === 0) {
      throw failClosed(
        `no approved/active compensation version found for worker ${workerId}`
      );
    }
    if (effectiveVersions.length > 1) {
      throw failClosed(
        `multiple approved/active compensation versions found for worker ${workerId} (count=${effectiveVersions.length}); cannot determine single effective version`
      );
    }

    const compensationVersion = effectiveVersions[0];

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
    const status = await loadWave5FinanceStatus(operationalJobId, { accessToken });
    return { gate: "create_payable", result: payable, status };
  }

  const payable = assignmentPayables[0];

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
    const invoiceRes = await authenticatedRestFetch(
      `invoice_request?operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=created_at.desc&limit=1`,
      accessToken
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

  // ── 10. Gate e: verify finance status ──
  const status = await loadWave5FinanceStatus(operationalJobId, { accessToken });
  return { gate: "verify_status", result: status, status };
}

/**
 * Load the current Wave 5 canonical state for a job without mutating anything.
 *
 * Returns a summary object describing current gate position and next recommended action.
 *
 * @param {string} operationalJobId
 * @param {string} accessToken
 * @returns {object} { assignment, payable, profitability, financeStatus, nextGate, blockerReason }
 */
export async function loadWave5AcceptanceState(operationalJobId, accessToken) {
  if (!operationalJobId) throw new Error("loadWave5AcceptanceState: operationalJobId required");
  if (!accessToken) throw new Error("loadWave5AcceptanceState: accessToken required");

  let assignment = null;
  let payable = null;
  let profitability = null;
  let financeStatus = null;
  let nextGate = null;
  let blockerReason = null;

  try {
    const allAssignments = await fetchAssignmentsForJob(operationalJobId, accessToken);
    const liveAssignments = (allAssignments || []).filter((a) =>
      ["acknowledged", "active", "completed"].includes(a.assignment_status)
    );

    if (liveAssignments.length > 1) {
      blockerReason = `multiple active/completed assignments (count=${liveAssignments.length})`;
      return { assignment: null, payable: null, profitability: null, financeStatus: null, nextGate: null, blockerReason };
    }

    assignment = liveAssignments[0] ?? null;

    if (!assignment) {
      blockerReason = "no acknowledged/active/completed assignment found";
      return { assignment: null, payable: null, profitability: null, financeStatus: null, nextGate: null, blockerReason };
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

        if (!payable) {
          nextGate = "create_payable";
        } else if (payable.payable_status === "pending") {
          nextGate = "approve_payable";
        } else if (["approved", "paid"].includes(payable.payable_status)) {
          profitability = await fetchJobProfitabilitySnapshotByJobId(operationalJobId, accessToken);
          if (!profitability) {
            nextGate = "capture_profitability";
          } else {
            nextGate = "verify_status";
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

  return { assignment, payable, profitability, financeStatus, nextGate, blockerReason };
}
