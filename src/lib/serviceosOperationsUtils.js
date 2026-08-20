// ── Wave 3: ServiceOS Operations Utils ───────────────────────────────────────
//
// Pure payload builders — no network calls, no import.meta.env dependency.
// All builders use exact M007 column names.
//
// Wave 3 tables covered:
//   operational_job, schedule_window, worker_assignment, work_order,
//   work_order_event, completion_evidence, service_checklist_result,
//   qa_inspection, corrective_action, operational_handoff

// ── Valid enum sets (M007-authoritative) ──────────────────────────────────────

export const OPERATIONAL_JOB_STATUSES = [
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

export const SCHEDULE_WINDOW_STATUSES = [
  "planned",
  "confirmed",
  "dispatched",
  "fulfilled",
  "cancelled",
  "rescheduled",
];

export const ASSIGNMENT_ROLES = [
  "service_worker",
  "team_lead",
  "trainee",
  "inspector",
];

export const ASSIGNMENT_STATUSES = [
  "proposed",
  "assigned",
  "acknowledged",
  "declined",
  "released",
  "completed",
  "cancelled",
];

export const WORK_ORDER_STATUSES = [
  "draft",
  "published",
  "in_progress",
  "service_complete",
  "qa_complete",
  "closed",
  "cancelled",
];

export const WORK_ORDER_EVENT_TYPES = [
  "scheduled",
  "assignment_created",
  "assignment_acknowledged",
  "dispatched",
  "arrived",
  "work_started",
  "paused",
  "resumed",
  "work_completed",
  "completion_submitted",
  "qa_requested",
  "qa_passed",
  "qa_failed",
  "corrective_action_opened",
  "corrective_action_completed",
  "customer_issue_reported",
  "closed",
];

export const EVIDENCE_TYPES = [
  "photo_before",
  "photo_after",
  "photo_detail",
  "note",
  "signature",
  "timestamp",
  "other",
];

export const CHECKLIST_RESULT_STATUSES = [
  "pending",
  "pass",
  "fail",
  "not_applicable",
];

export const QA_INSPECTION_STATUSES = [
  "pending",
  "in_progress",
  "passed",
  "failed",
  "waived",
];

export const QA_INSPECTION_TYPES = [
  "standard",
  "spot_check",
  "customer_issue",
  "reinspection",
];

export const CORRECTIVE_ACTION_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "verified",
  "cancelled",
];

export const CORRECTIVE_ACTION_TYPES = [
  "rework",
  "customer_recovery",
  "safety",
  "documentation",
  "other",
];

export const OPERATIONAL_HANDOFF_STATUSES = ["ready", "consumed", "cancelled"];

export const SERVICE_EXCEPTION_CATEGORIES = [
  "service_quality",
  "safety",
  "access",
  "equipment",
  "documentation",
  "customer_issue",
  "other",
];

export const SERVICE_EXCEPTION_SEVERITIES = ["low", "medium", "high", "critical"];

export const SERVICE_EXCEPTION_SOURCES = [
  "worker",
  "qa",
  "office_ops",
  "system",
  "customer",
  "other",
];

export const SERVICE_EXCEPTION_STATUSES = [
  "reported",
  "triaged",
  "corrective_action_required",
  "ready_for_reinspection",
  "resolved",
  "closed",
  "cancelled",
];

export const CUSTOMER_OUTCOME_TYPES = [
  "praise",
  "complaint",
  "service_issue",
  "reclean_request",
  "damage_concern",
  "resolution",
  "other",
];

export const CUSTOMER_OUTCOME_STATUSES = [
  "reported",
  "acknowledged",
  "investigating",
  "resolved",
  "closed",
  "dismissed",
];

export const CUSTOMER_OUTCOME_SOURCES = [
  "customer",
  "office_ops",
  "qa",
  "worker",
  "system",
  "other",
];

// ── Internal helpers ──────────────────────────────────────────────────────────

