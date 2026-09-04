// Workforce W6/W9 Production boundary recovered from the accepted W1-W10 contract.
// All HEMS reads/writes stay server-side. Browser callers never receive HEMS table access.

import crypto from "node:crypto";

const APPLICANT_BUCKET = "hems-hr-applicant-evidence";
const ALLOWED_PROGRAMS = new Set(["HUC_ON_RESIDENTIAL_CLEANER", "HUC_AZ_RESIDENTIAL_CLEANER"]);
const ALLOWED_DOCUMENTS = new Set(["GOV_ID", "PROOF_OF_INSURANCE_BONDING"]);
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function text(value) {
  return String(value ?? "").trim();
}

function bounded(value, max, field) {
  const result = text(value);
  if (result.length > max) throw httpError(400, `${field} exceeds its allowed length.`, "WORKFORCE_FIELD_TOO_LONG");
  return result;
}

function requestOriginAllowed(req) {
  const origin = text(req.headers?.origin);
  if (!origin) return true;
  const configured = text(process.env.WORKFORCE_INTAKE_ALLOWED_ORIGINS)
    .split(",").map((item) => item.trim()).filter(Boolean);
  if (configured.length) return configured.includes(origin);
  try {
    const host = text(req.headers?.["x-forwarded-host"] || req.headers?.host);
    return new URL(origin).host === host;
  } catch { return false; }
}

function sourceFingerprint(req, secret) {
  const ip = text(req.headers?.["x-forwarded-for"]).split(",")[0].trim();
  const agent = bounded(req.headers?.["user-agent"], 1000, "User agent");
  return crypto.createHmac("sha256", secret).update(`${ip}|${agent}`).digest("hex");
}

function normalizedUploadResult(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeStoragePath(path) {
  const value = text(path);
  if (!value || value.startsWith("/") || value.includes("..")) throw httpError(502, "Restricted object path was rejected.", "WORKFORCE_STORAGE_PATH_INVALID");
  return value.split("/").map(encodeURIComponent).join("/");
}

function detectedMime(bytes) {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  return null;
}

function bearerToken(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : null;
}

async function readJson(response) {
  const raw = await response.text();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { message: raw }; }
}

function config() {
  const url = text(process.env.SUPABASE_URL).replace(/\/$/, "");
  const anon = text(process.env.SUPABASE_ANON_KEY);
  const secret = text(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!url || !anon || !secret) throw httpError(503, "Workforce server configuration is incomplete.", "WORKFORCE_SERVER_CONFIG_MISSING");
  return { url, anon, secret };
}

