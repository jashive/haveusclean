import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ACCEPTANCE_PROJECT_REF = "hqeamecwdsrjfjybrsox";
const ALLOWED_ROLES = new Set(["owner_admin", "office_ops"]);
const ALLOWED_ACTIONS = new Set([
  "create_prospect",
  "add_enrichment",
  "score_prospect",
  "add_contact_candidate",
  "record_duplicate_review",
  "resolve_field",
  "review_duplicate",
  "review_contact",
  "complete_review",
]);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function fail(status: number, message: string, code: string): never {
  throw Object.assign(new Error(message), { status, code });
}

function env() {
  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
  const anonKey = String(Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
  const serviceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec(supabaseUrl)?.[1]?.toLowerCase();
  if (ref !== ACCEPTANCE_PROJECT_REF) fail(403, "Growth G1 Edge Function is acceptance-only.", "GROWTH_ACCEPTANCE_ONLY");
  if (!anonKey || !serviceKey) fail(503, "Growth G1 credentials are incomplete.", "GROWTH_CREDENTIALS_MISSING");
  return { supabaseUrl, anonKey, serviceKey };
}

async function parse(res: Response, label: string) {
  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!res.ok) fail(res.status, `${label} failed: HTTP ${res.status}`, "GROWTH_UPSTREAM_ERROR");
  return payload;
}

async function authUser(token: string) {
  const { supabaseUrl, anonKey } = env();
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const user = await parse(res, "Auth validation") as Record<string, unknown>;
  if (!user?.id) fail(401, "Authenticated user could not be resolved.", "GROWTH_AUTH_INVALID");
  return user;
}

async function service(path: string, init: RequestInit = {}) {
  const { supabaseUrl, serviceKey } = env();
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return parse(res, path.split("?")[0]);
}

