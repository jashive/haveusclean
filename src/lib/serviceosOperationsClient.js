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

function encodeInList(values) {
  return values.map((v) => encodeURIComponent(v)).join(",");
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

export async function fetchEligibleJobHandoffs(accessToken) {
  assertEnabled();

  const handoffs = await fetchMany(
    "job_handoff",
    [
      "select=id,organization_id,business_unit_id,conversion_record_id,quote_version_id,pricing_snapshot_id,handoff_status,handed_off_at,created_at,metadata",
      "handoff_status=eq.ready",
      "order=handed_off_at.desc.nullslast,created_at.desc.nullslast",
      "limit=20",
    ].join("&"),
    accessToken
  );

  if (!Array.isArray(handoffs) || handoffs.length === 0) return [];

  const handoffIds = handoffs.map((h) => h?.id).filter(Boolean);
  if (handoffIds.length === 0) return [];

  const usedRows = await fetchMany(
    "operational_job",
    `select=job_handoff_id&job_handoff_id=in.(${encodeInList(handoffIds)})`,
    accessToken
  );
  const usedHandoffIds = new Set(
    Array.isArray(usedRows) ? usedRows.map((row) => row?.job_handoff_id).filter(Boolean) : []
  );

  return handoffs.filter((handoff) => !usedHandoffIds.has(handoff?.id));
}

export async function fetchActiveWorkers(accessToken) {
  assertEnabled();
  const workers = await fetchMany(
    "worker",
    [
      "select=id,organization_id,business_unit_id,worker_type,display_name,email,status,metadata",
      "status=eq.active",
      "order=display_name.asc,id.asc",
      "limit=100",
    ].join("&"),
    accessToken
  );
  return Array.isArray(workers) ? workers : [];
}

export function isWorkerScopeCompatibleWithHandoff(worker, handoff) {
  if (!worker || !handoff) return false;
  if (!worker.organization_id || !handoff.organization_id) return false;
  if (worker.organization_id !== handoff.organization_id) return false;
  if (worker.business_unit_id == null) return true;
  return worker.business_unit_id === handoff.business_unit_id;
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
  };
  return updateById("operational_handoff", id, patch, accessToken);
}

// ── Legacy workforce bootstrap (Preview-only, read + explicit promote) ────────
//
// fetchLegacyWorkerCandidates: GET-only read from huc_partners.
//   Returns safe identification fields only — PIN and other secrets are never
//   included.  Candidates already promoted to canonical worker are excluded.
//
// promoteWorkerToCanonical: Creates ONE canonical worker from a selected legacy
//   candidate.  Requires an explicit caller-driven action — never auto-invoked.
//   Is idempotent: returns the existing worker if this source was already
//   promoted (matched by source lineage metadata or email).
//   Does NOT create operational_job, schedule_window, work_order, or any other
//   Wave 3 operational records.
//   Does NOT modify the selected job_handoff.
//   Does NOT modify or delete the huc_partners row.

export async function fetchLegacyWorkerCandidates(accessToken) {
  assertEnabled();

  // Read safe identification fields from legacy huc_partners.
  // huc_partners stores profile data in a `data` JSONB column.
  const rows = await fetchMany(
    "huc_partners",
    "select=id,data&order=id.asc&limit=50",
    accessToken
  );
  if (!Array.isArray(rows)) return [];

  // Extract already-promoted source_record_ids so they can be filtered out.
  const promotedRows = await fetchMany(
    "worker",
    "select=metadata&metadata->>bootstrap_reason=eq.wave3_preview_pilot&limit=200",
    accessToken
  );
  const promotedSourceIds = new Set(
    Array.isArray(promotedRows)
      ? promotedRows
          .map((r) => r?.metadata?.source_record_id)
          .filter(Boolean)
          .map(String)
      : []
  );

  return rows
    .map((row) => {
      if (!row?.id) return null;
      const d = row.data ?? {};
      // Do NOT include pin or other secret fields
      return {
        source_id: String(row.id),
        name: d.name ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        partner_type: d.partner_type ?? d.type ?? null,
      };
    })
    .filter(Boolean)
    .filter((c) => !promotedSourceIds.has(c.source_id));
}