async function serviceRequest(path, options = {}, cfg = config()) {
  const response = await fetch(`${cfg.url}${path}`, {
    ...options,
    headers: {
      apikey: cfg.secret,
      Authorization: `Bearer ${cfg.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await readJson(response);
  if (!response.ok) throw httpError(response.status >= 500 ? 502 : response.status, data?.message || "Workforce upstream request failed.", data?.code || "WORKFORCE_UPSTREAM_FAILED");
  return data;
}

async function validateAuthUser(token, cfg) {
  if (!token) throw httpError(401, "A valid ServiceOS session is required.", "WORKFORCE_AUTH_REQUIRED");
  const response = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anon, Authorization: `Bearer ${token}` } });
  const data = await readJson(response);
  if (!response.ok || !data?.id) throw httpError(401, "A valid ServiceOS session is required.", "WORKFORCE_AUTH_INVALID");
  return data;
}

async function serviceRows(path, cfg) {
  const rows = await serviceRequest(`/rest/v1/${path}`, { method: "GET" }, cfg);
  if (!Array.isArray(rows)) throw httpError(502, "Workforce canonical lookup failed.", "WORKFORCE_LOOKUP_FAILED");
  return rows;
}

async function requireOwnerAdmin(req, cfg) {
  const authUser = await validateAuthUser(bearerToken(req), cfg);
  const users = await serviceRows(`app_user?select=id,auth_user_id,status&auth_user_id=eq.${encodeURIComponent(authUser.id)}&status=eq.active&limit=2`, cfg);
  if (users.length !== 1) throw httpError(403, "Canonical active app user not found.", "WORKFORCE_APP_USER_INVALID");
  const roles = await serviceRows("app_role?select=id,code&code=eq.owner_admin&limit=1", cfg);
  if (!roles[0]?.id) throw httpError(403, "Owner/Admin role is unavailable.", "WORKFORCE_OWNER_ROLE_MISSING");
  const memberships = await serviceRows(`user_membership?select=id,organization_id,business_unit_id,role_id,status&app_user_id=eq.${encodeURIComponent(users[0].id)}&status=eq.active`, cfg);
  const ownerMemberships = memberships.filter((row) => row.role_id === roles[0].id);
  if (ownerMemberships.length !== 1) throw httpError(403, "Workforce Administration requires Owner/Admin.", "WORKFORCE_OWNER_REQUIRED");
  return { actorAppUserId: users[0].id, organizationId: ownerMemberships[0].organization_id, scopedBusinessUnitId: ownerMemberships[0].business_unit_id || null };
}

async function requireBusinessUnit(actor, requestedBusinessUnitId, cfg) {
  const id = text(requestedBusinessUnitId || actor.scopedBusinessUnitId);
  if (!id) throw httpError(400, "Select HUC-ON or HUC-AZ.", "WORKFORCE_BUSINESS_UNIT_REQUIRED");
  const rows = await serviceRows(`business_unit?select=id,organization_id,code,name,status&id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(actor.organizationId)}&status=eq.active&limit=1`, cfg);
  const unit = rows[0];
  if (!unit || !["HUC-ON", "HUC-AZ"].includes(unit.code)) throw httpError(403, "Workforce business unit is outside the canonical HUC scope.", "WORKFORCE_BUSINESS_UNIT_INVALID");
  return unit;
}

async function rpc(name, payload, cfg) {
  return serviceRequest(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(payload || {}) }, cfg);
}

export async function runWorkforceApply(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  try {
    const cfg = config();
    const body = req.body || {};
    if (!requestOriginAllowed(req)) throw httpError(403, "Request origin is not allowed.", "WORKFORCE_ORIGIN_DENIED");
    if (Buffer.byteLength(JSON.stringify(body)) > 20_000) throw httpError(413, "Application payload is too large.", "WORKFORCE_PAYLOAD_TOO_LARGE");
    if (body.website) return res.status(202).json({ success: true });
    const action = bounded(body.action || "apply", 40, "Action").toLowerCase();

    if (action === "apply") {
      const programCode = bounded(body.programCode || body.program_code, 40, "Program code").toUpperCase();
      if (!ALLOWED_PROGRAMS.has(programCode)) throw httpError(400, "Select Ontario or Arizona.", "WORKFORCE_PROGRAM_INVALID");
      const legalName = bounded(body.legalName || body.legal_name, 200, "Legal name");
      const privacyAccepted = body.privacyAccepted === true && (body.consentToContact === true || body.consent_to_contact === true);
      const backgroundAccepted = body.backgroundConsentAccepted === true;
      if (!privacyAccepted || !backgroundAccepted) throw httpError(400, "Privacy Notice v1.0 and Background Check Consent v1.0 are required.", "WORKFORCE_CONSENT_REQUIRED");
      const result = await rpc("workforce_submit_public_application_v2", {
        p_program_code: programCode,
        p_legal_name: legalName,
        p_email: bounded(body.email, 320, "Email").toLowerCase(),
        p_phone_e164: bounded(body.phoneE164 || body.phone_e164, 16, "Phone"),
        p_residential_address: bounded(body.residentialAddress, 500, "Address"),
        p_experience_summary: bounded(body.experienceSummary, 2000, "Experience"),
        p_availability_schedule: bounded(body.availabilitySchedule, 1200, "Availability"),
        p_applied_role_code: bounded(body.appliedRoleCode || body.applied_role_code, 80, "Role"),
        p_privacy_notice_version: bounded(body.privacyNoticeVersion, 100, "Privacy notice version"),
        p_background_consent_version: bounded(body.backgroundConsentVersion, 100, "Background consent version"),
        p_privacy_accepted: privacyAccepted,
        p_background_consent_accepted: backgroundAccepted,
        p_idempotency_key: bounded(body.idempotencyKey || body.idempotency_key, 180, "Idempotency key"),
        p_source_fingerprint_hash: sourceFingerprint(req, cfg.secret),
      }, cfg);
      const value = normalizedUploadResult(result) || {};
      return res.status(201).json({ success: true, application: {
        applicantReference: value.applicant_reference,
        applicantAccessToken: value.applicant_access_token,
        stage: value.stage,
        idempotentReplay: value.idempotent_replay === true,
      } });
    }

    if (action === "sign_upload") {
      const documentCode = bounded(body.documentCode, 80, "Document code").toUpperCase();
      const mimeType = bounded(body.mimeType, 100, "MIME type").toLowerCase();
      const byteSize = Number(body.byteSize);
      if (!ALLOWED_DOCUMENTS.has(documentCode) || !ALLOWED_MIME_TYPES.has(mimeType) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) {
        throw httpError(400, "Document type, format, or size is not allowed.", "WORKFORCE_UPLOAD_INVALID");
      }
      const intentRaw = await rpc("workforce_create_applicant_upload_intent", {
        p_applicant_reference: bounded(body.applicantReference, 40, "Applicant reference"),
        p_access_token: bounded(body.applicantAccessToken, 128, "Applicant token"),
        p_document_code: documentCode,
        p_idempotency_key: bounded(body.idempotencyKey, 180, "Idempotency key"),
      }, cfg);
      const intent = normalizedUploadResult(intentRaw) || {};
      if (intent.bucket_id !== APPLICANT_BUCKET) throw httpError(502, "Applicant upload bucket is invalid.", "WORKFORCE_UPLOAD_BUCKET_INVALID");
      const path = safeStoragePath(intent.object_path);
      const signed = await serviceRequest(`/storage/v1/object/upload/sign/${encodeURIComponent(APPLICANT_BUCKET)}/${path}`, {
        method: "POST", body: JSON.stringify({ upsert: false }),
      }, cfg);
      const signedPath = signed?.url || signed?.signedURL || signed?.signedUrl;
      if (!signedPath) throw httpError(502, "A protected upload URL could not be issued.", "WORKFORCE_UPLOAD_SIGN_FAILED");
      const uploadUrl = /^https?:\/\//i.test(signedPath) ? signedPath : `${cfg.url}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
      return res.status(200).json({ success: true, upload: { uploadIntentId: intent.upload_intent_id, uploadUrl, expiresAt: intent.expires_at } });
    }

    if (action === "finalize_upload") {
      const intentId = bounded(body.uploadIntentId, 36, "Upload intent ID");
      const lookup = normalizedUploadResult(await rpc("get_applicant_upload_completion_locator", {
        p_upload_intent_id: intentId,
        p_applicant_reference: bounded(body.applicantReference, 40, "Applicant reference"),
        p_access_token: bounded(body.applicantAccessToken, 128, "Applicant token"),
      }, cfg)) || {};
      if (lookup.bucket_id !== APPLICANT_BUCKET) throw httpError(502, "Applicant upload locator is invalid.", "WORKFORCE_UPLOAD_LOCATOR_INVALID");
      const objectResponse = await fetch(`${cfg.url}/storage/v1/object/${encodeURIComponent(APPLICANT_BUCKET)}/${safeStoragePath(lookup.object_path)}`, {
        headers: { apikey: cfg.secret, Authorization: `Bearer ${cfg.secret}` },
      });
      if (!objectResponse.ok) throw httpError(400, "The uploaded document was not found.", "WORKFORCE_UPLOAD_NOT_FOUND");
      const declaredLength = Number(objectResponse.headers.get("content-length") || 0);
      if (declaredLength > MAX_UPLOAD_BYTES) throw httpError(400, "The uploaded document exceeds 10 MB.", "WORKFORCE_UPLOAD_TOO_LARGE");
      const bytes = Buffer.from(await objectResponse.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw httpError(400, "The uploaded document size is invalid.", "WORKFORCE_UPLOAD_SIZE_INVALID");
      const mimeType = detectedMime(bytes);
      if (!mimeType) throw httpError(400, "The uploaded file content is not a supported PDF, JPG, or PNG.", "WORKFORCE_UPLOAD_CONTENT_INVALID");
      const result = await rpc("workforce_quarantine_applicant_upload", {
        p_upload_intent_id: intentId,
        p_detected_mime_type: mimeType,
        p_byte_size: bytes.length,
        p_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        p_idempotency_key: bounded(body.idempotencyKey, 180, "Idempotency key"),
      }, cfg);
      return res.status(200).json({ success: true, document: normalizedUploadResult(result) });
    }
    if (action === "training_catalog") {
      const catalog = await rpc("get_applicant_training_catalog", {
        p_applicant_reference: bounded(body.applicantReference, 40, "Applicant reference"),
        p_access_token: bounded(body.applicantAccessToken, 128, "Applicant token"),
      }, cfg);
      return res.status(200).json({ success: true, training: normalizedUploadResult(catalog) });
    }
    if (action === "training_progress" || action === "training_complete") {
      const watchedSeconds = Number(body.watchedSeconds);
      if (!Number.isInteger(watchedSeconds) || watchedSeconds < 0 || watchedSeconds > 14_400) {
        throw httpError(400, "Training watch progress is invalid.", "WORKFORCE_TRAINING_PROGRESS_INVALID");
      }
      const complete = action === "training_complete";
      const milestone = await rpc("record_applicant_training_milestone", {
        p_applicant_reference: bounded(body.applicantReference, 40, "Applicant reference"),
        p_access_token: bounded(body.applicantAccessToken, 128, "Applicant token"),
        p_training_media_id: bounded(body.trainingMediaId, 36, "Training media ID"),
        p_watched_seconds: watchedSeconds,
        p_comprehension_confirmed: complete && body.comprehensionConfirmed === true,
        p_comprehension_version: complete ? bounded(body.comprehensionVersion, 40, "Comprehension version") : null,
        p_complete: complete,
        p_source_fingerprint_hash: sourceFingerprint(req, cfg.secret),
        p_idempotency_key: bounded(body.idempotencyKey, 180, "Idempotency key"),
      }, cfg);
      return res.status(200).json({ success: true, milestone: normalizedUploadResult(milestone) });
    }
    throw httpError(400, "Unsupported applicant action.", "WORKFORCE_APPLY_ACTION_INVALID");
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || "Application submission failed.", code: error.code || "WORKFORCE_APPLY_ERROR" });
  }
}

