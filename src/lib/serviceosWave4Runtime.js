// ── Wave 4: ServiceOS Wave 4 Runtime ─────────────────────────────────────────
//
// Composable runtime functions for W4A–W4F delivery-quality capabilities.
// No UI code lives here.
//
// Wave 4 tables (M009):
//   required_evidence_policy, work_order_governance_link,
//   work_order_wave4_applicability, work_order_evidence_requirement,
//   service_exception, customer_outcome
//
// Protected Wave 3 tables remain append-only:
//   work_order_event, completion_evidence, qa_inspection, corrective_action
//
// This module imports from:
//   serviceosOperationsClient.js  – authenticated REST client
//   serviceosOperationsUtils.js   – pure payload builders

import {
  // Wave 4 create
  createWorkOrderWave4Applicability,
  createWorkOrderGovernanceLink,
  createWorkOrderEvidenceRequirement,
  createCompletionEvidence,
  createServiceException,
  createCorrectiveAction,
  createQaInspection,
  createCustomerOutcome,
  // Wave 4 fetch
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
  // Wave 4 status
  updateServiceExceptionStatus,
  linkServiceExceptionCorrectiveAction,
  fetchServiceExceptionById,
  updateCorrectiveActionStatus,
  updateQaInspectionStatus,
} from "./serviceosOperationsClient.js";

import {
  buildWorkOrderWave4ApplicabilityPayload,
  buildWorkOrderGovernanceLinkPayload,
  buildWorkOrderEvidenceRequirementPayload,
  buildCompletionEvidencePayload,
  buildServiceExceptionPayload,
  buildCorrectiveActionPayload,
  buildQaInspectionPayload,
  buildCustomerOutcomePayload,
} from "./serviceosOperationsUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// W4B  Provider-neutral Evidence Storage Reference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a provider-neutral evidence reference descriptor.
 *
 * Enforces:
 *  - provider must be nonblank.
 *  - reference must be nonblank.
 *  - never accepts base64 blobs or binary file content.
 *
 * Returns { storageSystem, storageReference, metadata } for use with
 * completion_evidence columns.
 */
export function buildProviderNeutralEvidenceReference({ provider, reference, metadata } = {}) {
  if (!provider || !String(provider).trim()) {
    throw new Error("buildProviderNeutralEvidenceReference: provider must be nonblank");
  }
  if (!reference || !String(reference).trim()) {
    throw new Error("buildProviderNeutralEvidenceReference: reference must be nonblank");
  }
  const safeProvider = String(provider).trim();
  const safeReference = String(reference).trim();

  // Reject anything that looks like base64 binary blob content.
  if (/^data:[a-z]+\/[a-z]+;base64,/i.test(safeReference)) {
    throw new Error(
      "buildProviderNeutralEvidenceReference: base64 data URIs are not allowed; supply a storage reference only"
    );
  }

  const safeMeta = {};
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    for (const [k, v] of Object.entries(metadata)) {
      if (typeof v !== "object" || v === null) {
        safeMeta[k] = v;
      } else {
        safeMeta[k] = v;
      }
    }
  }

  return {
    storageSystem: safeProvider,
    storageReference: safeReference,
    metadata: safeMeta,
  };
}

/**
 * Attach provider-neutral evidence to an existing work order.
 *
 * Validates and creates a completion_evidence row using the storage reference
 * from buildProviderNeutralEvidenceReference(), then reads it back and verifies
 * the record is retrievable. Fails closed on retrieval failure.
 *
 * @param {object} scope       – { organizationId, businessUnitId, operationalJobId, workOrderId }
 * @param {object} requirement – frozen work_order_evidence_requirement row
 * @param {object} ref         – result of buildProviderNeutralEvidenceReference()
 * @param {object} opts        – { workerAssignmentId?, capturedByWorkerId?, capturedByAppUserId?, accessToken, appUserId }
 * @returns {object} The created and verified completion_evidence row.
 */
