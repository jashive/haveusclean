// ServiceOS 1.0 staff administration — server-only implementation.
// Privileged Supabase credentials must never be exposed to browser code.

const CANONICAL_ROLES = new Set(["owner_admin", "office_ops", "worker", "qa", "finance"]);

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function bearerToken(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : null;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function envConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const anon = String(process.env.SUPABASE_ANON_KEY || "").trim();
  const secret = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  if (!url || !anon || !secret) {
    throw httpError(503, "ServiceOS staff admin server credentials are incomplete.", "STAFF_ADMIN_SERVER_CONFIG_MISSING");
  }
  return { url, anon, secret };
}

async function validateAuthUser(accessToken, config) {
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.anon, Authorization: `Bearer ${accessToken}` },
  });
  const data = await readJson(response);
  if (!response.ok || !data?.id) {
    throw httpError(401, "ServiceOS staff administration requires a valid session.", "STAFF_ADMIN_AUTH_INVALID");
  }
  return data;
}

async function userRest(path, accessToken, config) {
  return fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.anon,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
}

async function serviceRest(path, options, config) {
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.secret,
      Authorization: `Bearer ${config.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
}

async function requireOwnerAdmin(accessToken, authUserId, config) {
  const appUserResponse = await userRest(
    `app_user?select=id,auth_user_id,email,status&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=2`,
    accessToken,
    config
  );
  const appUsers = await readJson(appUserResponse);
  if (!appUserResponse.ok || !Array.isArray(appUsers) || appUsers.length !== 1 || appUsers[0].status !== "active") {
    throw httpError(403, "Active canonical app user not found.", "STAFF_ADMIN_APP_USER_INVALID");
  }

  const roleResponse = await userRest("app_role?select=id,code&code=eq.owner_admin&limit=1", accessToken, config);
  const roles = await readJson(roleResponse);
  const ownerRole = Array.isArray(roles) ? roles[0] : null;
  if (!roleResponse.ok || !ownerRole?.id) {
    throw httpError(403, "Owner/Admin role is unavailable.", "STAFF_ADMIN_OWNER_ROLE_UNAVAILABLE");
  }

  const membershipsResponse = await userRest(
    `user_membership?select=id,organization_id,business_unit_id,role_id,status&app_user_id=eq.${encodeURIComponent(appUsers[0].id)}&status=eq.active`,
    accessToken,
    config
  );
  const memberships = await readJson(membershipsResponse);
  if (!membershipsResponse.ok || !Array.isArray(memberships)) {
    throw httpError(403, "Owner/Admin membership could not be validated.", "STAFF_ADMIN_MEMBERSHIP_INVALID");
  }
  const active = memberships.filter((row) => row?.status === "active");
  const roleIds = new Set(active.map((row) => row.role_id));
  if (active.length !== 1 || roleIds.size !== 1 || active[0].role_id !== ownerRole.id) {
    throw httpError(403, "Staff administration requires exactly one active Owner/Admin membership.", "STAFF_ADMIN_OWNER_REQUIRED");
  }

  return {
    actorAppUserId: appUsers[0].id,
    organizationId: active[0].organization_id,
    businessUnitId: active[0].business_unit_id ?? null,
  };
}

async function serviceRows(path, config) {
  const response = await serviceRest(path, { method: "GET" }, config);
  const rows = await readJson(response);
  if (!response.ok || !Array.isArray(rows)) {
    throw httpError(502, `Canonical staff lookup failed for ${path.split("?")[0]}.`, "STAFF_ADMIN_DATA_LOOKUP_FAILED");
  }
  return rows;
}

async function listAuthUsers(config) {
  const response = await fetch(`${config.url}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: { apikey: config.secret, Authorization: `Bearer ${config.secret}` },
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw httpError(502, "Supabase Auth user listing failed.", "STAFF_ADMIN_AUTH_LIST_FAILED");
  }
  return Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : [];
}