export async function runWorkforceDashboard(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ success: false, error: "Method not allowed." });
  try {
    const cfg = config();
    const actor = await requireOwnerAdmin(req, cfg);
    const input = req.method === "GET" ? (req.query || {}) : (req.body || {});
    const unit = await requireBusinessUnit(actor, input.businessUnitId || input.business_unit_id, cfg);
    const action = text(input.action || "pipeline").toLowerCase();

    if (action === "pipeline") {
      const pipeline = await rpc("get_workforce_compliance_pipeline", { p_organization_id: actor.organizationId, p_business_unit_id: unit.id, p_actor_app_user_id: actor.actorAppUserId }, cfg);
      return res.status(200).json({ success: true, businessUnit: unit, pipeline });
    }
    if (action === "inspector") {
      const engagementId = text(input.engagementId || input.engagement_id);
      if (!engagementId) throw httpError(400, "Engagement ID is required.", "WORKFORCE_ENGAGEMENT_REQUIRED");
      const inspector = await rpc("get_worker_compliance_inspector", { p_engagement_id: engagementId, p_actor_app_user_id: actor.actorAppUserId }, cfg);
      if (inspector?.business_unit_id !== unit.id) throw httpError(403, "Engagement is outside the selected business unit.", "WORKFORCE_ENGAGEMENT_SCOPE_INVALID");
      return res.status(200).json({ success: true, inspector });
    }
    if (action === "applicant_inspector") {
      const applicantSubmissionId = text(input.applicantSubmissionId || input.applicant_submission_id);
      if (!applicantSubmissionId) throw httpError(400, "Applicant submission ID is required.", "WORKFORCE_APPLICANT_REQUIRED");
      const inspector = await rpc("get_applicant_intake_inspector", { p_applicant_submission_id: applicantSubmissionId, p_actor_app_user_id: actor.actorAppUserId }, cfg);
      if (inspector?.business_unit_id !== unit.id) throw httpError(403, "Applicant is outside the selected business unit.", "WORKFORCE_APPLICANT_SCOPE_INVALID");
      const readiness = normalizedUploadResult(await rpc("get_applicant_training_readiness", { p_applicant_submission_id: applicantSubmissionId, p_actor_app_user_id: actor.actorAppUserId }, cfg));
      return res.status(200).json({ success: true, applicantInspector: { ...inspector, training_readiness: readiness } });
    }
    if (action === "applicant_evidence") {
      const documentCaptureId = text(input.documentCaptureId || input.document_capture_id);
      if (!documentCaptureId) throw httpError(400, "Applicant document ID is required.", "WORKFORCE_APPLICANT_DOCUMENT_REQUIRED");
      const locator = await rpc("get_applicant_document_access_locator", { p_document_capture_id: documentCaptureId, p_actor_app_user_id: actor.actorAppUserId }, cfg);
      if (locator?.business_unit_id !== unit.id || locator?.bucket_id !== APPLICANT_BUCKET) throw httpError(403, "Applicant document is outside the selected business unit.", "WORKFORCE_APPLICANT_DOCUMENT_SCOPE_INVALID");
      const signed = await serviceRequest(`/storage/v1/object/sign/${encodeURIComponent(APPLICANT_BUCKET)}/${safeStoragePath(locator.object_path)}`, { method: "POST", body: JSON.stringify({ expiresIn: 120 }) }, cfg);
      const signedPath = signed?.signedURL || signed?.signedUrl || null;
      if (!signedPath) throw httpError(502, "Applicant document URL could not be signed.", "WORKFORCE_APPLICANT_DOCUMENT_SIGN_FAILED");
      const signedUrl = /^https?:\/\//i.test(signedPath) ? signedPath : `${cfg.url}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
      return res.status(200).json({ success: true, signedUrl, expiresInSeconds: 120 });
    }
    if (action === "evidence") {
      const evidenceId = text(input.evidenceId || input.evidence_id);
      if (!evidenceId) throw httpError(400, "Evidence ID is required.", "WORKFORCE_EVIDENCE_REQUIRED");
      const locator = await rpc("get_worker_evidence_access_locator", { p_evidence_id: evidenceId, p_actor_app_user_id: actor.actorAppUserId }, cfg);
      const safePath = String(locator.object_path || "").split("/").map(encodeURIComponent).join("/");
      const signed = await serviceRequest(`/storage/v1/object/sign/${encodeURIComponent(locator.bucket_id)}/${safePath}`, { method: "POST", body: JSON.stringify({ expiresIn: 120 }) }, cfg);
      const signedPath = signed?.signedURL || signed?.signedUrl || null;
      if (!signedPath) throw httpError(502, "Verified evidence URL could not be signed.", "WORKFORCE_EVIDENCE_SIGN_FAILED");
      const signedUrl = /^https?:\/\//i.test(signedPath) ? signedPath : `${cfg.url}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
      return res.status(200).json({ success: true, signedUrl, expiresInSeconds: 120 });
    }
    if (action === "activate" && req.method === "POST") {
      const engagementId = text(input.engagementId || input.engagement_id);
      const idempotencyKey = text(input.idempotencyKey || input.idempotency_key);
      if (!engagementId || !idempotencyKey) throw httpError(400, "Engagement ID and idempotency key are required.", "WORKFORCE_ACTIVATION_INPUT_INVALID");
      const result = await rpc("activate_worker_from_dashboard", { p_engagement_id: engagementId, p_business_unit_id: unit.id, p_activation_idempotency_key: idempotencyKey, p_actor_app_user_id: actor.actorAppUserId }, cfg);
      return res.status(200).json({ success: true, activation: result });
    }
    throw httpError(400, "Unsupported workforce dashboard action.", "WORKFORCE_ACTION_INVALID");
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || "Workforce dashboard request failed.", code: error.code || "WORKFORCE_DASHBOARD_ERROR" });
  }
}
