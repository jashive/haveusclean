// api/wave4-rls-acceptance-harness.js
//
// Wave 4 / Wave 5 Acceptance Harness Dispatcher — PREVIEW/TEST ONLY
//
// DISPATCH:
//   POST body with { "wave": "wave5" } or { "contract_version": "wave5-rls-acceptance-v1" }
//     → delegates to Wave 5 RLS handler (src/server/wave5RlsAcceptanceHarness.js)
//   No discriminator / explicit wave4 → existing Wave 4 handler (unchanged)
//   Unknown discriminator → fail closed 400
//
// Wave 4 Role/RLS Acceptance Harness — PREVIEW/TEST ONLY
//
// PURPOSE:
//   Closes Wave 4 RLS acceptance without requiring another SQL migration.
//   Authenticates as office_ops, worker, qa, and anon independently, then probes
//   the deployed Wave 4 RLS policies against retained acceptance evidence.
//
// DESIGN PRINCIPLES:
//   - Preview/test ONLY. Fails hard in production (SERVICEOS_ENVIRONMENT=production).
//   - No test passwords stored in source. Credentials come exclusively from env vars.
//   - Each role uses its own authenticated Supabase access token (not service_role).
//   - No service_role bypass for role probes.
//   - No SQL execution. No fixture rerun. No cleanup. No auth user creation.
//   - No destructive mutation of retained evidence/history.
//   - Anonymous boundary is explicitly probed with apikey only and NO bearer token.
//   - contract_version = wave4-rls-acceptance-v2.
//   - passed=true only when every mandatory probe in the safe closure contract is proven.
//   - Optional not_proven probes are reported separately and do NOT block passed=true.
//
// REQUIRED ENVIRONMENT VARIABLES (Preview/test only — never VITE_* or NEXT_PUBLIC_*):
//   SERVICEOS_ENVIRONMENT               – must be "preview" or "test"
//   SERVICEOS_W4_RLS_HARNESS_ENABLED    – must be explicitly "true"
//   SUPABASE_URL                        – Supabase project URL
//   SUPABASE_ANON_KEY                   – server-only Preview/test anon key
//   SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL   – office_ops test identity email
//   SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD
//   SERVICEOS_W4_RLS_WORKER_EMAIL       – worker test identity email
//   SERVICEOS_W4_RLS_WORKER_PASSWORD
//   SERVICEOS_W4_RLS_QA_EMAIL           – qa test identity email
//   SERVICEOS_W4_RLS_QA_PASSWORD
//
// OUTPUT CONTRACT:
//   {
//     contract_version: "wave4-rls-acceptance-v2",
//     office_ops: {...},
//     worker: {...},
//     qa: {...},
//     anon: {...},
//     passed: boolean,
//     proven_count: number,
//     failed_count: number,
//     not_proven_count: number,
//     missing_identities: [],
//     environment: "preview"|"test",
//     run_at: "<ISO timestamp>"
//   }
//
// RUNTIME ACCEPTANCE EXECUTION:
//   This harness must NOT be executed here.
//   DO NOT execute M012. DO NOT create auth users.
//   The harness reports which identities are missing if they do not yet exist.

import { runWave5RlsAcceptanceHandler } from "../src/server/wave5RlsAcceptanceHarness.js";

const CONTRACT_VERSION = "wave4-rls-acceptance-v2";

const FIXTURE_SCOPE = Object.freeze({
  customer_id: "e1100000-0000-0000-0000-000000000002",
  contact_id: "e1100000-0000-0000-0000-000000000003",
  service_location_id: "e1100000-0000-0000-0000-000000000004",
  operational_job_id: "e1100000-0000-0000-0000-00000000000e",
  work_order_id: "e1100000-0000-0000-0000-000000000011",
  worker_assignment_id: "e1100000-0000-0000-0000-000000000010",
  worker_id: "1b3a6903-0c50-4a95-afc3-280628c10508",
  failed_qa_inspection_id: "e1100000-0000-0000-0000-000000000012",
});

const CLASSIFICATION = Object.freeze({
  PROVEN_ALLOW: "proven_allow",
  PROVEN_RLS_DENY: "proven_rls_deny",
  PROVEN_AUTHZ_DENY: "proven_authz_deny",
  UNEXPECTED_ALLOW: "unexpected_allow",
  VALIDATION_FAILURE: "validation_failure",
  NOT_PROVEN: "not_proven",
  TRANSPORT_FAILURE: "transport_failure",
});

function getEnvironment() {
  const raw = (process.env.SERVICEOS_ENVIRONMENT || "").trim().toLowerCase();
  if (raw === "preview" || raw === "test") return raw;
  return null;
}

function isHarnessEnabled() {
  return process.env.SERVICEOS_W4_RLS_HARNESS_ENABLED === "true";
}

