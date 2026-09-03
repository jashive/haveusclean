// Workforce W6/W9 Production boundary recovered from the accepted W1-W10 contract.
// All HEMS reads/writes stay server-side. Browser callers never receive HEMS table access.

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function text(value) {
  return String(value ?? "").trim();
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed." });
  try {
    const cfg = config();
    const body = req.body || {};
    const result = await rpc("workforce_submit_application", {
      p_program_code: text(body.programCode || body.program_code).toUpperCase(),
      p_legal_name: text(body.legalName || body.legal_name),
      p_preferred_name: text(body.preferredName || body.preferred_name) || null,
      p_email: text(body.email).toLowerCase(),
      p_phone_e164: text(body.phoneE164 || body.phone_e164),
      p_applied_role_code: text(body.appliedRoleCode || body.applied_role_code),
      p_applicant_statement: text(body.applicantStatement || body.applicant_statement) || null,
      p_privacy_notice_version: text(body.privacyNoticeVersion || body.privacy_notice_version),
      p_consent_to_contact: body.consentToContact === true || body.consent_to_contact === true,
      p_idempotency_key: text(body.idempotencyKey || body.idempotency_key),
      p_source_fingerprint_hash: text(body.sourceFingerprintHash || body.source_fingerprint_hash) || null,
    }, cfg);
    return res.status(201).json({ success: true, application: result });
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
