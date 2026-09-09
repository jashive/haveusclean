import { authenticatedRestFetchWithRefresh, getValidAccessToken } from "./serviceosAuthClient.js";

export const HIRING_STAGES = Object.freeze(["Applied", "Screening", "Interview", "Offer", "Operable / Hired"]);

const STAGE_MAP = Object.freeze({
  Applicant: "Applied",
  Screening: "Screening",
  "Documents Pending": "Screening",
  "Training / Standards": "Interview",
  "Compliance Approved": "Offer",
  "ServiceOS Ready": "Operable / Hired",
});

function array(value) { return Array.isArray(value) ? value : []; }
function related(value) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }

export function hiringStage(value) { return STAGE_MAP[value] || "Applied"; }

export function normalizeApplicant(candidate, marketCode, now = Date.now()) {
  const submittedAt = candidate.submitted_at || candidate.created_at || null;
  const ageDays = submittedAt ? Math.max(0, Math.floor((now - new Date(submittedAt).getTime()) / 86400000)) : null;
  const completedRaw = candidate.document_completed_count ?? candidate.documents_completed;
  const requiredRaw = candidate.document_required_count ?? candidate.documents_required;
  const completed = completedRaw == null ? null : Number(completedRaw);
  const required = requiredRaw == null ? null : Number(requiredRaw);
  const canonicalStage = candidate.pipeline_stage || candidate.current_stage || "Applicant";
  return {
    ...candidate,
    id: candidate.engagement_id || candidate.applicant_submission_id,
    name: candidate.display_name || "Applicant",
    marketCode,
    canonicalStage,
    stage: hiringStage(canonicalStage),
    ageDays,
    documentCompleted: Number.isFinite(completed) ? completed : null,
    documentRequired: Number.isFinite(required) ? required : null,
    nextAction: candidate.next_required_action || candidate.activation_note || (
      canonicalStage === "ServiceOS Ready" ? "Activate for dispatch" :
      canonicalStage === "Compliance Approved" ? "Confirm activation readiness" :
      canonicalStage === "Training / Standards" ? "Complete interview and standards" :
      canonicalStage === "Documents Pending" ? "Review required documents" :
      canonicalStage === "Screening" ? "Complete screening" : "Review application"
    ),
  };
}

async function workforceApi(path, options = {}) {
  const accessToken = await getValidAccessToken();
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) throw new Error(data?.error || "Team & Hiring request failed.");
  return data;
}

export async function fetchApplicantPipeline(businessUnitId, marketCode) {
  const data = await workforceApi(`/api/workforce/dashboard?action=pipeline&businessUnitId=${encodeURIComponent(businessUnitId)}`);
  return array(data?.pipeline?.candidates).map((candidate) => normalizeApplicant(candidate, marketCode));
}

export async function fetchApplicantInspector(businessUnitId, applicant) {
  const action = applicant.engagement_id ? "inspector" : "applicant_inspector";
  const key = applicant.engagement_id ? "engagementId" : "applicantSubmissionId";
  const data = await workforceApi(`/api/workforce/dashboard?action=${action}&businessUnitId=${encodeURIComponent(businessUnitId)}&${key}=${encodeURIComponent(applicant.id)}`);
  return data.inspector || data.applicantInspector || null;
}

export async function activateApplicant(businessUnitId, engagementId) {
  return workforceApi("/api/workforce/dashboard", { method: "POST", body: JSON.stringify({ action: "activate", businessUnitId, engagementId, idempotencyKey: `team-ui-${engagementId}-${Date.now()}` }) });
}

export function normalizeContractor(worker, assignments, compensation) {
  const currentAssignment = assignments.find((item) => item.worker_id === worker.id) || null;
  const rate = compensation.find((item) => item.worker_id === worker.id) || null;
  return {
    ...worker,
    dispatchReady: worker.status === "active",
    currentAssignment: related(currentAssignment?.operational_job)?.service_family || related(currentAssignment?.operational_job)?.operational_status || null,
    assignmentStatus: currentAssignment?.assignment_status || null,
    rateValue: rate?.rate_value ?? null,
    currencyCode: rate?.currency_code ?? null,
    compensationMethod: rate?.compensation_method ?? null,
  };
}

export async function fetchActiveContractors(businessUnitId) {
  const id = encodeURIComponent(businessUnitId);
  const [workerResponse, assignmentResponse, compensationResponse] = await Promise.all([
    authenticatedRestFetchWithRefresh(`worker?select=id,display_name,email,phone,status,worker_type,created_at&business_unit_id=eq.${id}&status=in.(active,inactive)&order=display_name.asc`),
    authenticatedRestFetchWithRefresh(`worker_assignment?select=id,worker_id,assignment_status,operational_job:operational_job_id(service_family,operational_status)&business_unit_id=eq.${id}&assignment_status=in.(assigned,acknowledged)&order=created_at.desc`),
    authenticatedRestFetchWithRefresh(`contractor_compensation_version?select=id,worker_id,compensation_method,currency_code,rate_value,compensation_status,effective_from&business_unit_id=eq.${id}&compensation_status=in.(active,approved)&order=effective_from.desc`),
  ]);
  if (![workerResponse, assignmentResponse, compensationResponse].every((response) => response?.ok)) throw new Error("Contractor directory could not be loaded.");
  const [workers, assignments, compensation] = await Promise.all([workerResponse.json(), assignmentResponse.json(), compensationResponse.json()]);
  return array(workers).map((worker) => normalizeContractor(worker, array(assignments), array(compensation)));
}

export async function setContractorDispatchReadiness(workerId, ready) {
  const response = await authenticatedRestFetchWithRefresh(`worker?id=eq.${encodeURIComponent(workerId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: ready ? "active" : "inactive" }) });
  if (!response?.ok) throw new Error(`Dispatch readiness update failed: HTTP ${response?.status ?? "network"}`);
  return array(await response.json())[0] || null;
}
