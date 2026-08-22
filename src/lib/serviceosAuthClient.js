import { getSupabaseConfig } from "./supabaseConfig.js";

const SESSION_KEY = "huc:serviceos-auth:v1";

function getConfig() {
  return getSupabaseConfig(
    typeof import.meta !== "undefined" ? import.meta.env : {}
  );
}

export function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function storeSession({ access_token, refresh_token, expires_at, expires_in, user }) {
  const payload = {
    access_token,
    refresh_token,
    expires_at: expires_at ?? Math.floor(Date.now() / 1000) + (expires_in ?? 3600),
    user: {
      id: user?.id,
      email: user?.email,
      user_metadata: user?.user_metadata ?? {},
      app_metadata: user?.app_metadata ?? {},
    },
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  return payload;
}

async function parseAuthResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function authErrorMessage(data, fallback) {
  return data?.message ?? data?.error_description ?? data?.msg ?? fallback;
}

export async function signInWithPassword(email, password) {
  const { url, anon } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseAuthResponse(response);
  if (!response.ok) throw new Error(authErrorMessage(data, "Sign-in failed"));
  return storeSession(data);
}

export async function refreshSession(refreshToken) {
  const { url, anon } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await parseAuthResponse(response);
  if (!response.ok) {
    clearSession();
    throw new Error(authErrorMessage(data, "Session refresh failed"));
  }
  return storeSession(data);
}

export async function signOut(accessToken) {
  const { url, anon } = getConfig();
  try {
    await fetch(`${url}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
  } finally {
    clearSession();
  }
}

export async function authenticatedRestFetch(path, accessToken, options = {}) {
  const { url, anon } = getConfig();
  const { headers: extraHeaders, ...rest } = options;
  return fetch(`${url}/rest/v1/${path}`, {
    ...rest,
    headers: { apikey: anon, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

const TOKEN_EXPIRY_BUFFER_SECONDS = 60;

function isTokenExpiredOrNearlyExpired(session) {
  if (!session?.expires_at) return false;
  return session.expires_at - Math.floor(Date.now() / 1000) <= TOKEN_EXPIRY_BUFFER_SECONDS;
}

function isSupabaseExpiredError(status, body) {
  if (status === 401) return true;
  if (typeof body === "string" && body.includes("PGRST303")) return true;
  return !!(body && typeof body === "object" && body.code === "PGRST303");
}

export async function getValidAccessToken() {
  const session = getStoredSession();
  if (!session?.access_token) throw new Error("ServiceOS: no active session");
  if (!isTokenExpiredOrNearlyExpired(session)) return session.access_token;
  if (!session.refresh_token) {
    clearSession();
    throw new Error("ServiceOS: session expired and no refresh token — please sign in again");
  }
  const refreshed = await refreshSession(session.refresh_token);
  return refreshed.access_token;
}

export async function authenticatedRestFetchWithRefresh(path, options = {}) {
  let accessToken;
  try {
    accessToken = await getValidAccessToken();
  } catch (err) {
    clearSession();
    throw err;
  }
  const response = await authenticatedRestFetch(path, accessToken, options);
  if (!response.ok) {
    let bodyText = "";
    let bodyObj = null;
    try {
      bodyText = await response.clone().text();
      bodyObj = JSON.parse(bodyText);
    } catch {}
    if (isSupabaseExpiredError(response.status, bodyObj ?? bodyText)) {
      const session = getStoredSession();
      if (!session?.refresh_token) {
        clearSession();
        throw new Error("ServiceOS: session expired — please sign in again");
      }
      let refreshed;
      try {
        refreshed = await refreshSession(session.refresh_token);
      } catch {
        throw new Error("ServiceOS: session expired and refresh failed — please sign in again");
      }
      return authenticatedRestFetch(path, refreshed.access_token, options);
    }
  }
  return response;
}

export async function validateServiceOSContext(session) {
  const { access_token, user } = session;
  const authUserId = user?.id;
  if (!access_token || !authUserId) throw new Error("ServiceOS access denied: missing credentials");

  const orgRes = await authenticatedRestFetch("organization?select=id,code,name&order=id.asc&limit=2", access_token);
  if (!orgRes || !orgRes.ok) throw new Error("ServiceOS access denied: organization validation failed");
  const orgs = await orgRes.json();
  if (!Array.isArray(orgs) || orgs.length !== 1) throw new Error(`ServiceOS access denied: expected exactly one visible organization, found ${Array.isArray(orgs) ? orgs.length : "error"}`);
  const orgId = orgs[0].id;

  const buRes = await authenticatedRestFetch(`business_unit?select=id,organization_id,code,name,jurisdiction_id&organization_id=eq.${encodeURIComponent(orgId)}&order=code.asc`, access_token);
  if (!buRes || !buRes.ok) throw new Error("ServiceOS access denied: business unit validation failed");
  const bus = await buRes.json();
  if (!Array.isArray(bus)) throw new Error("ServiceOS access denied: business unit validation failed");
  const buCodes = bus.map((b) => b.code);
  if (!buCodes.length || bus.some((businessUnit) => businessUnit.organization_id !== orgId)) throw new Error("ServiceOS access denied: visible business-unit scope is invalid");

  const businessUnitByCode = {};
  for (const bu of bus) {
    businessUnitByCode[bu.code] = { id: bu.id, code: bu.code, name: bu.name, jurisdictionId: bu.jurisdiction_id ?? null };
  }
  const primaryBusinessUnit = businessUnitByCode["HUC-ON"] ?? bus[0];
  const primaryBusinessUnitId = primaryBusinessUnit?.id ?? null;
  const primaryJurisdictionId = primaryBusinessUnit?.jurisdictionId ?? primaryBusinessUnit?.jurisdiction_id ?? null;

  const userRes = await authenticatedRestFetch(`app_user?select=id,auth_user_id,email,status&auth_user_id=eq.${encodeURIComponent(authUserId)}`, access_token);
  if (!userRes || !userRes.ok) throw new Error("ServiceOS access denied: app_user validation failed");
  const appUsers = await userRes.json();
  if (!Array.isArray(appUsers) || appUsers.length !== 1) throw new Error(`ServiceOS access denied: expected exactly one visible app_user, found ${Array.isArray(appUsers) ? appUsers.length : "error"}`);
  const appUser = appUsers[0];
  if (appUser.auth_user_id !== authUserId) throw new Error("ServiceOS access denied: app_user auth_user_id mismatch");
  if (appUser.status !== "active") throw new Error("ServiceOS access denied: app_user is not active");
  const appUserId = appUser.id;

  const roleRes = await authenticatedRestFetch("app_role?select=id,code,name&code=in.(owner_admin,office_ops,worker,qa,finance)", access_token);
  if (!roleRes || !roleRes.ok) throw new Error("ServiceOS access denied: role validation failed");
  const roles = await roleRes.json();
  if (!Array.isArray(roles) || roles.length !== 5) throw new Error("ServiceOS access denied: canonical roles are incomplete");

  const memberRes = await authenticatedRestFetch(`user_membership?select=id,app_user_id,organization_id,business_unit_id,role_id,status&app_user_id=eq.${encodeURIComponent(appUserId)}&organization_id=eq.${encodeURIComponent(orgId)}&status=eq.active`, access_token);
  if (!memberRes || !memberRes.ok) throw new Error("ServiceOS access denied: membership validation failed");
  const memberships = await memberRes.json();
  const activeMemberships = Array.isArray(memberships) ? memberships.filter((m) => m.status === "active") : [];
  if (!activeMemberships.length) throw new Error("ServiceOS access denied: active canonical membership not found");
  const roleById = new Map(roles.map((role) => [role.id, role.code]));
  const roleCodes = new Set(activeMemberships.map((membership) => roleById.get(membership.role_id)));
  if (roleCodes.size !== 1 || roleCodes.has(undefined)) throw new Error("ServiceOS access denied: mixed or unsupported canonical role");
  const roleCode = [...roleCodes][0];
  const roleId = roles.find((role) => role.code === roleCode).id;

  const visibleBusinessUnitIds = new Set(bus.map((businessUnit) => businessUnit.id));
  if (activeMemberships.some((membership) => membership.business_unit_id && !visibleBusinessUnitIds.has(membership.business_unit_id))) throw new Error("ServiceOS access denied: membership business unit is outside visible scope");

  const custRes = await authenticatedRestFetch("customer?select=id&limit=1", access_token);
  if (!custRes || !custRes.ok) throw new Error("ServiceOS access denied: customer access validation failed");

  return {
    orgId,
    appUserId,
    roleId,
    roleCode,
    businessUnits: buCodes,
    businessUnitByCode,
    businessUnitRecords: bus.map((b) => ({ id: b.id, code: b.code, name: b.name, jurisdictionId: b.jurisdiction_id ?? null })),
    primaryBusinessUnitId,
    primaryJurisdictionId,
  };
}