function requireField(value, name) {
  if (value === null || value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requireEnum(value, validValues, fieldName) {
  requireField(value, fieldName);
  if (!validValues.includes(value)) {
    throw new Error(
      `${fieldName} must be one of: ${validValues.join(", ")}. Got: ${value}`
    );
  }
  return value;
}

function withJsonObject(value) {
  return value ?? {};
}

function withJsonArray(value, fieldName) {
  const next = value ?? [];
  if (!Array.isArray(next)) {
    throw new Error(`${fieldName} must be an array when provided`);
  }
  return next;
}

function requirePositiveInteger(value, fieldName) {
  requireField(value, fieldName);
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive integer. Got: ${value}`);
  }
  return normalized;
}

// ── 1. operational_job ────────────────────────────────────────────────────────

/**
 * Build an operational_job INSERT payload matching M007 exactly.
 *
 * Required: organizationId, businessUnitId, jurisdictionId, jobHandoffId,
 *   conversionRecordId, quoteVersionId, pricingSnapshotId, customerId,
 *   contactId, serviceLocationId, serviceFamily
 *
 * Does NOT calculate, recalculate, or modify price/tax/quote data.
 * commercialAuthoritySnapshot is reference-only immutable lineage.
 */
export function buildOperationalJobPayload({
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
  serviceFamily,
  operationalStatus,
  serviceScopeSnapshot,
  commercialAuthoritySnapshot,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(jurisdictionId, "jurisdictionId");
  requireField(jobHandoffId, "jobHandoffId");
  requireField(conversionRecordId, "conversionRecordId");
  requireField(quoteVersionId, "quoteVersionId");
  requireField(pricingSnapshotId, "pricingSnapshotId");
  requireField(customerId, "customerId");
  requireField(contactId, "contactId");
  requireField(serviceLocationId, "serviceLocationId");
  requireField(serviceFamily, "serviceFamily");

  const status = operationalStatus ?? "ready_to_schedule";
  requireEnum(status, OPERATIONAL_JOB_STATUSES, "operationalStatus");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    job_handoff_id: jobHandoffId,
    conversion_record_id: conversionRecordId,
    quote_version_id: quoteVersionId,
    pricing_snapshot_id: pricingSnapshotId,
    customer_id: customerId,
    contact_id: contactId,
    service_location_id: serviceLocationId,
    service_family: serviceFamily,
    operational_status: status,
    service_scope_snapshot: withJsonObject(serviceScopeSnapshot),
    commercial_authority_snapshot: withJsonObject(commercialAuthoritySnapshot),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

// ── 2. schedule_window ────────────────────────────────────────────────────────

/**
 * Build a schedule_window INSERT payload matching M007 exactly.
 *
 * Validates scheduledEnd > scheduledStart in JS — does not silently correct.
 */
export function buildScheduleWindowPayload({
  organizationId,
  businessUnitId,
  jurisdictionId,
  operationalJobId,
  scheduledStart,
  scheduledEnd,
  timezone,
  status,
  schedulingNotes,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(jurisdictionId, "jurisdictionId");
  requireField(operationalJobId, "operationalJobId");
  requireField(scheduledStart, "scheduledStart");
  requireField(scheduledEnd, "scheduledEnd");
  requireField(timezone, "timezone");

  const startTs = new Date(scheduledStart).getTime();
  const endTs = new Date(scheduledEnd).getTime();
  if (isNaN(startTs) || isNaN(endTs)) {
    throw new Error("buildScheduleWindowPayload: scheduledStart and scheduledEnd must be valid date values");
  }
  if (endTs <= startTs) {
    throw new Error(
      `buildScheduleWindowPayload: scheduledEnd must be after scheduledStart (start=${scheduledStart}, end=${scheduledEnd})`
    );
  }

  const windowStatus = status ?? "planned";
  requireEnum(windowStatus, SCHEDULE_WINDOW_STATUSES, "status");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    operational_job_id: operationalJobId,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    timezone,
    status: windowStatus,
    ...(schedulingNotes != null ? { scheduling_notes: schedulingNotes } : {}),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

// ── 3. worker_assignment ──────────────────────────────────────────────────────

/**
 * Build a worker_assignment INSERT payload matching M007 exactly.
 * assignment_role: service_worker | team_lead | trainee | inspector
 */
export function buildWorkerAssignmentPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  scheduleWindowId,
  workerId,
  assignmentRole,
  assignmentStatus,
  assignedAt,
  acknowledgedAt,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(scheduleWindowId, "scheduleWindowId");
  requireField(workerId, "workerId");

  const role = assignmentRole ?? "service_worker";
  requireEnum(role, ASSIGNMENT_ROLES, "assignmentRole");

  const astatus = assignmentStatus ?? "proposed";
  requireEnum(astatus, ASSIGNMENT_STATUSES, "assignmentStatus");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    schedule_window_id: scheduleWindowId,
    worker_id: workerId,
    assignment_role: role,
    assignment_status: astatus,
    ...(assignedAt != null ? { assigned_at: assignedAt } : {}),
    ...(acknowledgedAt != null ? { acknowledged_at: acknowledgedAt } : {}),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

// ── 4. work_order ─────────────────────────────────────────────────────────────

/**
 * Build a work_order INSERT payload matching M007 exactly.
 * pricingReferenceSnapshot is reference-only — no repricing.
 */
export function buildWorkOrderPayload({
  organizationId,
  businessUnitId,
  jurisdictionId,
  operationalJobId,
  scheduleWindowId,
  workOrderStatus,
  scopeSnapshot,
  customerInstructionSnapshot,
  accessInstructionSnapshot,
  checklistTemplateSnapshot,
  safetyInstructionSnapshot,
  pricingReferenceSnapshot,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(jurisdictionId, "jurisdictionId");
  requireField(operationalJobId, "operationalJobId");

  const wostatus = workOrderStatus ?? "draft";
  requireEnum(wostatus, WORK_ORDER_STATUSES, "workOrderStatus");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    operational_job_id: operationalJobId,
    ...(scheduleWindowId != null ? { schedule_window_id: scheduleWindowId } : {}),
    work_order_status: wostatus,
    scope_snapshot: withJsonObject(scopeSnapshot),
    customer_instruction_snapshot: withJsonObject(customerInstructionSnapshot),
    access_instruction_snapshot: withJsonObject(accessInstructionSnapshot),
    checklist_template_snapshot: withJsonObject(checklistTemplateSnapshot),
    safety_instruction_snapshot: withJsonObject(safetyInstructionSnapshot),
    pricing_reference_snapshot: withJsonObject(pricingReferenceSnapshot),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

// ── 5. work_order_event (append-only) ─────────────────────────────────────────

/**
 * Build a work_order_event INSERT payload matching M007 exactly.
 * Append-only — no update helper.
 */
export function buildWorkOrderEventPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  workerAssignmentId,
  eventType,
  eventAt,
  actorAppUserId,
  actorWorkerId,
  eventPayload,
  metadata,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");
  requireEnum(eventType, WORK_ORDER_EVENT_TYPES, "eventType");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    ...(workerAssignmentId != null ? { worker_assignment_id: workerAssignmentId } : {}),
    event_type: eventType,
    event_at: eventAt ?? new Date().toISOString(),
    ...(actorAppUserId != null ? { actor_app_user_id: actorAppUserId } : {}),
    ...(actorWorkerId != null ? { actor_worker_id: actorWorkerId } : {}),
    event_payload: withJsonObject(eventPayload),
    metadata: withJsonObject(metadata),
  };
}

// ── 6. completion_evidence (append-only) ──────────────────────────────────────

/**
 * Build a completion_evidence INSERT payload matching M007 exactly.
 * Stores references and metadata only — no binary/base64 payloads.
 */
export function buildCompletionEvidencePayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  workerAssignmentId,
  evidenceType,
  storageSystem,
  storageReference,
  evidencePayload,
  capturedAt,
  capturedByWorkerId,
  capturedByAppUserId,
  metadata,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");
  requireEnum(evidenceType, EVIDENCE_TYPES, "evidenceType");
  requireField(capturedAt, "capturedAt");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    ...(workerAssignmentId != null ? { worker_assignment_id: workerAssignmentId } : {}),
    evidence_type: evidenceType,
    ...(storageSystem != null ? { storage_system: storageSystem } : {}),
    ...(storageReference != null ? { storage_reference: storageReference } : {}),
    evidence_payload: withJsonObject(evidencePayload),
    captured_at: capturedAt,
    ...(capturedByWorkerId != null ? { captured_by_worker_id: capturedByWorkerId } : {}),
    ...(capturedByAppUserId != null ? { captured_by_app_user_id: capturedByAppUserId } : {}),
    metadata: withJsonObject(metadata),
  };
}

// ── 7. service_checklist_result ───────────────────────────────────────────────

/**
 * Build a service_checklist_result INSERT payload matching M007 exactly.
 * result_status: pending | pass | fail | not_applicable
 */
export function buildChecklistResultPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  checklistItemKey,
  checklistItemLabel,
  resultStatus,
  resultPayload,
  completedByWorkerId,
  completedByAppUserId,
  completedAt,
  metadata,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");
  requireField(checklistItemKey, "checklistItemKey");
  requireField(checklistItemLabel, "checklistItemLabel");

  const rstatus = resultStatus ?? "pending";
  requireEnum(rstatus, CHECKLIST_RESULT_STATUSES, "resultStatus");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    checklist_item_key: checklistItemKey,
    checklist_item_label: checklistItemLabel,
    result_status: rstatus,
    result_payload: withJsonObject(resultPayload),
    ...(completedByWorkerId != null ? { completed_by_worker_id: completedByWorkerId } : {}),
    ...(completedByAppUserId != null ? { completed_by_app_user_id: completedByAppUserId } : {}),
    ...(completedAt != null ? { completed_at: completedAt } : {}),
    metadata: withJsonObject(metadata),
  };
}

// ── 8. qa_inspection ──────────────────────────────────────────────────────────

/**
 * Build a qa_inspection INSERT payload matching M007 exactly.
 * inspection_status: pending | in_progress | passed | failed | waived
 * inspection_type:   standard | spot_check | customer_issue | reinspection
 *
 * QA pass/waive and blocking-corrective rules remain database-authoritative.
 */
export function buildQaInspectionPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  inspectorWorkerId,
  inspectorAppUserId,
  inspectionStatus,
  inspectionType,
  score,
  findings,
  inspectedAt,
  waiverReason,
  metadata,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");

  const istatus = inspectionStatus ?? "pending";
  requireEnum(istatus, QA_INSPECTION_STATUSES, "inspectionStatus");

  const itype = inspectionType ?? "standard";
  requireEnum(itype, QA_INSPECTION_TYPES, "inspectionType");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    ...(inspectorWorkerId != null ? { inspector_worker_id: inspectorWorkerId } : {}),
    ...(inspectorAppUserId != null ? { inspector_app_user_id: inspectorAppUserId } : {}),
    inspection_status: istatus,
    inspection_type: itype,
    ...(score != null ? { score } : {}),
    findings: withJsonObject(findings),
    ...(inspectedAt != null ? { inspected_at: inspectedAt } : {}),
    ...(waiverReason != null ? { waiver_reason: waiverReason } : {}),
    metadata: withJsonObject(metadata),
  };
}

// ── 9. corrective_action ──────────────────────────────────────────────────────

/**
 * Build a corrective_action INSERT payload matching M007 exactly.
 * action_status: open | assigned | in_progress | resolved | verified | cancelled
 * action_type:   rework | customer_recovery | safety | documentation | other
 *
 * Does not allow automatic job close from worker-side helper code.
 */
export function buildCorrectiveActionPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  qaInspectionId,
  actionStatus,
  actionType,
  description,
  assignedWorkerId,
  dueAt,
  resolutionPayload,
  resolvedAt,
  verifiedAt,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");
  requireField(description, "description");

  const astatus = actionStatus ?? "open";
  requireEnum(astatus, CORRECTIVE_ACTION_STATUSES, "actionStatus");
  requireEnum(actionType, CORRECTIVE_ACTION_TYPES, "actionType");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    ...(qaInspectionId != null ? { qa_inspection_id: qaInspectionId } : {}),
    action_status: astatus,
    action_type: actionType,
    description,
    ...(assignedWorkerId != null ? { assigned_worker_id: assignedWorkerId } : {}),
    ...(dueAt != null ? { due_at: dueAt } : {}),
    resolution_payload: withJsonObject(resolutionPayload),
    ...(resolvedAt != null ? { resolved_at: resolvedAt } : {}),
    ...(verifiedAt != null ? { verified_at: verifiedAt } : {}),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

// ── 10. operational_handoff ───────────────────────────────────────────────────

/**
 * Build an operational_handoff INSERT payload matching M007 exactly.
 * This is ONLY the Wave 3 → Wave 4 boundary.
 * Does NOT create invoice or payment objects.
 * handoff_status: ready | consumed | cancelled
 */
export function buildOperationalHandoffPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  qaInspectionId,
  pricingSnapshotId,
  quoteVersionId,
  handoffStatus,
  handoffPayload,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");
  requireField(pricingSnapshotId, "pricingSnapshotId");
  requireField(quoteVersionId, "quoteVersionId");

  const hstatus = handoffStatus ?? "ready";
  requireEnum(hstatus, OPERATIONAL_HANDOFF_STATUSES, "handoffStatus");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    ...(qaInspectionId != null ? { qa_inspection_id: qaInspectionId } : {}),
    pricing_snapshot_id: pricingSnapshotId,
    quote_version_id: quoteVersionId,
    handoff_status: hstatus,
    handoff_payload: withJsonObject(handoffPayload),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

// ── Wave 4: required evidence policy ────────────────────────────────────────────

export function buildRequiredEvidencePolicyPayload({
  organizationId,
  businessUnitId,
  jurisdictionId,
  configurationVersionId,
  serviceFamily,
  serviceTaskKey,
  serviceModuleKey,
  requirementKey,
  evidenceType,
  requiredCount,
  isMandatory,
  requiresExternalReference,
  storageRulePayload,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(jurisdictionId, "jurisdictionId");
  requireField(configurationVersionId, "configurationVersionId");
  requireField(serviceFamily, "serviceFamily");
  requireField(requirementKey, "requirementKey");
  requireEnum(evidenceType, EVIDENCE_TYPES, "evidenceType");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    configuration_version_id: configurationVersionId,
    service_family: serviceFamily,
    ...(serviceTaskKey != null ? { service_task_key: serviceTaskKey } : {}),
    ...(serviceModuleKey != null ? { service_module_key: serviceModuleKey } : {}),
    requirement_key: requirementKey,
    evidence_type: evidenceType,
    required_count: requirePositiveInteger(requiredCount ?? 1, "requiredCount"),
    is_mandatory: isMandatory ?? true,
    requires_external_reference: requiresExternalReference ?? false,
    storage_rule_payload: withJsonObject(storageRulePayload),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

export function buildWorkOrderGovernanceLinkPayload({
  organizationId,
  businessUnitId,
  jurisdictionId,
  operationalJobId,
  workOrderId,
  configurationVersionId,
  checklistVersionReference,
  taskDefinitionReference,
  sopReferenceSnapshot,
  governanceSnapshot,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(jurisdictionId, "jurisdictionId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");
  requireField(configurationVersionId, "configurationVersionId");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    configuration_version_id: configurationVersionId,
    ...(checklistVersionReference != null
      ? { checklist_version_reference: checklistVersionReference }
      : {}),
    ...(taskDefinitionReference != null
      ? { task_definition_reference: taskDefinitionReference }
      : {}),
    sop_reference_snapshot: withJsonArray(sopReferenceSnapshot, "sopReferenceSnapshot"),
    governance_snapshot: withJsonObject(governanceSnapshot),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

export function buildWorkOrderWave4ApplicabilityPayload({
  organizationId,
  businessUnitId,
  jurisdictionId,
  operationalJobId,
  workOrderId,
  applicabilityStatus,
  enrollmentSource,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(jurisdictionId, "jurisdictionId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    jurisdiction_id: jurisdictionId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    applicability_status: applicabilityStatus ?? "enrolled",
    enrollment_source: enrollmentSource ?? "governance_link_required",
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

export function buildWorkOrderEvidenceRequirementPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  workOrderGovernanceLinkId,
  requiredEvidencePolicyId,
  sourceConfigurationVersionId,
  serviceTaskKey,
  serviceModuleKey,
  requirementKey,
  evidenceType,
  requiredCount,
  isMandatory,
  requiresExternalReference,
  storageRulePayload,
  qualitySignalPayload,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");
  requireField(workOrderGovernanceLinkId, "workOrderGovernanceLinkId");
  requireField(sourceConfigurationVersionId, "sourceConfigurationVersionId");
  requireField(requirementKey, "requirementKey");
  requireEnum(evidenceType, EVIDENCE_TYPES, "evidenceType");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    work_order_governance_link_id: workOrderGovernanceLinkId,
    ...(requiredEvidencePolicyId != null
      ? { required_evidence_policy_id: requiredEvidencePolicyId }
      : {}),
    source_configuration_version_id: sourceConfigurationVersionId,
    ...(serviceTaskKey != null ? { service_task_key: serviceTaskKey } : {}),
    ...(serviceModuleKey != null ? { service_module_key: serviceModuleKey } : {}),
    requirement_key: requirementKey,
    evidence_type: evidenceType,
    required_count: requirePositiveInteger(requiredCount ?? 1, "requiredCount"),
    is_mandatory: isMandatory ?? true,
    requires_external_reference: requiresExternalReference ?? false,
    storage_rule_payload: withJsonObject(storageRulePayload),
    quality_signal_payload: withJsonObject(qualitySignalPayload),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

export function buildServiceExceptionPayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  qaInspectionId,
  correctiveActionId,
  sourceType,
  actorWorkerId,
  actorAppUserId,
  exceptionCategory,
  severity,
  description,
  findings,
  triageStatus,
  correctiveActionRequired,
  reportedAt,
  triagedAt,
  resolutionPayload,
  resolvedAt,
  closedAt,
  qualitySignalPayload,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(workOrderId, "workOrderId");
  requireField(description, "description");
  requireEnum(sourceType ?? "other", SERVICE_EXCEPTION_SOURCES, "sourceType");
  requireEnum(exceptionCategory, SERVICE_EXCEPTION_CATEGORIES, "exceptionCategory");
  requireEnum(severity, SERVICE_EXCEPTION_SEVERITIES, "severity");

  const nextStatus = triageStatus ?? "reported";
  requireEnum(nextStatus, SERVICE_EXCEPTION_STATUSES, "triageStatus");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    ...(qaInspectionId != null ? { qa_inspection_id: qaInspectionId } : {}),
    ...(correctiveActionId != null ? { corrective_action_id: correctiveActionId } : {}),
    source_type: sourceType ?? "other",
    ...(actorWorkerId != null ? { actor_worker_id: actorWorkerId } : {}),
    ...(actorAppUserId != null ? { actor_app_user_id: actorAppUserId } : {}),
    exception_category: exceptionCategory,
    severity,
    description,
    findings: withJsonObject(findings),
    triage_status: nextStatus,
    corrective_action_required: correctiveActionRequired ?? false,
    reported_at: reportedAt ?? new Date().toISOString(),
    ...(triagedAt != null ? { triaged_at: triagedAt } : {}),
    resolution_payload: withJsonObject(resolutionPayload),
    ...(resolvedAt != null ? { resolved_at: resolvedAt } : {}),
    ...(closedAt != null ? { closed_at: closedAt } : {}),
    quality_signal_payload: withJsonObject(qualitySignalPayload),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}

export function buildCustomerOutcomePayload({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  customerId,
  contactId,
  serviceLocationId,
  outcomeType,
  outcomeStatus,
  outcomeSource,
  sourceChannel,
  reportedAt,
  recordedAt,
  description,
  details,
  resolutionPayload,
  resolvedAt,
  closedAt,
  qualitySignalPayload,
  metadata,
  appUserId,
}) {
  requireField(organizationId, "organizationId");
  requireField(businessUnitId, "businessUnitId");
  requireField(operationalJobId, "operationalJobId");
  requireField(customerId, "customerId");
  requireField(description, "description");
  requireEnum(outcomeType, CUSTOMER_OUTCOME_TYPES, "outcomeType");
  requireEnum(outcomeSource ?? "customer", CUSTOMER_OUTCOME_SOURCES, "outcomeSource");

  const nextStatus = outcomeStatus ?? "reported";
  requireEnum(nextStatus, CUSTOMER_OUTCOME_STATUSES, "outcomeStatus");

  return {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    operational_job_id: operationalJobId,
    ...(workOrderId != null ? { work_order_id: workOrderId } : {}),
    customer_id: customerId,
    ...(contactId != null ? { contact_id: contactId } : {}),
    ...(serviceLocationId != null ? { service_location_id: serviceLocationId } : {}),
    outcome_type: outcomeType,
    outcome_status: nextStatus,
    outcome_source: outcomeSource ?? "customer",
    ...(sourceChannel != null ? { source_channel: sourceChannel } : {}),
    reported_at: reportedAt ?? new Date().toISOString(),
    recorded_at: recordedAt ?? new Date().toISOString(),
    description,
    details: withJsonObject(details),
    resolution_payload: withJsonObject(resolutionPayload),
    ...(resolvedAt != null ? { resolved_at: resolvedAt } : {}),
    ...(closedAt != null ? { closed_at: closedAt } : {}),
    quality_signal_payload: withJsonObject(qualitySignalPayload),
    metadata: withJsonObject(metadata),
    ...(appUserId ? { created_by_app_user_id: appUserId } : {}),
  };
}