async function _findExistingCanonicalWorkerForSource(sourceId, email, accessToken) {
  // Check by source lineage first (metadata.source_record_id)
  if (sourceId) {
    const byLineage = await fetchMany(
      "worker",
      `select=id,organization_id,business_unit_id,worker_type,display_name,email,status,metadata&metadata->>source_record_id=eq.${encodeURIComponent(sourceId)}&limit=1`,
      accessToken
    );
    if (Array.isArray(byLineage) && byLineage.length > 0 && byLineage[0]?.id) {
      return byLineage[0];
    }
  }
  // Check by email as additional dedup guard
  if (email) {
    const byEmail = await fetchMany(
      "worker",
      `select=id,organization_id,business_unit_id,worker_type,display_name,email,status,metadata&email=eq.${encodeURIComponent(email)}&limit=1`,
      accessToken
    );
    if (Array.isArray(byEmail) && byEmail.length > 0 && byEmail[0]?.id) {
      return byEmail[0];
    }
  }
  return null;
}

// @param {object} candidate   Safe candidate from fetchLegacyWorkerCandidates
// @param {object} handoff     Canonical job_handoff supplying org + BU scope
// @param {string} accessToken
// @param {string|null} appUserId
// @returns {{ worker: object, wasExisting: boolean }}
export async function promoteWorkerToCanonical(candidate, handoff, accessToken, appUserId) {
  assertEnabled();

  if (!candidate?.source_id) {
    throw new Error("promoteWorkerToCanonical: candidate.source_id is required");
  }
  if (!handoff?.organization_id) {
    throw new Error("promoteWorkerToCanonical: handoff.organization_id is required");
  }
  if (!handoff?.business_unit_id) {
    throw new Error("promoteWorkerToCanonical: handoff.business_unit_id is required");
  }
  if (!accessToken) {
    throw new Error("promoteWorkerToCanonical: accessToken is required");
  }

  // Idempotency: return existing canonical worker if this legacy record was
  // already promoted (matched via source lineage or email).
  const existing = await _findExistingCanonicalWorkerForSource(
    candidate.source_id,
    candidate.email ?? null,
    accessToken
  );
  if (existing) {
    // Validate scope before accepting: existing worker must belong to the same
    // organization, and its BU must be null (enterprise/global) or match exactly.
    const orgMatch = existing.organization_id === handoff.organization_id;
    const buMatch =
      existing.business_unit_id == null ||
      existing.business_unit_id === handoff.business_unit_id;
    if (!orgMatch || !buMatch) {
      throw new Error(
        "Existing canonical worker match is outside the selected handoff organization/business-unit scope; promotion blocked."
      );
    }
    return { worker: existing, wasExisting: true };
  }

  // Fail closed if the legacy candidate has no real display name.
  // Do NOT fabricate placeholder personal data.
  if (!candidate.name || !candidate.name.trim()) {
    throw new Error(
      "Selected legacy worker candidate has no real display name; canonical promotion blocked."
    );
  }

  // Build canonical worker payload from real source fields only.
  // worker_type defaults conservatively to contractor per spec.
  const workerPayload = {
    organization_id: handoff.organization_id,
    business_unit_id: handoff.business_unit_id,
    worker_type: "contractor",
    display_name: candidate.name,
    status: "active",
    metadata: {
      source_system: "huc_partners",
      source_record_id: candidate.source_id,
      bootstrap_reason: "wave3_preview_pilot",
      migration_mode: "controlled_preview_bootstrap",
      ...(appUserId ? { promoted_by_app_user_id: appUserId } : {}),
      promoted_at: new Date().toISOString(),
    },
  };
  if (candidate.email) workerPayload.email = candidate.email;
  if (candidate.phone) workerPayload.phone = candidate.phone;

  const newWorker = await insertOne("worker", workerPayload, accessToken);
  return { worker: newWorker, wasExisting: false };
}

// ── Pilot cleanup ─────────────────────────────────────────────────────────────
//
// Deletes ONLY mutable rows created by the current pilot session.
// Deletion order respects FK dependencies (children first).
// Does NOT delete upstream Wave 1/2 tables:
//   job_handoff, conversion_record, quote_version, pricing_snapshot,
//   customer, contact, service_location, worker
//
// Append-only canonical tables — NEVER DELETED:
//   work_order_event, completion_evidence
//
// If a pilot session contains any append-only records, cleanup returns a
// retained_test_evidence result without beginning any destructive work.
//
// @param {object} createdIds  Map of entity → { id }
// @param {string} accessToken
// @returns {true | { mode: "retained_test_evidence", immutableRecordsRetained: Array,
//                    mutableRecordsRetained: Array, upstreamPreserved: boolean }}

