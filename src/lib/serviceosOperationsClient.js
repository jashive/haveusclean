// ── Wave 3: ServiceOS Operations Client ──────────────────────────────────────
//
// Feature-flagged canonical REST client for the operations pipeline.
// All functions are HARD no-ops when VITE_SERVICEOS_OPERATIONS_ENABLED !== "true".
//
// Uses the same authenticatedRestFetch pattern as serviceosRevenueClient.js.
// Does NOT add @supabase/supabase-js.
//
// Wave 3 tables:
//   operational_job, schedule_window, worker_assignment, work_order,
//   work_order_event, completion_evidence, service_checklist_result,
//   qa_inspection, corrective_action, operational_handoff
//
// Wave 1/2 tables (read-only upstream reads):
//   job_handoff, conversion_record, service_location

import { authenticatedRestFetch } from "./serviceosAuthClient.js";

// ── Feature guard ─────────────────────────────────────────────────────────────

function isOperationsEnabled() {
  try {
    return (
      (typeof import.meta !== "undefined"
        ? import.meta.env?.VITE_SERVICEOS_OPERATIONS_ENABLED
        : "") === "true"
    );
  } catch {
    return false;
  }
}

function assertEnabled() {
  if (!isOperationsEnabled()) {
    throw new Error(
      "ServiceOS operations feature is disabled (VITE_SERVICEOS_OPERATIONS_ENABLED is not true)"
    );
  }
}

// ── Generic helpers ───────────────────────────────────────────────────────────