async function signInWithPassword(supabaseUrl, anonKey, email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Auth failed for ${email}: HTTP ${res.status} ${text}`),
      { code: "AUTH_FAILED", email }
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw Object.assign(
      new Error(`Auth returned no access_token for ${email}`),
      { code: "NO_ACCESS_TOKEN", email }
    );
  }

  return data.access_token;
}

async function restProbe(supabaseUrl, anonKey, accessToken, method, table, options = {}) {
  const { body = null, filter = "", prefer = "return=representation" } = options;
  const url = `${supabaseUrl}/rest/v1/${table}${filter}`;
  const headers = {
    apikey: anonKey,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: prefer,
  };
  if (accessToken) {
    headers.Authorization = "Bearer " + accessToken;
  }

  const reqInit = { method, headers };
  if (body !== null && method !== "GET" && method !== "DELETE") {
    reqInit.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, reqInit);
    const status = res.status;
    const rawText = await res.text().catch(() => "");
    let responseBody = null;
    if (rawText) {
      try {
        responseBody = JSON.parse(rawText);
      } catch {
        responseBody = rawText;
      }
    }
    return { ok: res.ok, status, body: responseBody, raw_text: rawText, method, table, url };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      raw_text: "",
      error: err.message,
      method,
      table,
      url,
    };
  }
}

function bodyText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function isTransportFailure(result) {
  return result.status === 0 || !!result.error;
}

function isRlsDeniedResponse(result) {
  if (result.status === 401 || result.status === 403) return true;
  const text = `${bodyText(result.body)} ${result.raw_text || ""}`.toLowerCase();
  return (
    text.includes("row-level security") ||
    text.includes("permission denied") ||
    text.includes("insufficient_privilege") ||
    text.includes('"code":"42501"') ||
    text.includes("permission denied for table")
  );
}

function isValidationFailureResponse(result) {
  const text = `${bodyText(result.body)} ${result.raw_text || ""}`.toLowerCase();
  return (
    result.status === 400 ||
    result.status === 409 ||
    result.status === 422 ||
    text.includes("violates check constraint") ||
    text.includes("violates foreign key constraint") ||
    text.includes("violates unique constraint") ||
    text.includes("duplicate key") ||
    text.includes("null value") ||
    text.includes("invalid input syntax") ||
    text.includes("failed to parse") ||
    text.includes("not-null")
  );
}

function isDbImmutabilityResponse(result) {
  const text = `${bodyText(result.body)} ${result.raw_text || ""}`.toLowerCase();
  return text.includes("append-only") || text.includes("immutable");
}

function isAuthorizationGuardResponse(result) {
  const text = `${bodyText(result.body)} ${result.raw_text || ""}`.toLowerCase();
  return (
    text.includes("authenticated worker context is required for source_type=worker") ||
    text.includes("actor_worker_id must match authenticated worker") ||
    text.includes("actor_app_user_id must match authenticated app user") ||
    text.includes("worker context cannot impersonate source_type")
  );
}

function buildProbe({
  role,
  operation,
  table,
  expected,
  mandatory = true,
  classification,
  result = null,
  note = null,
  proof_detail = null,
  expected_scope = null,
  actual_row_count = null,
}) {
  const pass =
    classification === CLASSIFICATION.PROVEN_ALLOW ||
    classification === CLASSIFICATION.PROVEN_RLS_DENY ||
    classification === CLASSIFICATION.PROVEN_AUTHZ_DENY;
  return {
    role,
    operation,
    table,
    expected,
    mandatory,
    classification,
    pass,
    actual_status: result?.status ?? null,
    actual_ok: result?.ok ?? null,
    actual_row_count,
    expected_scope,
    proof_detail,
    note,
  };
}

function buildManualNotProvenProbe({ role, operation, table, expected, mandatory = true, note, expected_scope = null, proof_detail = null }) {
  return buildProbe({
    role,
    operation,
    table,
    expected,
    mandatory,
    classification: CLASSIFICATION.NOT_PROVEN,
    note,
    expected_scope,
    proof_detail,
  });
}

function buildAllowSelectProbe({ role, operation, table, result, mandatory = true, expected_scope, verifier, noteIfMissing }) {
  if (isTransportFailure(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      mandatory,
      classification: CLASSIFICATION.TRANSPORT_FAILURE,
      result,
      expected_scope,
      note: result.error || "Transport failure",
    });
  }

  if (!result.ok) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      mandatory,
      classification: CLASSIFICATION.NOT_PROVEN,
      result,
      expected_scope,
      note: `Expected 2xx plus retained fixture row visibility, received HTTP ${result.status}`,
    });
  }

  const rows = Array.isArray(result.body) ? result.body : [];
  if (verifier(rows)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      mandatory,
      classification: CLASSIFICATION.PROVEN_ALLOW,
      result,
      expected_scope,
      actual_row_count: rows.length,
      note: "2xx response returned the retained expected fixture row/scope",
    });
  }

  return buildProbe({
    role,
    operation,
    table,
    expected: "allow",
    mandatory,
    classification: CLASSIFICATION.NOT_PROVEN,
    result,
    expected_scope,
    actual_row_count: rows.length,
    note: noteIfMissing || "2xx response did not prove the retained expected fixture row/scope",
  });
}

function classifyDenyMutationProbe({
  role,
  operation,
  table,
  result,
  mandatory = true,
  expected_scope,
  allowNote = null,
  allowEmptyRepresentationDeny = false,
}) {
  if (isTransportFailure(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.TRANSPORT_FAILURE,
      result,
      expected_scope,
      note: result.error || "Transport failure",
    });
  }

  if (result.ok) {
    const rows = Array.isArray(result.body) ? result.body : null;
    if (allowEmptyRepresentationDeny && rows && rows.length === 0) {
      return buildProbe({
        role,
        operation,
        table,
        expected: "deny",
        mandatory,
        classification: CLASSIFICATION.PROVEN_RLS_DENY,
        result,
        expected_scope,
        actual_row_count: 0,
        note: "Known retained row stayed SELECT-visible but was filtered from the PATCH representation, proving update denial",
      });
    }

    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.UNEXPECTED_ALLOW,
      result,
      expected_scope,
      note: allowNote || "Mutation returned 2xx; this is an unexpected allow",
    });
  }

  if (isRlsDeniedResponse(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.PROVEN_RLS_DENY,
      result,
      expected_scope,
      note: "Authorization/RLS denial proven",
    });
  }

  if (isAuthorizationGuardResponse(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.PROVEN_AUTHZ_DENY,
      result,
      expected_scope,
      note: "Authorization guard denial proven",
    });
  }

  if (isDbImmutabilityResponse(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.NOT_PROVEN,
      result,
      expected_scope,
      note: "DB immutability/append-only guard blocked the mutation; this is not proof of an RLS policy",
      proof_detail: "db_immutability_proof",
    });
  }

  if (isValidationFailureResponse(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.VALIDATION_FAILURE,
      result,
      expected_scope,
      note: "Schema/FK/check/unique failure does not prove authorization/RLS denial",
    });
  }

  return buildProbe({
    role,
    operation,
    table,
    expected: "deny",
    mandatory,
    classification: CLASSIFICATION.NOT_PROVEN,
    result,
    expected_scope,
    note: `HTTP ${result.status} did not prove authorization/RLS denial`,
  });
}

function classifyKnownRowVisibilityDenyProbe({ role, operation, table, result, mandatory = true, expected_scope, knownTargetExists, notProvenNote }) {
  if (!knownTargetExists) {
    return buildManualNotProvenProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      expected_scope,
      note: notProvenNote,
    });
  }

  if (isTransportFailure(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.TRANSPORT_FAILURE,
      result,
      expected_scope,
      note: result.error || "Transport failure",
    });
  }

  if (!result.ok) {
    if (isRlsDeniedResponse(result)) {
      return buildProbe({
        role,
        operation,
        table,
        expected: "deny",
        mandatory,
        classification: CLASSIFICATION.PROVEN_RLS_DENY,
        result,
        expected_scope,
        note: "Authorization/RLS denial proven",
      });
    }

    if (isValidationFailureResponse(result)) {
      return buildProbe({
        role,
        operation,
        table,
        expected: "deny",
        mandatory,
        classification: CLASSIFICATION.VALIDATION_FAILURE,
        result,
        expected_scope,
        note: "Validation/schema failure does not prove visibility denial",
      });
    }

    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.NOT_PROVEN,
      result,
      expected_scope,
      note: `HTTP ${result.status} did not prove visibility denial`,
    });
  }

  const rows = Array.isArray(result.body) ? result.body : [];
  if (rows.length === 0) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      mandatory,
      classification: CLASSIFICATION.PROVEN_RLS_DENY,
      result,
      expected_scope,
      actual_row_count: 0,
      note: "Known retained row was filtered from the result set",
    });
  }

  return buildProbe({
    role,
    operation,
    table,
    expected: "deny",
    mandatory,
    classification: CLASSIFICATION.UNEXPECTED_ALLOW,
    result,
    expected_scope,
    actual_row_count: rows.length,
    note: "Known retained row remained visible across the denied boundary",
  });
}

async function discoverScopeRows(supabaseUrl, anonKey, accessToken) {
  const scopeFilter = `?work_order_id=eq.${FIXTURE_SCOPE.work_order_id}&operational_job_id=eq.${FIXTURE_SCOPE.operational_job_id}`;

  const [
    governanceLink,
    applicability,
    evidenceRequirements,
    workerAssignment,
    qaInspection,
    completionEvidence,
    workOrderEvent,
    serviceException,
    correctiveAction,
    customerOutcome,
  ] = await Promise.all([
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "work_order_governance_link", {
      filter: `${scopeFilter}&select=id,organization_id,business_unit_id,jurisdiction_id,configuration_version_id,work_order_id,operational_job_id,checklist_version_reference,task_definition_reference,sop_reference_snapshot,governance_snapshot,metadata&limit=2`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "work_order_wave4_applicability", {
      filter: `${scopeFilter}&select=id,organization_id,business_unit_id,jurisdiction_id,work_order_id,operational_job_id,applicability_status,enrollment_source,metadata&limit=2`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "work_order_evidence_requirement", {
      filter: `${scopeFilter}&select=id,organization_id,business_unit_id,work_order_governance_link_id,work_order_id,operational_job_id,requirement_key,evidence_type,required_count,is_mandatory,requires_external_reference&limit=20`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "worker_assignment", {
      filter: `?id=eq.${FIXTURE_SCOPE.worker_assignment_id}&select=id,organization_id,business_unit_id,operational_job_id,schedule_window_id,worker_id,assignment_role,assignment_status&limit=1`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "qa_inspection", {
      filter: `?id=eq.${FIXTURE_SCOPE.failed_qa_inspection_id}&select=id,organization_id,business_unit_id,operational_job_id,work_order_id,inspection_status,inspection_type&limit=1`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "completion_evidence", {
      filter: `${scopeFilter}&select=id,organization_id,business_unit_id,operational_job_id,work_order_id,worker_assignment_id,evidence_type,storage_system,storage_reference&order=created_at.asc&limit=20`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "work_order_event", {
      filter: `${scopeFilter}&select=id,organization_id,business_unit_id,operational_job_id,work_order_id,worker_assignment_id,event_type,event_payload&order=created_at.asc&limit=20`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "service_exception", {
      filter: `${scopeFilter}&select=id,organization_id,business_unit_id,operational_job_id,work_order_id,qa_inspection_id,corrective_action_id,triage_status&limit=20`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "corrective_action", {
      filter: `${scopeFilter}&select=id,organization_id,business_unit_id,operational_job_id,work_order_id,qa_inspection_id,action_status,action_type&limit=20`,
      prefer: "return=representation",
    }),
    restProbe(supabaseUrl, anonKey, accessToken, "GET", "customer_outcome", {
      filter: `${scopeFilter}&select=id,organization_id,business_unit_id,operational_job_id,work_order_id,outcome_status,outcome_type&limit=20`,
      prefer: "return=representation",
    }),
  ]);

  const pick = (result, predicate = () => true) => {
    const rows = Array.isArray(result.body) ? result.body : [];
    return rows.find(predicate) ?? null;
  };

  return {
    governanceLink,
    applicability,
    evidenceRequirements,
    workerAssignment,
    qaInspection,
    completionEvidence,
    workOrderEvent,
    serviceException,
    correctiveAction,
    customerOutcome,
    governanceLinkRow: pick(governanceLink, (row) => row.work_order_id === FIXTURE_SCOPE.work_order_id && row.operational_job_id === FIXTURE_SCOPE.operational_job_id),
    applicabilityRow: pick(applicability, (row) => row.work_order_id === FIXTURE_SCOPE.work_order_id && row.operational_job_id === FIXTURE_SCOPE.operational_job_id),
    evidenceRequirementRows: Array.isArray(evidenceRequirements.body)
      ? evidenceRequirements.body.filter((row) => row.work_order_id === FIXTURE_SCOPE.work_order_id && row.operational_job_id === FIXTURE_SCOPE.operational_job_id)
      : [],
    workerAssignmentRow: pick(
      workerAssignment,
      (row) =>
        row.id === FIXTURE_SCOPE.worker_assignment_id &&
        row.worker_id === FIXTURE_SCOPE.worker_id &&
        row.operational_job_id === FIXTURE_SCOPE.operational_job_id
    ),
    qaInspectionRow: pick(qaInspection, (row) => row.id === FIXTURE_SCOPE.failed_qa_inspection_id),
    completionEvidenceRow: pick(completionEvidence, (row) => row.work_order_id === FIXTURE_SCOPE.work_order_id),
    workOrderEventRow: pick(workOrderEvent, (row) => row.work_order_id === FIXTURE_SCOPE.work_order_id),
    serviceExceptionRows: Array.isArray(serviceException.body)
      ? serviceException.body.filter((row) => row.work_order_id === FIXTURE_SCOPE.work_order_id)
      : [],
    correctiveActionRows: Array.isArray(correctiveAction.body)
      ? correctiveAction.body.filter((row) => row.work_order_id === FIXTURE_SCOPE.work_order_id)
      : [],
    customerOutcomeRows: Array.isArray(customerOutcome.body)
      ? customerOutcome.body.filter((row) => row.work_order_id === FIXTURE_SCOPE.work_order_id)
      : [],
  };
}

function buildDuplicateGovernancePayload(scope) {
  if (!scope.governanceLinkRow) return null;
  const row = scope.governanceLinkRow;
  return {
    organization_id: row.organization_id,
    business_unit_id: row.business_unit_id,
    jurisdiction_id: row.jurisdiction_id,
    operational_job_id: row.operational_job_id,
    work_order_id: row.work_order_id,
    configuration_version_id: row.configuration_version_id,
    checklist_version_reference: row.checklist_version_reference ?? null,
    task_definition_reference: row.task_definition_reference ?? null,
    sop_reference_snapshot: Array.isArray(row.sop_reference_snapshot) ? row.sop_reference_snapshot : [],
    governance_snapshot: row.governance_snapshot ?? {},
    metadata: {
      ...(row.metadata ?? {}),
      harness_probe: "duplicate_governance_insert",
      retained_scope: true,
    },
  };
}

function buildQaImpersonationPayload(scope, label) {
  const qaRow = scope.qaInspectionRow;
  if (!qaRow) return null;
  return {
    organization_id: qaRow.organization_id,
    business_unit_id: qaRow.business_unit_id,
    operational_job_id: qaRow.operational_job_id,
    work_order_id: qaRow.work_order_id,
    inspection_status: "passed",
    inspection_type: "standard",
    findings: { harness_probe: label, retained_scope: true },
    inspected_at: new Date().toISOString(),
    metadata: { harness_probe: label, retained_scope: true },
  };
}

function buildNoOpGovernancePatchPayload(scope) {
  const row = scope.governanceLinkRow;
  if (!row) return null;
  return {
    jurisdiction_id: row.jurisdiction_id,
    configuration_version_id: row.configuration_version_id,
    checklist_version_reference: row.checklist_version_reference ?? null,
    task_definition_reference: row.task_definition_reference ?? null,
    sop_reference_snapshot: Array.isArray(row.sop_reference_snapshot) ? row.sop_reference_snapshot : [],
    governance_snapshot: row.governance_snapshot ?? {},
    metadata: row.metadata ?? {},
  };
}

function buildCustomerOutcomePayload(scope, label) {
  const row = scope.governanceLinkRow;
  if (!row) return null;
  return {
    organization_id: row.organization_id,
    business_unit_id: row.business_unit_id,
    operational_job_id: row.operational_job_id,
    work_order_id: row.work_order_id,
    customer_id: FIXTURE_SCOPE.customer_id,
    contact_id: FIXTURE_SCOPE.contact_id,
    service_location_id: FIXTURE_SCOPE.service_location_id,
    outcome_type: "other",
    outcome_status: "reported",
    outcome_source: "other",
    description: `Wave4 preview acceptance probe: ${label}`,
    details: { harness_probe: label, retained_scope: true },
    metadata: { harness_probe: label, retained_scope: true },
  };
}

function buildWorkerImpersonationServiceExceptionPayload(scope, label) {
  const row = scope.governanceLinkRow;
  if (!row) return null;
  return {
    organization_id: row.organization_id,
    business_unit_id: row.business_unit_id,
    operational_job_id: row.operational_job_id,
    work_order_id: row.work_order_id,
    source_type: "worker",
    actor_worker_id: FIXTURE_SCOPE.worker_id,
    exception_category: "documentation",
    severity: "low",
    description: `Wave4 preview acceptance probe: ${label}`,
    findings: { harness_probe: label, retained_scope: true },
    metadata: { harness_probe: label, retained_scope: true },
  };
}

async function probeOfficeOps(supabaseUrl, anonKey, token) {
  const scope = await discoverScopeRows(supabaseUrl, anonKey, token);
  const probes = [];

  probes.push(buildAllowSelectProbe({
    role: "office_ops",
    operation: "SELECT work_order_governance_link (retained scope)",
    table: "work_order_governance_link",
    result: scope.governanceLink,
    expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    verifier: (rows) => rows.some((row) => row.id === scope.governanceLinkRow?.id && row.work_order_id === FIXTURE_SCOPE.work_order_id),
    noteIfMissing: "Allow proof requires the retained governance_link row for the exact work_order/job scope",
  }));

  probes.push(buildAllowSelectProbe({
    role: "office_ops",
    operation: "SELECT work_order_wave4_applicability (retained scope)",
    table: "work_order_wave4_applicability",
    result: scope.applicability,
    expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    verifier: (rows) => rows.some((row) => row.id === scope.applicabilityRow?.id && row.work_order_id === FIXTURE_SCOPE.work_order_id),
    noteIfMissing: "Allow proof requires the retained applicability row for the exact work_order/job scope",
  }));

  probes.push(buildAllowSelectProbe({
    role: "office_ops",
    operation: "SELECT work_order_evidence_requirement (retained scope)",
    table: "work_order_evidence_requirement",
    result: scope.evidenceRequirements,
    expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    verifier: (rows) => rows.some((row) => scope.evidenceRequirementRows.some((known) => known.id === row.id)),
    noteIfMissing: "Allow proof requires at least one retained governed evidence requirement in the exact work_order/job scope",
  }));

  probes.push(buildAllowSelectProbe({
    role: "office_ops",
    operation: "SELECT qa_inspection (retained failed QA fixture)",
    table: "qa_inspection",
    result: scope.qaInspection,
    expected_scope: { id: FIXTURE_SCOPE.failed_qa_inspection_id },
    verifier: (rows) => rows.some((row) => row.id === FIXTURE_SCOPE.failed_qa_inspection_id),
    noteIfMissing: "Allow proof requires the retained failed qa_inspection fixture row",
  }));

  const duplicateQaPayload = buildQaImpersonationPayload(scope, "office_ops_qa_impersonation_preview_acceptance");
  if (!duplicateQaPayload) {
    probes.push(buildManualNotProvenProbe({
      role: "office_ops",
      operation: "INSERT qa_inspection (QA impersonation preview acceptance record)",
      table: "qa_inspection",
      expected: "deny",
      note: "Safe schema-valid retained-scope payload could not be resolved",
      expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    }));
  } else {
    const qaInsert = await restProbe(supabaseUrl, anonKey, token, "POST", "qa_inspection", {
      body: duplicateQaPayload,
      prefer: "return=representation",
    });
    probes.push(classifyDenyMutationProbe({
      role: "office_ops",
      operation: "INSERT qa_inspection (QA impersonation preview acceptance record)",
      table: "qa_inspection",
      result: qaInsert,
      expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
      allowNote: "office_ops unexpectedly created a QA-passed preview acceptance row",
    }));
  }

  const governancePatchPayload = buildNoOpGovernancePatchPayload(scope);
  if (!governancePatchPayload) {
    probes.push(buildManualNotProvenProbe({
      role: "office_ops",
      operation: "PATCH work_order_governance_link (no-op retained scope update)",
      table: "work_order_governance_link",
      expected: "deny",
      note: "Retained governance row could not be resolved for safe no-op update proof",
      expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    }));
  } else {
    const governancePatch = await restProbe(supabaseUrl, anonKey, token, "PATCH", "work_order_governance_link", {
      filter: `?id=eq.${scope.governanceLinkRow.id}`,
      body: governancePatchPayload,
      prefer: "return=representation",
    });
    probes.push(classifyDenyMutationProbe({
      role: "office_ops",
      operation: "PATCH work_order_governance_link (no-op retained scope update)",
      table: "work_order_governance_link",
      result: governancePatch,
      expected_scope: { id: scope.governanceLinkRow.id, work_order_id: FIXTURE_SCOPE.work_order_id },
      allowNote: "office_ops unexpectedly received update authority on retained governance scope",
      allowEmptyRepresentationDeny: true,
    }));
  }

  return probes;
}

async function probeWorker(supabaseUrl, anonKey, token) {
  const scope = await discoverScopeRows(supabaseUrl, anonKey, token);
  const probes = [];

  probes.push(buildAllowSelectProbe({
    role: "worker",
    operation: "SELECT worker_assignment (own retained fixture row)",
    table: "worker_assignment",
    result: scope.workerAssignment,
    expected_scope: {
      id: FIXTURE_SCOPE.worker_assignment_id,
      worker_id: FIXTURE_SCOPE.worker_id,
      operational_job_id: FIXTURE_SCOPE.operational_job_id,
    },
    verifier: (rows) =>
      rows.some(
        (row) =>
          row.id === FIXTURE_SCOPE.worker_assignment_id &&
          row.worker_id === FIXTURE_SCOPE.worker_id &&
          row.operational_job_id === FIXTURE_SCOPE.operational_job_id
      ),
    noteIfMissing:
      "Allow proof requires worker_assignment_id=e1100000-0000-0000-0000-000000000010 for worker_id=1b3a6903-0c50-4a95-afc3-280628c10508 on operational_job_id=e1100000-0000-0000-0000-00000000000e",
  }));

  probes.push(buildAllowSelectProbe({
    role: "worker",
    operation: "SELECT work_order_governance_link (retained scope)",
    table: "work_order_governance_link",
    result: scope.governanceLink,
    expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    verifier: (rows) => rows.some((row) => row.work_order_id === FIXTURE_SCOPE.work_order_id && row.operational_job_id === FIXTURE_SCOPE.operational_job_id),
    noteIfMissing: "Allow proof requires the worker to see the retained governance link for the assigned scope",
  }));

  const governancePatchPayload = buildNoOpGovernancePatchPayload(scope);
  if (!governancePatchPayload) {
    probes.push(buildManualNotProvenProbe({
      role: "worker",
      operation: "PATCH work_order_governance_link (no-op retained scope update)",
      table: "work_order_governance_link",
      expected: "deny",
      note: "Retained governance row could not be resolved for safe no-op update proof",
      expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    }));
  } else {
    const governancePatch = await restProbe(supabaseUrl, anonKey, token, "PATCH", "work_order_governance_link", {
      filter: `?id=eq.${scope.governanceLinkRow.id}`,
      body: governancePatchPayload,
      prefer: "return=representation",
    });
    probes.push(classifyDenyMutationProbe({
      role: "worker",
      operation: "PATCH work_order_governance_link (no-op retained scope update)",
      table: "work_order_governance_link",
      result: governancePatch,
      expected_scope: { id: scope.governanceLinkRow.id, work_order_id: FIXTURE_SCOPE.work_order_id },
      allowNote: "worker unexpectedly received governance update authority on retained scope",
      allowEmptyRepresentationDeny: true,
    }));
  }

  const duplicateQaPayload = buildQaImpersonationPayload(scope, "worker_qa_impersonation_preview_acceptance");
  if (!duplicateQaPayload) {
    probes.push(buildManualNotProvenProbe({
      role: "worker",
      operation: "INSERT qa_inspection (worker QA impersonation preview acceptance record)",
      table: "qa_inspection",
      expected: "deny",
      note: "Safe schema-valid retained-scope payload could not be resolved",
      expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    }));
  } else {
    const qaInsert = await restProbe(supabaseUrl, anonKey, token, "POST", "qa_inspection", {
      body: duplicateQaPayload,
      prefer: "return=representation",
    });
    probes.push(classifyDenyMutationProbe({
      role: "worker",
      operation: "INSERT qa_inspection (worker QA impersonation preview acceptance record)",
      table: "qa_inspection",
      result: qaInsert,
      expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
      allowNote: "worker unexpectedly created a QA-passed preview acceptance row",
    }));
  }

  const customerOutcomePayload = buildCustomerOutcomePayload(scope, "worker_customer_outcome_admin_surface");
  if (!customerOutcomePayload) {
    probes.push(buildManualNotProvenProbe({
      role: "worker",
      operation: "INSERT customer_outcome (admin surface preview acceptance record)",
      table: "customer_outcome",
      expected: "deny",
      note: "Schema-valid retained-scope customer_outcome payload could not be resolved",
      expected_scope: { operational_job_id: FIXTURE_SCOPE.operational_job_id, work_order_id: FIXTURE_SCOPE.work_order_id },
    }));
  } else {
    const customerOutcomeInsert = await restProbe(supabaseUrl, anonKey, token, "POST", "customer_outcome", {
      body: customerOutcomePayload,
      prefer: "return=representation",
    });
    probes.push(classifyDenyMutationProbe({
      role: "worker",
      operation: "INSERT customer_outcome (admin surface preview acceptance record)",
      table: "customer_outcome",
      result: customerOutcomeInsert,
      expected_scope: { operational_job_id: FIXTURE_SCOPE.operational_job_id, work_order_id: FIXTURE_SCOPE.work_order_id },
      allowNote: "worker unexpectedly created an admin-only preview customer_outcome row",
    }));
  }

  probes.push(buildManualNotProvenProbe({
    role: "worker",
    operation: "SELECT worker_assignment (cross-scope retained row)",
    table: "worker_assignment",
    expected: "deny",
    mandatory: false,
    note: "No real second-org retained worker_assignment fixture was discoverable via role-authorized reads; invented UUIDs are forbidden",
    expected_scope: { second_org_fixture_required: true },
  }));

  return probes;
}

async function probeQa(supabaseUrl, anonKey, token) {
  const scope = await discoverScopeRows(supabaseUrl, anonKey, token);
  const probes = [];

  probes.push(buildAllowSelectProbe({
    role: "qa",
    operation: "SELECT qa_inspection (retained failed QA fixture)",
    table: "qa_inspection",
    result: scope.qaInspection,
    expected_scope: { id: FIXTURE_SCOPE.failed_qa_inspection_id },
    verifier: (rows) => rows.some((row) => row.id === FIXTURE_SCOPE.failed_qa_inspection_id),
    noteIfMissing: "Allow proof requires the retained failed qa_inspection fixture row",
  }));

  probes.push(buildAllowSelectProbe({
    role: "qa",
    operation: "SELECT work_order_governance_link (retained scope)",
    table: "work_order_governance_link",
    result: scope.governanceLink,
    expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    verifier: (rows) => rows.some((row) => row.work_order_id === FIXTURE_SCOPE.work_order_id && row.operational_job_id === FIXTURE_SCOPE.operational_job_id),
    noteIfMissing: "Allow proof requires the QA role to see the retained governance link for the exact scope",
  }));

  const governancePatchPayload = buildNoOpGovernancePatchPayload(scope);
  if (!governancePatchPayload) {
    probes.push(buildManualNotProvenProbe({
      role: "qa",
      operation: "PATCH work_order_governance_link (no-op retained scope update)",
      table: "work_order_governance_link",
      expected: "deny",
      note: "Retained governance row could not be resolved for safe no-op update proof",
      expected_scope: { work_order_id: FIXTURE_SCOPE.work_order_id, operational_job_id: FIXTURE_SCOPE.operational_job_id },
    }));
  } else {
    const governancePatch = await restProbe(supabaseUrl, anonKey, token, "PATCH", "work_order_governance_link", {
      filter: `?id=eq.${scope.governanceLinkRow.id}`,
      body: governancePatchPayload,
      prefer: "return=representation",
    });
    probes.push(classifyDenyMutationProbe({
      role: "qa",
      operation: "PATCH work_order_governance_link (no-op retained scope update)",
      table: "work_order_governance_link",
      result: governancePatch,
      expected_scope: { id: scope.governanceLinkRow.id, work_order_id: FIXTURE_SCOPE.work_order_id },
      allowNote: "qa unexpectedly received governance update authority on retained scope",
      allowEmptyRepresentationDeny: true,
    }));
  }

  const customerOutcomePayload = buildCustomerOutcomePayload(scope, "qa_customer_outcome_admin_surface");
  if (!customerOutcomePayload) {
    probes.push(buildManualNotProvenProbe({
      role: "qa",
      operation: "INSERT customer_outcome (admin surface preview acceptance record)",
      table: "customer_outcome",
      expected: "deny",
      note: "Schema-valid retained-scope customer_outcome payload could not be resolved",
      expected_scope: { operational_job_id: FIXTURE_SCOPE.operational_job_id, work_order_id: FIXTURE_SCOPE.work_order_id },
    }));
  } else {
    const customerOutcomeInsert = await restProbe(supabaseUrl, anonKey, token, "POST", "customer_outcome", {
      body: customerOutcomePayload,
      prefer: "return=representation",
    });
    probes.push(classifyDenyMutationProbe({
      role: "qa",
      operation: "INSERT customer_outcome (admin surface preview acceptance record)",
      table: "customer_outcome",
      result: customerOutcomeInsert,
      expected_scope: { operational_job_id: FIXTURE_SCOPE.operational_job_id, work_order_id: FIXTURE_SCOPE.work_order_id },
      allowNote: "qa unexpectedly created an admin-only preview customer_outcome row",
    }));
  }

  const workerImpersonationPayload = buildWorkerImpersonationServiceExceptionPayload(scope, "qa_worker_impersonation_preview_acceptance");
  if (!workerImpersonationPayload) {
    probes.push(buildManualNotProvenProbe({
      role: "qa",
      operation: "INSERT service_exception (worker impersonation preview acceptance record)",
      table: "service_exception",
      expected: "deny",
      note: "Schema-valid retained-scope service_exception payload could not be resolved",
      expected_scope: { operational_job_id: FIXTURE_SCOPE.operational_job_id, work_order_id: FIXTURE_SCOPE.work_order_id },
    }));
  } else {
    const workerImpersonationInsert = await restProbe(supabaseUrl, anonKey, token, "POST", "service_exception", {
      body: workerImpersonationPayload,
      prefer: "return=representation",
    });
    probes.push(classifyDenyMutationProbe({
      role: "qa",
      operation: "INSERT service_exception (worker impersonation preview acceptance record)",
      table: "service_exception",
      result: workerImpersonationInsert,
      expected_scope: { operational_job_id: FIXTURE_SCOPE.operational_job_id, work_order_id: FIXTURE_SCOPE.work_order_id },
      allowNote: "qa unexpectedly impersonated a worker-originated mutation",
    }));
  }

  probes.push(buildManualNotProvenProbe({
    role: "qa",
    operation: "SELECT qa_inspection (cross-scope retained row)",
    table: "qa_inspection",
    expected: "deny",
    mandatory: false,
    note: "No real second-org retained QA fixture was discoverable via role-authorized reads; invented UUIDs are forbidden",
    expected_scope: { second_org_fixture_required: true },
  }));

  return probes;
}

async function probeAnon(supabaseUrl, anonKey) {
  const result = await restProbe(supabaseUrl, anonKey, null, "GET", "work_order", {
    filter: `?id=eq.${FIXTURE_SCOPE.work_order_id}&select=id,operational_job_id,organization_id,work_order_status&limit=1`,
    prefer: "return=representation",
  });

  return [
    classifyKnownRowVisibilityDenyProbe({
      role: "anon",
      operation: "SELECT work_order (retained canonical row, no bearer token)",
      table: "work_order",
      result,
      expected_scope: { id: FIXTURE_SCOPE.work_order_id },
      knownTargetExists: true,
      notProvenNote: "The retained work_order fixture must already exist for anon boundary proof",
    }),
  ];
}

function summarizeProbes(role, probes) {
  const mandatory = probes.filter((probe) => probe.mandatory);
  const optional = probes.filter((probe) => !probe.mandatory);
  const allowMandatory = mandatory.filter((probe) => probe.expected === "allow");
  const denyMandatory = mandatory.filter((probe) => probe.expected === "deny");
  const provenCount = probes.filter((probe) => probe.pass).length;
  const failedCount = probes.filter((probe) => !probe.pass && probe.classification !== CLASSIFICATION.NOT_PROVEN).length;
  const notProvenCount = probes.filter((probe) => probe.classification === CLASSIFICATION.NOT_PROVEN).length;
  const mandatoryNotProven = mandatory.filter((probe) => probe.classification === CLASSIFICATION.NOT_PROVEN);
  const optionalNotProven = optional.filter((probe) => probe.classification === CLASSIFICATION.NOT_PROVEN);

  return {
    role,
    probes,
    allow_pass: allowMandatory.every((probe) => probe.pass),
    deny_pass: denyMandatory.every((probe) => probe.pass),
    passed: mandatory.every((probe) => probe.pass),
    proven_count: provenCount,
    failed_count: failedCount,
    not_proven_count: notProvenCount,
    mandatory_not_proven_count: mandatoryNotProven.length,
    optional_not_proven_count: optionalNotProven.length,
    mandatory_failures: mandatory
      .filter((probe) => !probe.pass && probe.classification !== CLASSIFICATION.NOT_PROVEN)
      .map((probe) => probe.operation),
    mandatory_not_proven: mandatoryNotProven.map((probe) => probe.operation),
    optional_not_proven: optionalNotProven.map((probe) => probe.operation),
  };
}

export default async function handler(req, res) {
  // ── Wave Dispatcher ─────────────────────────────────────────────────────────
  // Parse the body once, before any per-wave guards, to check for an explicit
  // wave discriminator. This is safe because we only peek at two scalar fields.
  if (req.method === "POST") {
    let dispatchBody = {};
    try {
      dispatchBody = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (_) {
      // malformed JSON — let the per-wave handler return the error
    }
    const reqWave = String(dispatchBody.wave || "").trim().toLowerCase();
    const reqContractVersion = String(dispatchBody.contract_version || "").trim().toLowerCase();

    const isWave5Request =
      reqWave === "wave5" || reqContractVersion === "wave5-rls-acceptance-v1";
    const isWave4Request =
      !reqWave ||
      reqWave === "wave4" ||
      reqContractVersion === "wave4-rls-acceptance-v2" ||
      reqContractVersion === "wave4-rls-acceptance-v1";

    if (isWave5Request) {
      return runWave5RlsAcceptanceHandler(req, res);
    }
    if (!isWave4Request) {
      return res.status(400).json({
        error:
          "Unknown acceptance harness mode. Supported: wave4 (default) or wave5. " +
          "Set { \"wave\": \"wave5\" } or { \"contract_version\": \"wave5-rls-acceptance-v1\" } for Wave 5.",
      });
    }
  }
  // ── End Dispatcher — Wave 4 handler follows unchanged ────────────────────
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isHarnessEnabled()) {
    return res.status(403).json({
      error: "Wave 4 RLS acceptance harness is disabled. Set SERVICEOS_W4_RLS_HARNESS_ENABLED=true in Preview/test environment to enable.",
      contract_version: CONTRACT_VERSION,
    });
  }

  const env = getEnvironment();
  if (!env) {
    return res.status(403).json({
      error: "Wave 4 RLS acceptance harness is PROHIBITED in Production or when SERVICEOS_ENVIRONMENT is missing/unknown. This harness requires SERVICEOS_ENVIRONMENT=preview or SERVICEOS_ENVIRONMENT=test.",
      contract_version: CONTRACT_VERSION,
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return res.status(503).json({ error: "SUPABASE_URL is required", contract_version: CONTRACT_VERSION });
  }

  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    return res.status(503).json({
      error: "SUPABASE_ANON_KEY is required — provide a server-only Preview/test anon key. Do not use VITE_* or NEXT_PUBLIC_* keys for harness credentials.",
      contract_version: CONTRACT_VERSION,
    });
  }

  const runAt = new Date().toISOString();
  const identityConfig = {
    office_ops: {
      email: process.env.SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL,
      password: process.env.SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD,
    },
    worker: {
      email: process.env.SERVICEOS_W4_RLS_WORKER_EMAIL,
      password: process.env.SERVICEOS_W4_RLS_WORKER_PASSWORD,
    },
    qa: {
      email: process.env.SERVICEOS_W4_RLS_QA_EMAIL,
      password: process.env.SERVICEOS_W4_RLS_QA_PASSWORD,
    },
  };

  const missingIdentities = Object.entries(identityConfig)
    .filter(([, cfg]) => !cfg.email || !cfg.password)
    .map(([role]) => role);

  if (missingIdentities.length > 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "Required Wave 4 role identity credentials are not configured. Configure the environment variables for all roles before running acceptance.",
      missing_identities: missingIdentities,
      required_env_vars: [
        "SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL", "SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD",
        "SERVICEOS_W4_RLS_WORKER_EMAIL", "SERVICEOS_W4_RLS_WORKER_PASSWORD",
        "SERVICEOS_W4_RLS_QA_EMAIL", "SERVICEOS_W4_RLS_QA_PASSWORD",
      ],
      note: "Runtime acceptance still must determine whether these identities exist in the Preview Supabase project. DO NOT create auth users automatically without explicit authorization.",
      environment: env,
      run_at: runAt,
    });
  }

  const tokens = {};
  const authErrors = {};
  for (const [role, cfg] of Object.entries(identityConfig)) {
    try {
      tokens[role] = await signInWithPassword(supabaseUrl, anonKey, cfg.email, cfg.password);
    } catch (err) {
      authErrors[role] = { code: err.code, message: err.message };
    }
  }

  if (Object.keys(authErrors).length > 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "Authentication failed for one or more Wave 4 role identities.",
      auth_errors: authErrors,
      note: "Runtime acceptance still must determine whether these identities exist in the Preview Supabase project. DO NOT create auth users automatically without explicit authorization.",
      environment: env,
      run_at: runAt,
    });
  }

  const [officeOpsProbes, workerProbes, qaProbes, anonProbes] = await Promise.all([
    probeOfficeOps(supabaseUrl, anonKey, tokens.office_ops),
    probeWorker(supabaseUrl, anonKey, tokens.worker),
    probeQa(supabaseUrl, anonKey, tokens.qa),
    probeAnon(supabaseUrl, anonKey),
  ]);

  const officeOps = summarizeProbes("office_ops", officeOpsProbes);
  const worker = summarizeProbes("worker", workerProbes);
  const qa = summarizeProbes("qa", qaProbes);
  const anon = summarizeProbes("anon", anonProbes);

  const sections = [officeOps, worker, qa, anon];
  const provenCount = sections.reduce((sum, section) => sum + section.proven_count, 0);
  const failedCount = sections.reduce((sum, section) => sum + section.failed_count, 0);
  const notProvenCount = sections.reduce((sum, section) => sum + section.not_proven_count, 0);
  const mandatoryNotProvenCount = sections.reduce((sum, section) => sum + section.mandatory_not_proven_count, 0);
  const optionalNotProvenCount = sections.reduce((sum, section) => sum + section.optional_not_proven_count, 0);
  const passed = sections.every((section) => section.passed) && mandatoryNotProvenCount === 0;

  const contract = {
    contract_version: CONTRACT_VERSION,
    office_ops: officeOps,
    worker,
    qa,
    anon,
    passed,
    proven_count: provenCount,
    failed_count: failedCount,
    not_proven_count: notProvenCount,
    mandatory_not_proven_count: mandatoryNotProvenCount,
    optional_not_proven_count: optionalNotProvenCount,
    missing_identities: [],
    environment: env,
    run_at: runAt,
    notes: [
      "No cleanup or deletion of Wave 3/4 retained evidence was performed.",
      "No fixture rerun occurred.",
      "No SQL migration was executed.",
      "All authenticated probes used role-specific Supabase sessions; anon probes used apikey only and no bearer token.",
      "passed=true is based only on the mandatory safe closure contract; optional not_proven probes are reported separately and do not block closure.",
    ],
  };

  return res.status(passed ? 200 : 422).json(contract);
}