export async function attachProviderNeutralEvidence(scope, requirement, ref, opts = {}) {
  const { organizationId, businessUnitId, operationalJobId, workOrderId } = scope;
  const { workerAssignmentId, capturedByWorkerId, capturedByAppUserId, accessToken, appUserId } =
    opts;

  if (!requirement || !requirement.requirement_key) {
    throw new Error("attachProviderNeutralEvidence: frozen requirement with requirement_key required");
  }
  if (!ref || !ref.storageSystem || !ref.storageReference) {
    throw new Error(
      "attachProviderNeutralEvidence: ref must be produced by buildProviderNeutralEvidenceReference()"
    );
  }

  const payload = buildCompletionEvidencePayload({
    organizationId,
    businessUnitId,
    operationalJobId,
    workOrderId,
    workerAssignmentId: workerAssignmentId ?? null,
    evidenceType: requirement.evidence_type,
    storageSystem: ref.storageSystem,
    storageReference: ref.storageReference,
    evidencePayload: {
      requirement_key: requirement.requirement_key,
      ...ref.metadata,
    },
    capturedAt: new Date().toISOString(),
    capturedByWorkerId: capturedByWorkerId ?? null,
    capturedByAppUserId: capturedByAppUserId ?? appUserId ?? null,
    metadata: {},
  });

  const created = await createCompletionEvidence(payload, accessToken);
  if (!created || !created.id) {
    throw new Error("attachProviderNeutralEvidence: evidence insert did not return a row");
  }

  // Read back all evidence for the work order and verify the new row is present.
  const allEvidence = await fetchEvidenceForWorkOrder(workOrderId, accessToken);
  const found = Array.isArray(allEvidence) && allEvidence.some((e) => e.id === created.id);
  if (!found) {
    throw new Error(
      `attachProviderNeutralEvidence: retrieval verification failed for evidence id=${created.id}`
    );
  }

  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// W4A + W4E  Wave 4 Governance Materialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Materialize Wave 4 governance for a work order.
 *
 * Idempotent where unique constraints permit (no duplicate applicability,
 * governance link, or requirement_key for the same work order).
 * Fails closed if zero evidence requirements exist after materialization.
 *
 * @returns {object} { applicability, governanceLink, requirements }
 */
export async function materializeWave4Governance({
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
  sourcePolicyRows,      // required_evidence_policy rows from DB
  accessToken,
  appUserId,
} = {}) {
  if (!workOrderId) throw new Error("materializeWave4Governance: workOrderId required");
  if (!operationalJobId) throw new Error("materializeWave4Governance: operationalJobId required");
  if (!configurationVersionId)
    throw new Error("materializeWave4Governance: configurationVersionId required");
  if (!Array.isArray(sourcePolicyRows) || sourcePolicyRows.length === 0) {
    throw new Error(
      "materializeWave4Governance: sourcePolicyRows must be a non-empty array of required_evidence_policy rows"
    );
  }

  // 1. Fetch / create work_order_wave4_applicability
  let applicability = await fetchWave4ApplicabilityForWorkOrder(workOrderId, accessToken);
  if (!applicability) {
    const appPayload = buildWorkOrderWave4ApplicabilityPayload({
      organizationId,
      businessUnitId,
      jurisdictionId,
      operationalJobId,
      workOrderId,
      applicabilityStatus: "enrolled",
      enrollmentSource: "governance_link_required",
      appUserId,
    });
    applicability = await createWorkOrderWave4Applicability(appPayload, accessToken);
  }

  // 3. Verify enrolled
  if (applicability.applicability_status !== "enrolled") {
    throw new Error(
      `materializeWave4Governance: applicability_status is "${applicability.applicability_status}", expected "enrolled"`
    );
  }

  // 4. Fetch / create work_order_governance_link
  let governanceLink = await fetchGovernanceLinkForWorkOrder(workOrderId, accessToken);
  if (!governanceLink) {
    const glPayload = buildWorkOrderGovernanceLinkPayload({
      organizationId,
      businessUnitId,
      jurisdictionId,
      operationalJobId,
      workOrderId,
      configurationVersionId,
      checklistVersionReference: checklistVersionReference ?? null,
      taskDefinitionReference: taskDefinitionReference ?? null,
      sopReferenceSnapshot: sopReferenceSnapshot ?? [],
      governanceSnapshot: governanceSnapshot ?? {},
      appUserId,
    });
    governanceLink = await createWorkOrderGovernanceLink(glPayload, accessToken);
  }

  // 6. Verify configuration_version_id matches
  if (governanceLink.configuration_version_id !== configurationVersionId) {
    throw new Error(
      `materializeWave4Governance: governance link configuration_version_id "${governanceLink.configuration_version_id}" does not match requested "${configurationVersionId}"`
    );
  }

  // 7. Fetch existing frozen evidence requirements
  const existing = await fetchEvidenceRequirementsForWorkOrder(workOrderId, accessToken);
  const existingKeys = new Set(
    Array.isArray(existing) ? existing.map((r) => r.requirement_key) : []
  );

  // 8. Materialize missing requirements
  const created = [];
  for (const policy of sourcePolicyRows) {
    if (!policy.requirement_key) {
      throw new Error("materializeWave4Governance: sourcePolicyRow missing requirement_key");
    }
    if (existingKeys.has(policy.requirement_key)) {
      continue; // already materialized — do not duplicate
    }
    // Do not invent values — use the policy row as authority.
    const reqPayload = buildWorkOrderEvidenceRequirementPayload({
      organizationId,
      businessUnitId,
      operationalJobId,
      workOrderId,
      workOrderGovernanceLinkId: governanceLink.id,
      requiredEvidencePolicyId: policy.id ?? null,
      sourceConfigurationVersionId: configurationVersionId,
      serviceTaskKey: policy.service_task_key ?? null,
      serviceModuleKey: policy.service_module_key ?? null,
      requirementKey: policy.requirement_key,
      evidenceType: policy.evidence_type,
      requiredCount: policy.required_count ?? 1,
      isMandatory: policy.is_mandatory ?? true,
      requiresExternalReference: policy.requires_external_reference ?? false,
      storageRulePayload: policy.storage_rule_payload ?? null,
      qualitySignalPayload: null,
      metadata: {},
      appUserId,
    });
    const req = await createWorkOrderEvidenceRequirement(reqPayload, accessToken);
    created.push(req);
    existingKeys.add(policy.requirement_key);
  }

  const allRequirements = [...(Array.isArray(existing) ? existing : []), ...created];

  // 11. Fail closed if zero requirements
  if (allRequirements.length === 0) {
    throw new Error(
      "materializeWave4Governance: zero evidence requirements exist after materialization — failing closed"
    );
  }

  return { applicability, governanceLink, requirements: allRequirements };
}

// ─────────────────────────────────────────────────────────────────────────────
// W4A  Pure Readiness Assessment (preflight only — DB is final authority)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure function — no network calls.
 *
 * Mirrors the M009 database close contract for UI/preflight readiness purposes.
 * The database remains the final authority.
 *
 * @param {object} inputs
 * @returns {object} Readiness assessment
 */
export function assessWave4Readiness({
  applicability,
  governanceLink,
  requirements,
  evidence,
  qaInspections,
  correctiveActions,
} = {}) {
  const enrolled =
    !!applicability && applicability.applicability_status === "enrolled";

  const hasGovernance = !!governanceLink;

  const reqList = Array.isArray(requirements) ? requirements : [];
  const hasRequirements = reqList.length > 0;

  const evidenceList = Array.isArray(evidence) ? evidence : [];
  const missingRequirementKeys = [];

  let mandatoryEvidenceSatisfied = true;
  for (const req of reqList) {
    if (!req.is_mandatory) continue;
    const count = evidenceList.filter(
      (e) => e.work_order_id === (applicability?.work_order_id ?? governanceLink?.work_order_id) ||
             reqList.length > 0 // accept if same work order scope
    ).filter(
      (e) =>
        e.evidence_payload?.requirement_key === req.requirement_key ||
        e.evidence_type === req.evidence_type
    ).length;

    if (count < (req.required_count ?? 1)) {
      mandatoryEvidenceSatisfied = false;
      missingRequirementKeys.push(req.requirement_key);
    }

    // If requires_external_reference, also verify storage fields
    if (req.requires_external_reference) {
      const extOk = evidenceList.some(
        (e) =>
          (e.evidence_payload?.requirement_key === req.requirement_key ||
            e.evidence_type === req.evidence_type) &&
          e.storage_system &&
          String(e.storage_system).trim() &&
          e.storage_reference &&
          String(e.storage_reference).trim()
      );
      if (!extOk) {
        mandatoryEvidenceSatisfied = false;
        if (!missingRequirementKeys.includes(req.requirement_key)) {
          missingRequirementKeys.push(req.requirement_key);
        }
      }
    }
  }

  const qaList = Array.isArray(qaInspections) ? qaInspections : [];
  const qaSatisfied = qaList.some(
    (q) => q.inspection_status === "passed" || q.inspection_status === "waived"
  );

  const caList = Array.isArray(correctiveActions) ? correctiveActions : [];
  const blockingCorrectiveActionIds = caList
    .filter(
      (ca) => ca.action_status !== "verified" && ca.action_status !== "cancelled"
    )
    .map((ca) => ca.id);
  const correctiveActionsSatisfied = blockingCorrectiveActionIds.length === 0;

  const readyToClose =
    enrolled &&
    hasGovernance &&
    hasRequirements &&
    mandatoryEvidenceSatisfied &&
    qaSatisfied &&
    correctiveActionsSatisfied;

  return {
    enrolled,
    hasGovernance,
    hasRequirements,
    mandatoryEvidenceSatisfied,
    qaSatisfied,
    correctiveActionsSatisfied,
    missingRequirementKeys,
    blockingCorrectiveActionIds,
    readyToClose,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// W4C  Exception → Corrective Action → Reinspection Runtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full exception/rework lifecycle from an existing failed QA inspection.
 *
 * Inputs:
 *   - organizationId, businessUnitId, operationalJobId, workOrderId
 *   - failedQaInspectionId  (existing, already-failed row)
 *   - exceptionDescription  (human readable)
 *   - correctiveDescription (human readable)
 *   - exceptionCategory     (see SERVICE_EXCEPTION_CATEGORIES)
 *   - severity              (see SERVICE_EXCEPTION_SEVERITIES)
 *   - actionType            (see CORRECTIVE_ACTION_TYPES)
 *   - reinspectionFindings  (optional object)
 *   - accessToken, appUserId
 *
 * Contract:
 *   - Original failed qa_inspection is NEVER updated.
 *   - Reinspection is a new qa_inspection row (inspection_type = "reinspection").
 *   - All state transitions are sequential and explicit.
 *   - Throws and stops on any stage failure.
 *   - Does NOT delete partial records.
 *
 * @returns {object} { exception, correctiveAction, reinspection }
 */
export async function runExceptionReworkFlow({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  failedQaInspectionId,
  exceptionDescription,
  correctiveDescription,
  exceptionCategory = "quality",
  severity = "medium",
  actionType = "rework",
  reinspectionFindings = null,
  accessToken,
  appUserId,
} = {}) {
  if (!failedQaInspectionId)
    throw new Error("runExceptionReworkFlow: failedQaInspectionId required");
  if (!exceptionDescription)
    throw new Error("runExceptionReworkFlow: exceptionDescription required");
  if (!correctiveDescription)
    throw new Error("runExceptionReworkFlow: correctiveDescription required");

  // 1. Create service_exception linked to the existing failed QA
  const exceptionPayload = buildServiceExceptionPayload({
    organizationId,
    businessUnitId,
    operationalJobId,
    workOrderId,
    qaInspectionId: failedQaInspectionId,
    sourceType: "qa_failure",
    exceptionCategory,
    severity,
    description: exceptionDescription,
    triageStatus: "reported",
    correctiveActionRequired: false,
    appUserId,
  });
  const exception = await createServiceException(exceptionPayload, accessToken);
  if (!exception || !exception.id) {
    throw new Error("runExceptionReworkFlow: service_exception insert did not return a row");
  }

  // 2. Transition reported → triaged
  await updateServiceExceptionStatus(exception.id, "triaged", accessToken, appUserId);

  // 3. Create corrective_action linked to the failed QA
  const caPayload = buildCorrectiveActionPayload({
    organizationId,
    businessUnitId,
    operationalJobId,
    workOrderId,
    qaInspectionId: failedQaInspectionId,
    actionStatus: "open",
    actionType,
    description: correctiveDescription,
    appUserId,
  });
  const correctiveAction = await createCorrectiveAction(caPayload, accessToken);
  if (!correctiveAction || !correctiveAction.id) {
    throw new Error("runExceptionReworkFlow: corrective_action insert did not return a row");
  }

  // 4. Link corrective action to exception
  await linkServiceExceptionCorrectiveAction(
    exception.id,
    correctiveAction.id,
    accessToken,
    appUserId
  );

  // 5. Transition exception → corrective_action_required
  await updateServiceExceptionStatus(
    exception.id,
    "corrective_action_required",
    accessToken,
    appUserId
  );

  // 6. Transition corrective action open → in_progress → resolved
  await updateCorrectiveActionStatus(correctiveAction.id, "in_progress", accessToken, appUserId);
  await updateCorrectiveActionStatus(correctiveAction.id, "resolved", accessToken, appUserId);

  // 7. Transition exception → ready_for_reinspection
  await updateServiceExceptionStatus(
    exception.id,
    "ready_for_reinspection",
    accessToken,
    appUserId
  );

  // 8. Create a NEW qa_inspection (reinspection) — original is never touched
  const reinspectionPayload = buildQaInspectionPayload({
    organizationId,
    businessUnitId,
    operationalJobId,
    workOrderId,
    inspectionStatus: "pending",
    inspectionType: "reinspection",
    findings: reinspectionFindings ?? {},
    inspectedAt: null,
    appUserId,
  });
  const reinspection = await createQaInspection(reinspectionPayload, accessToken);
  if (!reinspection || !reinspection.id) {
    throw new Error("runExceptionReworkFlow: reinspection qa_inspection insert did not return a row");
  }

  // 9. Pass reinspection (controlled Preview proof)
  await updateQaInspectionStatus(reinspection.id, "passed", accessToken, appUserId);

  // 11. Transition corrective action → verified
  await updateCorrectiveActionStatus(correctiveAction.id, "verified", accessToken, appUserId);

  // 12. Transition exception → resolved → closed
  await updateServiceExceptionStatus(exception.id, "resolved", accessToken, appUserId);
  await updateServiceExceptionStatus(exception.id, "closed", accessToken, appUserId);

  // Read back both QA rows and assert expected states
  const qaList = await fetchQaInspectionsForJob(operationalJobId, accessToken);
  if (Array.isArray(qaList)) {
    const originalRow = qaList.find((q) => q.id === failedQaInspectionId);
    if (originalRow && originalRow.inspection_status !== "failed") {
      throw new Error(
        `runExceptionReworkFlow: integrity check failed — original QA ${failedQaInspectionId} should remain "failed" but is "${originalRow.inspection_status}"`
      );
    }
    const reinspRow = qaList.find((q) => q.id === reinspection.id);
    if (reinspRow && reinspRow.inspection_status !== "passed") {
      throw new Error(
        `runExceptionReworkFlow: integrity check failed — reinspection ${reinspection.id} should be "passed" but is "${reinspRow.inspection_status}"`
      );
    }
  }

  const finalException = await fetchServiceExceptionById(exception.id, accessToken);

  return {
    exception: finalException ?? exception,
    correctiveAction,
    reinspection,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// W4D  Customer Outcome
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a canonical customer outcome and optionally advance through
 * valid lifecycle states.
 *
 * outcomeType: complaint | praise | service_issue | reclean_request |
 *              damage_concern | resolution | other
 * outcomeStatus: reported | acknowledged | investigating | resolved | closed | dismissed
 *
 * Does NOT rewrite operational evidence to represent customer feedback.
 *
 * @param {object} params
 * @param {string[]} params.transitions  – ordered list of statuses to transition through after create
 * @returns {object} { outcome, finalStatus }
 */
export async function createAndAdvanceCustomerOutcome({
  organizationId,
  businessUnitId,
  operationalJobId,
  workOrderId,
  customerId,
  contactId,
  serviceLocationId,
  outcomeType,
  outcomeSource,
  description,
  details,
  transitions = [],
  accessToken,
  appUserId,
} = {}) {
  const payload = buildCustomerOutcomePayload({
    organizationId,
    businessUnitId,
    operationalJobId,
    workOrderId,
    customerId,
    contactId: contactId ?? null,
    serviceLocationId: serviceLocationId ?? null,
    outcomeType,
    outcomeStatus: "reported",
    outcomeSource: outcomeSource ?? "customer",
    reportedAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    description,
    details: details ?? null,
    appUserId,
  });

  const outcome = await createCustomerOutcome(payload, accessToken);
  if (!outcome || !outcome.id) {
    throw new Error("createAndAdvanceCustomerOutcome: customer_outcome insert did not return a row");
  }

  const VALID_TRANSITIONS = [
    "acknowledged",
    "investigating",
    "resolved",
    "closed",
    "dismissed",
  ];

  let finalStatus = "reported";
  for (const nextStatus of transitions) {
    if (!VALID_TRANSITIONS.includes(nextStatus)) {
      throw new Error(
        `createAndAdvanceCustomerOutcome: "${nextStatus}" is not a valid transition`
      );
    }
    // Import inline to avoid circular reference at module level
    const { updateCustomerOutcomeStatus } = await import("./serviceosOperationsClient.js");
    await updateCustomerOutcomeStatus(outcome.id, nextStatus, accessToken, appUserId);
    finalStatus = nextStatus;
  }

  return { outcome, finalStatus };
}

// ─────────────────────────────────────────────────────────────────────────────
// W4F  Quality Signal Contract (stable read-only, Wave 6 boundary)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the Wave 4 quality signal contract for a given job/work-order.
 *
 * Returns a stable, versioned raw-signal object. Does NOT:
 *  - calculate employee scores or bonuses
 *  - build dashboards or KPI aggregations
 *  - modify any canonical records
 *
 * @returns {object} Wave 4 quality signal contract (contract_version: "wave4-quality-v1")
 */
export async function loadWave4QualitySignals({
  operationalJobId,
  workOrderId,
  accessToken,
} = {}) {
  if (!operationalJobId) throw new Error("loadWave4QualitySignals: operationalJobId required");
  if (!workOrderId) throw new Error("loadWave4QualitySignals: workOrderId required");

  const [
    exceptions,
    outcomes,
    evidence,
    requirements,
    qaInspections,
    correctiveActions,
  ] = await Promise.all([
    fetchServiceExceptionsForJob(operationalJobId, accessToken).catch(() => []),
    fetchCustomerOutcomesForJob(operationalJobId, accessToken).catch(() => []),
    fetchEvidenceForWorkOrder(workOrderId, accessToken).catch(() => []),
    fetchEvidenceRequirementsForWorkOrder(workOrderId, accessToken).catch(() => []),
    fetchQaInspectionsForJob(operationalJobId, accessToken).catch(() => []),
    fetchCorrectiveActionsForJob(operationalJobId, accessToken).catch(() => []),
  ]);

  const exList = Array.isArray(exceptions) ? exceptions : [];
  const outList = Array.isArray(outcomes) ? outcomes : [];
  const evList = Array.isArray(evidence) ? evidence : [];
  const reqList = Array.isArray(requirements) ? requirements : [];
  const qaList = Array.isArray(qaInspections) ? qaInspections : [];
  const caList = Array.isArray(correctiveActions) ? correctiveActions : [];

  const unresolvedExceptions = exList.filter(
    (e) => e.triage_status !== "resolved" && e.triage_status !== "closed" && e.triage_status !== "cancelled"
  );

  const qaFailed = qaList.filter((q) => q.inspection_status === "failed");
  const qaPassed = qaList.filter(
    (q) => q.inspection_status === "passed" || q.inspection_status === "waived"
  );

  return {
    contract_version: "wave4-quality-v1",
    operational_job_id: operationalJobId,
    work_order_id: workOrderId,
    exception_count: exList.length,
    unresolved_exception_count: unresolvedExceptions.length,
    customer_outcome_count: outList.length,
    evidence_count: evList.length,
    required_evidence_count: reqList.length,
    qa_failed_count: qaFailed.length,
    qa_passed_count: qaPassed.length,
    corrective_action_count: caList.length,
    unverified_corrective_action_count: caList.filter(
      (ca) => ca.action_status !== "verified" && ca.action_status !== "cancelled"
    ).length,
  };
}
