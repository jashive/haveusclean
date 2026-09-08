import { getValidAccessToken } from "./serviceosAuthClient.js";
import { getSupabaseConfig } from "./supabaseConfig.js";
import { createCompletionEvidence } from "./serviceosOperationsClient.js";
import { buildCompletionEvidencePayload } from "./serviceosOperationsUtils.js";

export const MOBILE_EVIDENCE_STATES = Object.freeze(["queued", "uploading", "verifying", "linked", "error"]);
export const MOBILE_UPLOAD_MAX_ATTEMPTS = 4;
export const MOBILE_UPLOAD_BASE_DELAY_MS = 400;

export function mobileEvidenceEntry(file, index = 0) {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${index}`;
  return { id, file, name: file?.name || `photo-${index + 1}.jpg`, state: "queued", attempt: 0, objectName: null, storageUploaded: false, evidenceId: null, error: "" };
}

export function isRetryableUploadFailure(error) {
  const status = Number(error?.status);
  return error instanceof TypeError || [408, 425, 429].includes(status) || status >= 500;
}

export function uploadBackoffDelay(attempt, baseDelay = MOBILE_UPLOAD_BASE_DELAY_MS) {
  return Math.min(baseDelay * (2 ** Math.max(0, attempt - 1)), 5000);
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function sha256Hex(file) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validatePhoto(file) {
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file?.type)) throw new Error(`${file?.name || "Photo"}: use JPEG, PNG, or WebP.`);
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: photos must be 12 MB or smaller.`);
}

function safeObjectName(entry, assignment, context) {
  if (entry.objectName) return entry.objectName;
  const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "photo.jpg";
  return `${assignment.organization_id}/${assignment.business_unit_id}/${context.operational_job_id}/${assignment.id}/${entry.id}-${safeName}`;
}

async function fetchExistingEvidence(storageReference) {
  const accessToken = await getValidAccessToken();
  const { url, anon } = getSupabaseConfig(import.meta.env);
  const response = await fetch(`${url}/rest/v1/completion_evidence?select=id&storage_reference=eq.${encodeURIComponent(storageReference)}&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw Object.assign(new Error(`Evidence verification failed (${response.status}).`), { status: response.status });
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function uploadObject({ entry, objectName, onState, waitFor = wait, fetchImpl = fetch }) {
  const accessToken = await getValidAccessToken();
  const { url, anon } = getSupabaseConfig(import.meta.env);
  const storagePath = objectName.split("/").map(encodeURIComponent).join("/");
  let lastError;
  for (let attempt = 1; attempt <= MOBILE_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    onState({ state: "uploading", attempt, objectName, error: "" });
    try {
      const response = await fetchImpl(`${url}/storage/v1/object/serviceos-completion-evidence/${storagePath}`, {
        method: "POST",
        headers: { apikey: anon, Authorization: `Bearer ${accessToken}`, "Content-Type": entry.file.type, "x-upsert": "false" },
        body: entry.file,
      });
      if (response.ok || response.status === 409) { onState({ storageUploaded: true, objectName }); return; }
      throw Object.assign(new Error(`${entry.name}: upload failed (${response.status}).`), { status: response.status });
    } catch (error) {
      lastError = error;
      if (!isRetryableUploadFailure(error) || attempt === MOBILE_UPLOAD_MAX_ATTEMPTS) break;
      await waitFor(uploadBackoffDelay(attempt));
    }
  }
  throw lastError;
}

export async function persistMobileEvidenceEntry({ entry, worker, assignment, context, appUserId, onState, waitFor, fetchImpl }) {
  validatePhoto(entry.file);
  const objectName = safeObjectName(entry, assignment, context);
  if (!entry.storageUploaded) await uploadObject({ entry, objectName, onState, waitFor, fetchImpl });
  onState({ state: "verifying", objectName, error: "" });
  const existing = await fetchExistingEvidence(objectName);
  if (existing?.id) {
    onState({ state: "linked", objectName, evidenceId: existing.id, error: "" });
    return existing;
  }
  const accessToken = await getValidAccessToken();
  const hash = await sha256Hex(entry.file);
  const evidence = await createCompletionEvidence(buildCompletionEvidencePayload({
    organizationId: assignment.organization_id,
    businessUnitId: assignment.business_unit_id,
    operationalJobId: context.operational_job_id,
    workOrderId: context.work_order_id,
    workerAssignmentId: assignment.id,
    evidenceType: "photo_after",
    storageSystem: "supabase_storage",
    storageReference: objectName,
    evidencePayload: { original_name: entry.name, mime_type: entry.file.type, byte_size: entry.file.size, sha256: hash },
    capturedAt: new Date().toISOString(),
    capturedByWorkerId: worker.id,
    capturedByAppUserId: appUserId,
    metadata: { source: "worker_mobile_completion", bucket: "serviceos-completion-evidence" },
  }), accessToken);
  onState({ state: "linked", objectName, evidenceId: evidence.id, error: "" });
  return evidence;
}