async function rpc(name: string, body: Record<string, unknown>) {
  return service(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
}

async function requireCoreGate() {
  const enabled = await rpc("growth_gate_enabled", { p_gate_code: "growth_layer_enabled" });
  if (enabled !== true) fail(403, "Growth Layer is disabled.", "GROWTH_LAYER_DISABLED");
}

async function authorize(token: string, organizationId: string, businessUnitId: string) {
  const user = await authUser(token);
  const users = await service(`app_user?select=id,auth_user_id,status&auth_user_id=eq.${encodeURIComponent(String(user.id))}&limit=2`) as Array<Record<string, string>>;
  if (!Array.isArray(users) || users.length !== 1 || users[0].status !== "active") fail(403, "Active app user required.", "GROWTH_APP_USER_FORBIDDEN");
  const appUser = users[0];

  const roles = await service("app_role?select=id,code&code=in.(owner_admin,office_ops)") as Array<Record<string, string>>;
  const roleById = new Map((Array.isArray(roles) ? roles : []).map((r) => [r.id, r.code]));
  const roleIds = [...roleById.keys()];
  if (!roleIds.length) fail(403, "Growth-authorized roles unavailable.", "GROWTH_ROLE_CONFIG_INVALID");

  const memberships = await service(`user_membership?select=id,organization_id,business_unit_id,role_id,status&app_user_id=eq.${encodeURIComponent(appUser.id)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active&role_id=in.(${roleIds.map(encodeURIComponent).join(",")})`) as Array<Record<string, string | null>>;
  const membership = (Array.isArray(memberships) ? memberships : []).find((m) =>
    (m.business_unit_id == null || m.business_unit_id === businessUnitId) && ALLOWED_ROLES.has(roleById.get(String(m.role_id)) || "")
  );
  if (!membership) fail(403, "Active owner_admin/office_ops membership required.", "GROWTH_MEMBERSHIP_FORBIDDEN");

  const bus = await service(`business_unit?select=id,organization_id,jurisdiction_id,status&id=eq.${encodeURIComponent(businessUnitId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`) as Array<Record<string, string>>;
  const bu = Array.isArray(bus) ? bus[0] : null;
  if (!bu || bu.status !== "active") fail(403, "Active in-scope business unit required.", "GROWTH_BUSINESS_UNIT_FORBIDDEN");
  return { appUser, businessUnit: bu };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    env();
    await requireCoreGate();
    const auth = req.headers.get("authorization") || "";
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!match) fail(401, "Bearer token required.", "GROWTH_AUTH_REQUIRED");
    const token = match[1];
    const url = new URL(req.url);

    if (req.method === "GET") {
      const organizationId = url.searchParams.get("organization_id") || "";
      const businessUnitId = url.searchParams.get("business_unit_id") || "";
      if (!organizationId || !businessUnitId) fail(400, "organization_id and business_unit_id are required.", "GROWTH_SCOPE_REQUIRED");
      await authorize(token, organizationId, businessUnitId);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100) || 100, 500));
      const view = (url.searchParams.get("view") || "").toLowerCase();
      if (view === "readiness") {
        const readiness = await rpc("growth_g1_scope_readiness", { p_organization_id: organizationId });
        return json(200, { success: true, readiness });
      }
      if (view === "review") {
        const review_queue = await rpc("growth_g1_list_review_queue", {
          p_organization_id: organizationId,
          p_business_unit_id: businessUnitId,
          p_limit: limit,
        });
        return json(200, { success: true, review_queue });
      }
      const prospects = await rpc("growth_g1_list_prospects", {
        p_organization_id: organizationId,
        p_business_unit_id: businessUnitId,
        p_status: url.searchParams.get("status") || null,
        p_limit: limit,
      });
      return json(200, { success: true, prospects });
    }

    if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed." });
    const body = await req.json().catch(() => ({})) as Record<string, any>;
    const action = String(body.action || "");
    if (!ALLOWED_ACTIONS.has(action)) fail(400, "Unknown Growth G1 action.", "GROWTH_ACTION_INVALID");
    const organizationId = String(body.organization_id || body.prospect?.organization_id || body.contact?.organization_id || "");
    const businessUnitId = String(body.business_unit_id || body.prospect?.business_unit_id || body.contact?.business_unit_id || "");
    if (!organizationId || !businessUnitId) fail(400, "organization_id and business_unit_id are required.", "GROWTH_SCOPE_REQUIRED");
    const authz = await authorize(token, organizationId, businessUnitId);

    if (action === "create_prospect") {
      const prospect = { ...(body.prospect || {}), organization_id: organizationId, business_unit_id: businessUnitId };
      prospect.jurisdiction_id ||= authz.businessUnit.jurisdiction_id;
      prospect.owner_app_user_id = authz.appUser.id;
      const prospectId = await rpc("growth_g1_create_prospect", { p_payload: prospect });
      return json(201, { success: true, prospect_id: prospectId });
    }

    const prospectId = String(body.prospect_id || body.contact?.prospect_id || "");
    if (!prospectId && !["review_duplicate", "review_contact"].includes(action)) {
      fail(400, "prospect_id is required.", "GROWTH_PROSPECT_REQUIRED");
    }

    if (action === "add_enrichment") {
      const evidenceId = await rpc("growth_g1_add_enrichment", { p_prospect_id: prospectId, p_organization_id: organizationId, p_evidence: body.evidence || {} });
      return json(201, { success: true, evidence_id: evidenceId });
    }

    if (action === "add_contact_candidate") {
      const contact = {
        ...(body.contact || {}),
        prospect_id: prospectId,
        organization_id: organizationId,
        business_unit_id: businessUnitId,
        jurisdiction_id: body.contact?.jurisdiction_id || authz.businessUnit.jurisdiction_id,
      };
      const contactCandidateId = await rpc("growth_g1_add_contact_candidate", { p_payload: contact });
      return json(201, { success: true, contact_candidate_id: contactCandidateId });
    }

    if (action === "record_duplicate_review") {
      const duplicateReviewId = await rpc("growth_g1_record_duplicate_review", {
        p_prospect_id: prospectId,
        p_organization_id: organizationId,
        p_payload: body.duplicate || {},
      });
      return json(201, { success: true, duplicate_review_id: duplicateReviewId });
    }

    if (action === "resolve_field") {
      const fieldResolutionId = await rpc("growth_g1_resolve_field", {
        p_prospect_id: prospectId,
        p_organization_id: organizationId,
        p_field_name: String(body.field_name || ""),
        p_evidence_id: String(body.evidence_id || ""),
        p_decision: String(body.decision || ""),
        p_reviewer_app_user_id: authz.appUser.id,
        p_notes: body.notes || null,
      });
      return json(200, { success: true, field_resolution_id: fieldResolutionId });
    }

    if (action === "review_duplicate") {
      const result = await rpc("growth_g1_review_duplicate", {
        p_duplicate_review_id: String(body.duplicate_review_id || ""),
        p_organization_id: organizationId,
        p_decision: String(body.decision || ""),
        p_reviewer_app_user_id: authz.appUser.id,
        p_notes: body.notes || null,
      });
      return json(200, { success: true, decision: result });
    }

    if (action === "review_contact") {
      const result = await rpc("growth_g1_review_contact", {
        p_contact_candidate_id: String(body.contact_candidate_id || ""),
        p_organization_id: organizationId,
        p_decision: String(body.decision || ""),
        p_reviewer_app_user_id: authz.appUser.id,
        p_notes: body.notes || null,
      });
      return json(200, { success: true, decision: result });
    }

    if (action === "complete_review") {
      const lifecycleStatus = await rpc("growth_g1_complete_review", {
        p_prospect_id: prospectId,
        p_organization_id: organizationId,
        p_reviewer_app_user_id: authz.appUser.id,
        p_notes: body.notes || null,
      });
      return json(200, { success: true, lifecycle_status: lifecycleStatus, outreach_eligible: false });
    }

    const score = { ...(body.score || {}), scored_by: body.score?.scored_by || `app_user:${authz.appUser.id}` };
    const scoreId = await rpc("growth_g1_record_score", { p_prospect_id: prospectId, p_organization_id: organizationId, p_score: score });
    return json(201, { success: true, score_id: scoreId });
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    return json(err.status || 500, { success: false, error: err.message || "Growth G1 request failed.", code: err.code || "GROWTH_G1_ERROR" });
  }
});