async function loadDirectory(organizationId, config) {
  const [appUsers, memberships, roles, businessUnits, authUsers] = await Promise.all([
    serviceRows("app_user?select=id,auth_user_id,email,display_name,status,created_at,updated_at&order=display_name.asc", config),
    serviceRows(`user_membership?select=id,app_user_id,organization_id,business_unit_id,role_id,status,created_at&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.asc`, config),
    serviceRows("app_role?select=id,code,name&order=code.asc", config),
    serviceRows(`business_unit?select=id,code,name,status&organization_id=eq.${encodeURIComponent(organizationId)}&order=code.asc`, config),
    listAuthUsers(config),
  ]);

  const roleById = new Map(roles.map((row) => [row.id, row]));
  const buById = new Map(businessUnits.map((row) => [row.id, row]));
  const authById = new Map(authUsers.map((row) => [row.id, row]));
  const membershipsByUser = new Map();
  for (const membership of memberships) {
    const items = membershipsByUser.get(membership.app_user_id) || [];
    items.push(membership);
    membershipsByUser.set(membership.app_user_id, items);
  }

  const staff = appUsers
    .filter((user) => (membershipsByUser.get(user.id) || []).some((m) => m.organization_id === organizationId))
    .map((user) => {
      const userMemberships = (membershipsByUser.get(user.id) || []).filter((m) => m.organization_id === organizationId);
      const activeMemberships = userMemberships.filter((m) => m.status === "active");
      const authUser = authById.get(user.auth_user_id) || null;
      return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        status: user.status,
        authStatus: authUser?.email_confirmed_at ? "active" : authUser ? "invited" : "unbound",
        lastSignInAt: authUser?.last_sign_in_at || null,
        memberships: activeMemberships.map((m) => ({
          id: m.id,
          roleCode: roleById.get(m.role_id)?.code || "unknown",
          roleName: roleById.get(m.role_id)?.name || "Unknown",
          businessUnitId: m.business_unit_id,
          businessUnitCode: m.business_unit_id ? buById.get(m.business_unit_id)?.code || null : null,
          businessUnitName: m.business_unit_id ? buById.get(m.business_unit_id)?.name || null : "Organization-wide",
        })),
      };
    });

  return {
    staff,
    roles: roles.filter((row) => CANONICAL_ROLES.has(row.code)).map((row) => ({ id: row.id, code: row.code, name: row.name })),
    businessUnits: businessUnits.filter((row) => row.status === "active"),
  };
}

async function insertAuditEvent({ organizationId, businessUnitId, actorAppUserId, eventType, entityType, entityId, afterState, metadata }, config) {
  const response = await serviceRest("audit_event", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      organization_id: organizationId,
      business_unit_id: businessUnitId,
      actor_user_id: actorAppUserId,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      source_system: "serviceos_staff_admin",
      after_state: afterState || null,
      metadata: metadata || {},
    }),
  }, config);
  if (!response.ok) {
    throw httpError(502, "Staff action completed but audit persistence failed.", "STAFF_ADMIN_AUDIT_FAILED");
  }
}

async function inviteStaff(body, actor, config) {
  const email = normalizeEmail(body?.email);
  const displayName = normalizeText(body?.displayName);
  const roleCode = normalizeText(body?.roleCode);
  const businessUnitCode = normalizeText(body?.businessUnitCode);
  if (!email || !email.includes("@") || !displayName || !CANONICAL_ROLES.has(roleCode)) {
    throw httpError(400, "Name, valid email, and canonical role are required.", "STAFF_ADMIN_INPUT_INVALID");
  }

  const roles = await serviceRows(`app_role?select=id,code,name&code=eq.${encodeURIComponent(roleCode)}&limit=1`, config);
  const role = roles[0];
  if (!role?.id) throw httpError(400, "Selected role is unavailable.", "STAFF_ADMIN_ROLE_INVALID");

  let businessUnitId = null;
  if (roleCode !== "owner_admin") {
    if (!businessUnitCode) throw httpError(400, "A business unit is required for this role.", "STAFF_ADMIN_BUSINESS_UNIT_REQUIRED");
    const units = await serviceRows(
      `business_unit?select=id,code,name,status&organization_id=eq.${encodeURIComponent(actor.organizationId)}&code=eq.${encodeURIComponent(businessUnitCode)}&status=eq.active&limit=1`,
      config
    );
    if (!units[0]?.id) throw httpError(400, "Selected business unit is unavailable.", "STAFF_ADMIN_BUSINESS_UNIT_INVALID");
    businessUnitId = units[0].id;
  }

  const existingUsers = await serviceRows(`app_user?select=id,auth_user_id,email,status&email=ilike.${encodeURIComponent(email)}&limit=2`, config);
  if (existingUsers.some((row) => normalizeEmail(row.email) === email)) {
    throw httpError(409, "A canonical ServiceOS app user already exists for this email.", "STAFF_ADMIN_DUPLICATE_USER");
  }

  const redirectTo = normalizeText(process.env.SERVICEOS_STAFF_INVITE_REDIRECT_URL) || "https://haveusclean.vercel.app/";
  const inviteResponse = await fetch(`${config.url}/auth/v1/invite`, {
    method: "POST",
    headers: {
      apikey: config.secret,
      Authorization: `Bearer ${config.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, data: { display_name: displayName }, redirect_to: redirectTo }),
  });
  const invitedAuthUser = await readJson(inviteResponse);
  if (!inviteResponse.ok || !invitedAuthUser?.id) {
    const message = invitedAuthUser?.msg || invitedAuthUser?.message || invitedAuthUser?.error_description || "Supabase invitation failed.";
    throw httpError(inviteResponse.status || 502, message, "STAFF_ADMIN_INVITE_FAILED");
  }

  const appUserResponse = await serviceRest("app_user?select=id,auth_user_id,email,display_name,status", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      auth_user_id: invitedAuthUser.id,
      email,
      display_name: displayName,
      status: "active",
    }),
  }, config);
  const appUserRows = await readJson(appUserResponse);
  const appUser = Array.isArray(appUserRows) ? appUserRows[0] : null;
  if (!appUserResponse.ok || !appUser?.id) {
    throw httpError(502, "Auth invitation was created but canonical app_user provisioning failed. Reconcile before retrying.", "STAFF_ADMIN_PARTIAL_APP_USER_FAILURE");
  }

  const membershipResponse = await serviceRest("user_membership?select=id,app_user_id,organization_id,business_unit_id,role_id,status", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      app_user_id: appUser.id,
      organization_id: actor.organizationId,
      business_unit_id: businessUnitId,
      role_id: role.id,
      status: "active",
    }),
  }, config);
  const membershipRows = await readJson(membershipResponse);
  const membership = Array.isArray(membershipRows) ? membershipRows[0] : null;
  if (!membershipResponse.ok || !membership?.id) {
    await serviceRest(`app_user?id=eq.${encodeURIComponent(appUser.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "provisioning_failed", updated_at: new Date().toISOString() }),
    }, config).catch(() => null);
    throw httpError(502, "Auth invitation exists but role membership provisioning failed. The app user was quarantined for reconciliation.", "STAFF_ADMIN_PARTIAL_MEMBERSHIP_FAILURE");
  }

  await insertAuditEvent({
    organizationId: actor.organizationId,
    businessUnitId,
    actorAppUserId: actor.actorAppUserId,
    eventType: "staff.invited",
    entityType: "app_user",
    entityId: appUser.id,
    afterState: { email, display_name: displayName, role_code: roleCode, business_unit_id: businessUnitId, auth_status: "invited" },
    metadata: { membership_id: membership.id, invite_redirect: redirectTo },
  }, config);

  return { success: true, appUserId: appUser.id, membershipId: membership.id, authUserId: invitedAuthUser.id, email, displayName, roleCode, businessUnitId };
}

