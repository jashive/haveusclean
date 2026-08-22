// Growth Layer 1.0 / Milestone G1 server implementation.
// Private prospecting boundary only. Does not create ServiceOS Revenue entities.

const ALLOWED_ROLES = new Set(["owner_admin", "office_ops"]);
const ALLOWED_ACTIONS = new Set(["create_prospect", "add_enrichment", "score_prospect"]);

function error(status, message, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function requiredEnv() {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw error(503, "Growth G1 server credentials are incomplete.", "GROWTH_SERVER_CREDENTIALS_MISSING");
  }
  return { supabaseUrl, anonKey, serviceKey };
}

function extractBearer(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  if (!match) throw error(401, "Bearer token required.", "GROWTH_AUTH_REQUIRED");
  return match[1].trim();
}

async function readJson(res, label) {
  const text = await res.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) throw error(res.status >= 400 && res.status < 600 ? res.status : 500, `${label} failed: HTTP ${res.status}`, "GROWTH_UPSTREAM_ERROR");
  return parsed;
}

async function validateAuthUser(accessToken) {
  const { supabaseUrl, anonKey } = requiredEnv();
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const user = await readJson(res, "Growth auth validation");
  if (!user?.id) throw error(401, "Authenticated user could not be resolved.", "GROWTH_AUTH_INVALID");
  return user;
}

async function serviceRest(path, { method = "GET", body = null } = {}) {
  const { supabaseUrl, serviceKey } = requiredEnv();
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (method !== "GET") headers.Prefer = "return=representation";
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  return readJson(res, `Growth REST ${path.split("?")[0]}`);
}

async function rpc(name, body) {
  return serviceRest(`rpc/${name}`, { method: "POST", body });
}

async function loadAuthorization(accessToken, organizationId, businessUnitId) {
  const authUser = await validateAuthUser(accessToken);
  const users = await serviceRest(`app_user?select=id,auth_user_id,status&auth_user_id=eq.${encodeURIComponent(authUser.id)}&limit=2`);
  if (!Array.isArray(users) || users.length !== 1 || users[0].status !== "active") {
    throw error(403, "Active ServiceOS app user required.", "GROWTH_APP_USER_FORBIDDEN");
  }
  const appUser = users[0];

  const roles = await serviceRest("app_role?select=id,code&code=in.(owner_admin,office_ops)");
  const roleById = new Map((Array.isArray(roles) ? roles : []).map((r) => [r.id, r.code]));
  const roleIds = [...roleById.keys()];
  if (!roleIds.length) throw error(403, "Growth-authorized roles are unavailable.", "GROWTH_ROLE_CONFIG_INVALID");

  const memberships = await serviceRest(
    `user_membership?select=id,organization_id,business_unit_id,role_id,status&app_user_id=eq.${encodeURIComponent(appUser.id)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active&role_id=in.(${roleIds.map(encodeURIComponent).join(",")})`
  );
  const match = (Array.isArray(memberships) ? memberships : []).find((m) =>
    (m.business_unit_id == null || m.business_unit_id === businessUnitId) && ALLOWED_ROLES.has(roleById.get(m.role_id))
  );
  if (!match) throw error(403, "Active owner_admin/office_ops membership for this Growth business unit is required.", "GROWTH_MEMBERSHIP_FORBIDDEN");

  const bus = await serviceRest(`business_unit?select=id,organization_id,jurisdiction_id,status&id=eq.${encodeURIComponent(businessUnitId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  const bu = Array.isArray(bus) ? bus[0] : null;
  if (!bu || bu.status !== "active") throw error(403, "Growth target business unit is not active or not in scope.", "GROWTH_BUSINESS_UNIT_FORBIDDEN");

  return { authUser, appUser, membership: match, businessUnit: bu, roleCode: roleById.get(match.role_id) };
}

function parseLimit(value) {
  const n = Number.parseInt(String(value ?? "100"), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(n, 500));
}

function requireIds(organizationId, businessUnitId) {
  if (!organizationId || !businessUnitId) {
    throw error(400, "organization_id and business_unit_id are required.", "GROWTH_SCOPE_REQUIRED");
  }
}

export default async function runGrowthG1(req, res) {
  try {
    if (process.env.GROWTH_LAYER_ENABLED !== "true") {
      throw error(403, "Growth Layer is disabled.", "GROWTH_LAYER_DISABLED");
    }

    const accessToken = extractBearer(req);

    if (req.method === "GET") {
      const organizationId = String(req.query?.organization_id || "").trim();
      const businessUnitId = String(req.query?.business_unit_id || "").trim();
      const status = String(req.query?.status || "").trim() || null;
      requireIds(organizationId, businessUnitId);
      await loadAuthorization(accessToken, organizationId, businessUnitId);
      const rows = await rpc("growth_g1_list_prospects", {
        p_organization_id: organizationId,
        p_business_unit_id: businessUnitId,
        p_status: status,
        p_limit: parseLimit(req.query?.limit),
      });
      return res.status(200).json({ success: true, prospects: rows ?? [] });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ success: false, error: "Method not allowed." });
    }

    const action = String(req.body?.action || "").trim();
    if (!ALLOWED_ACTIONS.has(action)) throw error(400, "Unknown Growth G1 action.", "GROWTH_ACTION_INVALID");

    const organizationId = String(req.body?.organization_id || req.body?.prospect?.organization_id || "").trim();
    const businessUnitId = String(req.body?.business_unit_id || req.body?.prospect?.business_unit_id || "").trim();
    requireIds(organizationId, businessUnitId);
    const auth = await loadAuthorization(accessToken, organizationId, businessUnitId);

    if (action === "create_prospect") {
      const prospect = { ...(req.body?.prospect || {}) };
      prospect.organization_id = organizationId;
      prospect.business_unit_id = businessUnitId;
      prospect.jurisdiction_id = prospect.jurisdiction_id || auth.businessUnit.jurisdiction_id;
      prospect.owner_app_user_id = auth.appUser.id;
      const id = await rpc("growth_g1_create_prospect", { p_payload: prospect });
      return res.status(201).json({ success: true, prospect_id: id });
    }

    const prospectId = String(req.body?.prospect_id || "").trim();
    if (!prospectId) throw error(400, "prospect_id is required.", "GROWTH_PROSPECT_REQUIRED");

    if (action === "add_enrichment") {
      const id = await rpc("growth_g1_add_enrichment", {
        p_prospect_id: prospectId,
        p_organization_id: organizationId,
        p_evidence: req.body?.evidence || {},
      });
      return res.status(201).json({ success: true, evidence_id: id });
    }

    const score = { ...(req.body?.score || {}), scored_by: req.body?.score?.scored_by || `app_user:${auth.appUser.id}` };
    const id = await rpc("growth_g1_record_score", {
      p_prospect_id: prospectId,
      p_organization_id: organizationId,
      p_score: score,
    });
    return res.status(201).json({ success: true, score_id: id });
  } catch (e) {
    return res.status(e.status || 500).json({
      success: false,
      error: e.message || "Growth G1 request failed.",
      code: e.code || "GROWTH_G1_ERROR",
    });
  }
}