async function insertOne(table, payload, accessToken) {
  const res = await authenticatedRestFetch(table, accessToken, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Operations insert failed on ${table}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateById(table, id, patch, accessToken) {
  const res = await authenticatedRestFetch(
    `${table}?id=eq.${encodeURIComponent(id)}`,
    accessToken,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    }
  );
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Operations update failed on ${table} id=${id}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function fetchOneById(table, id, accessToken) {
  const res = await authenticatedRestFetch(
    `${table}?id=eq.${encodeURIComponent(id)}&limit=1`,
    accessToken
  );
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Operations fetch failed on ${table} id=${id}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
}

async function fetchMany(table, filter, accessToken) {
  const qs = filter ? `?${filter}` : "";
  const res = await authenticatedRestFetch(`${table}${qs}`, accessToken);
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Operations fetchMany failed on ${table}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  return res.json();
}

async function deleteById(table, id, accessToken) {
  const res = await authenticatedRestFetch(
    `${table}?id=eq.${encodeURIComponent(id)}`,
    accessToken,
    { method: "DELETE" }
  );
  if (!res || !res.ok) {
    const text = await res?.text().catch(() => "");
    throw new Error(
      `Operations delete failed on ${table} id=${id}: HTTP ${res?.status ?? "network error"} ${text}`
    );
  }
  return true;
}

// ── createdRecords helpers ────────────────────────────────────────────────────

export function getOperationsCreatedRecords(error) {
  const created = error?.createdRecords;
  return created && typeof created === "object" ? created : null;
}

export function attachOperationsCreatedRecords(error, createdRecords) {
  const err =
    error instanceof Error
      ? error
      : new Error(String(error ?? "Operations pipeline failed"));
  err.createdRecords = { ...createdRecords };
  return err;
}

// ── CREATE methods ────────────────────────────────────────────────────────────

export async function createOperationalJob(payload, accessToken) {
  assertEnabled();
  return insertOne("operational_job", payload, accessToken);
}

export async function createScheduleWindow(payload, accessToken) {
  assertEnabled();
  return insertOne("schedule_window", payload, accessToken);
}

export async function createWorkerAssignment(payload, accessToken) {
  assertEnabled();
  return insertOne("worker_assignment", payload, accessToken);
}

export async function createWorkOrder(payload, accessToken) {
  assertEnabled();
  return insertOne("work_order", payload, accessToken);
}

export async function createWorkOrderEvent(payload, accessToken) {
  assertEnabled();
  return insertOne("work_order_event", payload, accessToken);
}

export async function createCompletionEvidence(payload, accessToken) {
  assertEnabled();
  return insertOne("completion_evidence", payload, accessToken);
}

export async function createChecklistResult(payload, accessToken) {
  assertEnabled();
  return insertOne("service_checklist_result", payload, accessToken);
}

export async function createQaInspection(payload, accessToken) {
  assertEnabled();
  return insertOne("qa_inspection", payload, accessToken);
}

export async function createCorrectiveAction(payload, accessToken) {
  assertEnabled();
  return insertOne("corrective_action", payload, accessToken);
}

export async function createOperationalHandoff(payload, accessToken) {
  assertEnabled();
  return insertOne("operational_handoff", payload, accessToken);
}

// ── READ methods ──────────────────────────────────────────────────────────────

export async function fetchJobHandoffById(id, accessToken) {
  assertEnabled();
  return fetchOneById("job_handoff", id, accessToken);
}

export async function fetchOperationalJobById(id, accessToken) {
  assertEnabled();
  return fetchOneById("operational_job", id, accessToken);
}

export async function fetchOperationalJobByHandoffId(handoffId, accessToken) {
  assertEnabled();
  const rows = await fetchMany(
    "operational_job",
    `job_handoff_id=eq.${encodeURIComponent(handoffId)}&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function fetchScheduleWindowsForJob(operationalJobId, accessToken) {
  assertEnabled();
  return fetchMany(
    "schedule_window",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=created_at.asc`,
    accessToken
  );
}

export async function fetchAssignmentsForJob(operationalJobId, accessToken) {
  assertEnabled();
  return fetchMany(
    "worker_assignment",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=created_at.asc`,
    accessToken
  );
}

export async function fetchWorkOrderForJob(operationalJobId, accessToken) {
  assertEnabled();
  const rows = await fetchMany(
    "work_order",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function fetchEventsForWorkOrder(workOrderId, accessToken) {
  assertEnabled();
  return fetchMany(
    "work_order_event",
    `work_order_id=eq.${encodeURIComponent(workOrderId)}&order=event_at.asc`,
    accessToken
  );
}

export async function fetchEvidenceForWorkOrder(workOrderId, accessToken) {
  assertEnabled();
  return fetchMany(
    "completion_evidence",
    `work_order_id=eq.${encodeURIComponent(workOrderId)}&order=captured_at.asc`,
    accessToken
  );
}

export async function fetchChecklistForWorkOrder(workOrderId, accessToken) {
  assertEnabled();
  return fetchMany(
    "service_checklist_result",
    `work_order_id=eq.${encodeURIComponent(workOrderId)}&order=created_at.asc`,
    accessToken
  );
}

export async function fetchQaInspectionsForJob(operationalJobId, accessToken) {
  assertEnabled();
  return fetchMany(
    "qa_inspection",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=created_at.asc`,
    accessToken
  );
}

export async function fetchCorrectiveActionsForJob(operationalJobId, accessToken) {
  assertEnabled();
  return fetchMany(
    "corrective_action",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&order=created_at.asc`,
    accessToken
  );
}

export async function fetchOperationalHandoffForJob(operationalJobId, accessToken) {
  assertEnabled();
  const rows = await fetchMany(
    "operational_handoff",
    `operational_job_id=eq.${encodeURIComponent(operationalJobId)}&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

// ── Upstream lineage reads (Wave 1/2, read-only) ──────────────────────────────

export async function fetchConversionRecordById(id, accessToken) {
  assertEnabled();
  return fetchOneById("conversion_record", id, accessToken);
}

export async function fetchServiceLocationById(id, accessToken) {
  assertEnabled();
  return fetchOneById("service_location", id, accessToken);
}

// ── LIFECYCLE UPDATE methods ──────────────────────────────────────────────────
//
// Each method patches ONLY lifecycle/status-related fields.
// No pricing edits. No quote edits. No pricing_snapshot edits.

const VALID_OJ_STATUSES = [
  "ready_to_schedule",
  "scheduled",
  "dispatched",
  "in_progress",
  "service_complete",
  "qa_pending",
  "qa_passed",
  "corrective_action_required",
  "closed",
  "cancelled",
];

export async function updateOperationalJobStatus(
  id,
  newStatus,
  accessToken,
  appUserId
) {
  assertEnabled();
  if (!VALID_OJ_STATUSES.includes(newStatus)) {
    throw new Error(
      `updateOperationalJobStatus: invalid status "${newStatus}". Valid: ${VALID_OJ_STATUSES.join(", ")}`
    );
  }
  const patch = {
    operational_status: newStatus,
    updated_at: new Date().toISOString(),
    ...(appUserId ? { updated_by_app_user_id: appUserId } : {}),
  };
  return updateById("operational_job", id, patch, accessToken);
}

const VALID_SW_STATUSES = [
  "planned",
  "confirmed",
  "dispatched",
  "fulfilled",
  "cancelled",
  "rescheduled",
];

export async function updateScheduleWindowStatus(
  id,
  newStatus,
  accessToken,
  appUserId
) {
  assertEnabled();
  if (!VALID_SW_STATUSES.includes(newStatus)) {
    throw new Error(
      `updateScheduleWindowStatus: invalid status "${newStatus}". Valid: ${VALID_SW_STATUSES.join(", ")}`
    );
  }
  const patch = {
    status: newStatus,
    updated_at: new Date().toISOString(),
    ...(appUserId ? { updated_by_app_user_id: appUserId } : {}),
  };
  return updateById("schedule_window", id, patch, accessToken);
}

const VALID_WA_STATUSES = [
  "proposed",
  "assigned",
  "acknowledged",
  "declined",
  "released",
  "completed",
  "cancelled",
];

export async function updateWorkerAssignmentStatus(
  id,
  newStatus,
  accessToken,
  appUserId
) {
  assertEnabled();
  if (!VALID_WA_STATUSES.includes(newStatus)) {
    throw new Error(
      `updateWorkerAssignmentStatus: invalid status "${newStatus}". Valid: ${VALID_WA_STATUSES.join(", ")}`
    );
  }
  const now = new Date().toISOString();
  const patch = {
    assignment_status: newStatus,
    updated_at: now,
    ...(newStatus === "assigned" ? { assigned_at: now } : {}),
    ...(newStatus === "acknowledged" ? { acknowledged_at: now } : {}),
    ...(appUserId ? { updated_by_app_user_id: appUserId } : {}),
  };
  return updateById("worker_assignment", id, patch, accessToken);
}

const VALID_WO_STATUSES = [
  "draft",
  "published",
  "in_progress",
  "service_complete",
  "qa_complete",
  "closed",
  "cancelled",
];

export async function updateWorkOrderStatus(
  id,
  newStatus,
  accessToken,
  appUserId
) {
  assertEnabled();
  if (!VALID_WO_STATUSES.includes(newStatus)) {
    throw new Error(
      `updateWorkOrderStatus: invalid status "${newStatus}". Valid: ${VALID_WO_STATUSES.join(", ")}`
    );
  }
  const now = new Date().toISOString();
  const patch = {
    work_order_status: newStatus,
    updated_at: now,
    ...(newStatus === "published" ? { published_at: now } : {}),
    ...(newStatus === "in_progress" ? { started_at: now } : {}),
    ...(newStatus === "service_complete" ? { service_completed_at: now } : {}),
    ...(appUserId ? { updated_by_app_user_id: appUserId } : {}),
  };
  return updateById("work_order", id, patch, accessToken);
}

const VALID_QA_STATUSES = [
  "pending",
  "in_progress",
  "passed",
  "failed",
  "waived",
];

export async function updateQaInspectionStatus(
  id,
  newStatus,
  accessToken,
  appUserId,
  extra
) {
  assertEnabled();
  if (!VALID_QA_STATUSES.includes(newStatus)) {
    throw new Error(
      `updateQaInspectionStatus: invalid status "${newStatus}". Valid: ${VALID_QA_STATUSES.join(", ")}`
    );
  }
  const now = new Date().toISOString();
  const patch = {
    inspection_status: newStatus,
    updated_at: now,
    ...(["passed", "failed", "waived"].includes(newStatus)
      ? { inspected_at: now }
      : {}),
    ...(extra?.score != null ? { score: extra.score } : {}),
    ...(extra?.waiverReason != null ? { waiver_reason: extra.waiverReason } : {}),
    ...(appUserId ? { updated_by_app_user_id: appUserId } : {}),
  };
  return updateById("qa_inspection", id, patch, accessToken);
}

const VALID_CA_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "verified",
  "cancelled",
];

export async function updateCorrectiveActionStatus(
  id,
  newStatus,
  accessToken,
  appUserId
) {
  assertEnabled();
  if (!VALID_CA_STATUSES.includes(newStatus)) {
    throw new Error(
      `updateCorrectiveActionStatus: invalid status "${newStatus}". Valid: ${VALID_CA_STATUSES.join(", ")}`
    );
  }
  const now = new Date().toISOString();
  const patch = {
    action_status: newStatus,
    updated_at: now,
    ...(newStatus === "resolved" ? { resolved_at: now } : {}),
    ...(newStatus === "verified" ? { verified_at: now } : {}),
    ...(appUserId ? { updated_by_app_user_id: appUserId } : {}),
  };
  return updateById("corrective_action", id, patch, accessToken);
}

const VALID_OH_STATUSES = ["ready", "consumed", "cancelled"];

export async function updateOperationalHandoffStatus(
  id,
  newStatus,
  accessToken,
  appUserId
) {
  assertEnabled();
  if (!VALID_OH_STATUSES.includes(newStatus)) {
    throw new Error(
      `updateOperationalHandoffStatus: invalid status "${newStatus}". Valid: ${VALID_OH_STATUSES.join(", ")}`
    );
  }
  const patch = {
    handoff_status: newStatus,
    ...(appUserId ? { updated_by_app_user_id: appUserId } : {}),
  };
  return updateById("operational_handoff", id, patch, accessToken);
}

// ── Pilot cleanup ─────────────────────────────────────────────────────────────
//
// Deletes ONLY rows created by the current pilot session.
// Deletion order respects FK dependencies (children first).
// Does NOT delete upstream Wave 1/2 tables:
//   job_handoff, conversion_record, quote_version, pricing_snapshot,
//   customer, contact, service_location, worker
//
// @param {object} createdIds  Map of entity → { id }
// @param {string} accessToken

export async function cleanupOperationsPilotSession(createdIds, accessToken) {
  assertEnabled();

  // Reverse FK dependency order — Wave 3 records only
  const order = [
    { table: "operational_handoff", key: "operationalHandoff" },
    { table: "corrective_action", key: "correctiveAction" },
    { table: "qa_inspection", key: "qaInspection" },
    { table: "service_checklist_result", key: "checklistResult" },
    // Multiple checklist results stored as array
    { table: "service_checklist_result", key: "checklistResults", multi: true },
    { table: "completion_evidence", key: "completionEvidence" },
    // Multiple evidence stored as array
    { table: "completion_evidence", key: "completionEvidences", multi: true },
    { table: "work_order_event", key: "workOrderEventCompleted" },
    { table: "work_order_event", key: "workOrderEventWorkStarted" },
    { table: "work_order_event", key: "workOrderEventArrived" },
    { table: "work_order_event", key: "workOrderEventDispatched" },
    { table: "work_order_event", key: "workOrderEventAckd" },
    { table: "work_order_event", key: "workOrderEventAssigned" },
    { table: "work_order_event", key: "workOrderEventScheduled" },
    // Generic event key
    { table: "work_order_event", key: "workOrderEvent" },
    { table: "work_order", key: "workOrder" },
    { table: "worker_assignment", key: "workerAssignment" },
    { table: "schedule_window", key: "scheduleWindow" },
    { table: "operational_job", key: "operationalJob" },
  ];

  const errors = [];
  for (const { table, key, multi } of order) {
    if (multi) {
      const arr = createdIds[key];
      if (Array.isArray(arr)) {
        for (const row of arr) {
          if (row?.id) {
            try {
              await deleteById(table, row.id, accessToken);
            } catch (err) {
              errors.push({ table, id: row.id, error: err.message });
            }
          }
        }
      }
    } else {
      const row = createdIds[key];
      if (row?.id) {
        try {
          await deleteById(table, row.id, accessToken);
        } catch (err) {
          errors.push({ table, id: row.id, error: err.message });
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Operations pilot cleanup had ${errors.length} error(s): ${errors
        .map((e) => `${e.table}/${e.id}: ${e.error}`)
        .join("; ")}`
    );
  }
  return true;
}