export async function cleanupOperationsPilotSession(createdIds, accessToken) {
  assertEnabled();

  // Collect every append-only record present in this session.
  // These are canonical records and must remain immutable — never delete them.
  const IMMUTABLE_EVENT_KEYS = [
    "workOrderEventCompleted",
    "workOrderEventWorkStarted",
    "workOrderEventArrived",
    "workOrderEventDispatched",
    "workOrderEventAckd",
    "workOrderEventAssigned",
    "workOrderEventScheduled",
    "workOrderEvent",
  ];
  const IMMUTABLE_EVIDENCE_KEYS = ["completionEvidence", "completionEvidences"];

  const immutableRecordsRetained = [];
  for (const key of IMMUTABLE_EVENT_KEYS) {
    const val = createdIds[key];
    if (val?.id) immutableRecordsRetained.push({ table: "work_order_event", id: val.id });
  }
  for (const key of IMMUTABLE_EVIDENCE_KEYS) {
    const val = createdIds[key];
    if (Array.isArray(val)) {
      for (const row of val) {
        if (row?.id) immutableRecordsRetained.push({ table: "completion_evidence", id: row.id });
      }
    } else if (val?.id) {
      immutableRecordsRetained.push({ table: "completion_evidence", id: val.id });
    }
  }

  // If any append-only records exist, this is a completed E2E run.
  // Do NOT begin partial destructive cleanup — return a governed retention result.
  if (immutableRecordsRetained.length > 0) {
    const mutableRecordsRetained = [];
    for (const key of [
      "operationalHandoff",
      "correctiveAction",
      "qaInspection",
      "checklistResult",
      "checklistResults",
      "workOrder",
      "workerAssignment",
      "scheduleWindow",
      "operationalJob",
    ]) {
      const val = createdIds[key];
      if (Array.isArray(val)) {
        for (const row of val) {
          if (row?.id) mutableRecordsRetained.push({ table: key, id: row.id });
        }
      } else if (val?.id) {
        mutableRecordsRetained.push({ table: key, id: val.id });
      }
    }
    return {
      mode: "retained_test_evidence",
      immutableRecordsRetained,
      mutableRecordsRetained,
      upstreamPreserved: true,
    };
  }

  // No append-only records — safe to attempt mutable record deletion.
  // Reverse FK dependency order (children first), excluding append-only tables.
  const order = [
    { table: "operational_handoff", key: "operationalHandoff" },
    { table: "corrective_action", key: "correctiveAction" },
    { table: "qa_inspection", key: "qaInspection" },
    { table: "service_checklist_result", key: "checklistResult" },
    { table: "service_checklist_result", key: "checklistResults", multi: true },
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

// ── Exact-ID pilot session verifier ───────────────────────────────────────────
//
// Performs authenticated GET-only reads for each exact ID from a pilot session.
// Reports whether each record is present or absent — no table scans.
// NO writes. No broad queries.
//
// @param {object} ids  Map of label → id string for all pilot records to verify
// @param {string} accessToken
// @returns {Array<{ label: string, table: string, id: string, status: "present"|"absent"|"error", error?: string }>}

export async function verifyPilotSessionState(ids, accessToken) {
  assertEnabled();

  const TABLE_MAP = {
    operationalJob: "operational_job",
    scheduleWindow: "schedule_window",
    workerAssignment: "worker_assignment",
    workOrder: "work_order",
    workOrderEventArrived: "work_order_event",
    workOrderEventWorkStarted: "work_order_event",
    workOrderEventCompleted: "work_order_event",
    workOrderEvent: "work_order_event",
    completionEvidence: "completion_evidence",
    checklistResult: "service_checklist_result",
    serviceChecklistResult: "service_checklist_result",
    qaInspection: "qa_inspection",
    operationalHandoff: "operational_handoff",
  };

  const results = [];
  for (const [label, rawId] of Object.entries(ids)) {
    // Handle checklistResults as an array or scalar under the same table
    const idsToVerify = label === "checklistResults" && Array.isArray(rawId)
      ? rawId.map((v) => ({ label, id: v?.id ?? v }))
      : [{ label, id: rawId?.id ?? rawId }];

    const table = TABLE_MAP[label];
    if (!table) {
      // Unknown label — never fall back to using the label as a table name
      results.push({ label, table: null, id: String(rawId ?? ""), status: "unsupported" });
      continue;
    }

    for (const { label: entryLabel, id } of idsToVerify) {
      if (!id) continue;
      try {
        const row = await fetchOneById(table, id, accessToken);
        results.push({ label: entryLabel, table, id, status: row ? "present" : "absent" });
      } catch (err) {
        results.push({ label: entryLabel, table, id, status: "error", error: err.message });
      }
    }
  }
  return results;
}