async function deactivateStaff(body, actor, config) {
  const appUserId = normalizeText(body?.appUserId);
  if (!appUserId) throw httpError(400, "appUserId is required.", "STAFF_ADMIN_INPUT_INVALID");
  if (appUserId === actor.actorAppUserId) throw httpError(409, "Owner/Admin cannot deactivate their own active account from this screen.", "STAFF_ADMIN_SELF_DEACTIVATION_BLOCKED");

  const rows = await serviceRows(`app_user?select=id,auth_user_id,email,display_name,status&id=eq.${encodeURIComponent(appUserId)}&limit=1`, config);
  const target = rows[0];
  if (!target?.id) throw httpError(404, "Staff app user not found.", "STAFF_ADMIN_USER_NOT_FOUND");

  const memberships = await serviceRows(`user_membership?select=id,organization_id,status&app_user_id=eq.${encodeURIComponent(appUserId)}&organization_id=eq.${encodeURIComponent(actor.organizationId)}`, config);
  if (!memberships.length) throw httpError(404, "Staff membership not found in this organization.", "STAFF_ADMIN_MEMBERSHIP_NOT_FOUND");

  const membershipResponse = await serviceRest(
    `user_membership?app_user_id=eq.${encodeURIComponent(appUserId)}&organization_id=eq.${encodeURIComponent(actor.organizationId)}&status=eq.active`,
    { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "inactive" }) },
    config
  );
  if (!membershipResponse.ok) throw httpError(502, "Membership deactivation failed.", "STAFF_ADMIN_DEACTIVATE_MEMBERSHIP_FAILED");

  const userResponse = await serviceRest(`app_user?id=eq.${encodeURIComponent(appUserId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "inactive", updated_at: new Date().toISOString() }),
  }, config);
  if (!userResponse.ok) throw httpError(502, "App user deactivation failed.", "STAFF_ADMIN_DEACTIVATE_USER_FAILED");

  await insertAuditEvent({
    organizationId: actor.organizationId,
    businessUnitId: null,
    actorAppUserId: actor.actorAppUserId,
    eventType: "staff.deactivated",
    entityType: "app_user",
    entityId: appUserId,
    afterState: { status: "inactive", email: target.email },
  }, config);

  return { success: true, appUserId, status: "inactive" };
}

export default async function runStaffAdmin(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ success: false, error: "Method not allowed." });
    }
    const config = envConfig();
    const token = bearerToken(req);
    if (!token) throw httpError(401, "Bearer token required.", "STAFF_ADMIN_TOKEN_REQUIRED");
    const authUser = await validateAuthUser(token, config);
    const actor = await requireOwnerAdmin(token, authUser.id, config);

    if (req.method === "GET") {
      const directory = await loadDirectory(actor.organizationId, config);
      return res.status(200).json({ success: true, organizationId: actor.organizationId, ...directory });
    }

    const action = normalizeText(req.body?.action);
    if (action === "invite") return res.status(201).json(await inviteStaff(req.body, actor, config));
    if (action === "deactivate") return res.status(200).json(await deactivateStaff(req.body, actor, config));
    throw httpError(400, "Unsupported staff admin action.", "STAFF_ADMIN_ACTION_INVALID");
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || "ServiceOS staff administration failed.",
      code: error.code || "STAFF_ADMIN_ERROR",
    });
  }
}
