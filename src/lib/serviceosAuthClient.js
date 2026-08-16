import { getSupabaseConfig } from "./supabaseConfig.js";

const SESSION_KEY = "huc:serviceos-auth:v1";

function getConfig() {
  return getSupabaseConfig(
    typeof import.meta !== "undefined" ? import.meta.env : {}
  );
}

// ── Session storage ──────────────────────────────────────────────────────────

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

// ── Auth API ─────────────────────────────────────────────────────────────────

export async function signInWithPassword(email, password) {
  const { url, anon } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error_description ?? data?.msg ?? "Sign-in failed");
  }

  return storeSession(data);
}

export async function refreshSession(refreshToken) {
  const { url, anon } = getConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await response.json();

  if (!response.ok) {
    clearSession();
    throw new Error(data?.error_description ?? data?.msg ?? "Session refresh failed");
  }

  return storeSession(data);
}

export async function signOut(accessToken) {
  const { url, anon } = getConfig();
  try {
    await fetch(`${url}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
  } finally {
    clearSession();
  }
}

// ── Authenticated REST ────────────────────────────────────────────────────────

export async function authenticatedRestFetch(path, accessToken, options = {}) {
  const { url, anon } = getConfig();
  const { headers: extraHeaders, ...rest } = options;
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(extraHeaders ?? {}),
    },
  });
  return response;
}

// ── Token expiry helpers ──────────────────────────────────────────────────────

const TOKEN_EXPIRY_BUFFER_SECONDS = 60;

function isTokenExpiredOrNearlyExpired(session) {
  if (!session?.expires_at) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return session.expires_at - nowSec <= TOKEN_EXPIRY_BUFFER_SECONDS;
}

function isSupabaseExpiredError(status, body) {
  if (status === 401) return true;
  // PGRST303 = JWT expired PostgREST code
  if (typeof body === "string" && body.includes("PGRST303")) return true;
  if (body && typeof body === "object" && body.code === "PGRST303") return true;
  return false;
}

/**
 * Proactively refresh the stored session if the token is expired or nearly expired.
 * Returns the (possibly refreshed) access_token, or throws if refresh fails.
 * Never exposes tokens in logs.
 */
export async function getValidAccessToken() {
  const session = getStoredSession();
  if (!session?.access_token) {
    throw new Error("ServiceOS: no active session");
  }
  if (!isTokenExpiredOrNearlyExpired(session)) {
    return session.access_token;
  }
  if (!session.refresh_token) {
    clearSession();
    throw new Error("ServiceOS: session expired and no refresh token — please sign in again");
  }
  // Attempt proactive refresh
  const refreshed = await refreshSession(session.refresh_token);
  return refreshed.access_token;
}

/**
 * Authenticated REST fetch with automatic JWT refresh and single retry.
 * - Proactively refreshes if token is expired/nearly expired before the request.
 * - If the response indicates JWT expired (401 / PGRST303), refreshes once and retries once.
 * - Never retries more than once; never exposes tokens in UI/logs.
 * - If refresh fails, clears session and throws (fail closed).
 *
 * @param {string} path – PostgREST path (no leading slash)
 * @param {object} [options] – fetch options
 * @returns {Response}
 */
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
    // Clone the response so we can read the body without consuming it
    let bodyText = "";
    let bodyObj = null;
    try {
      bodyText = await response.clone().text();
      bodyObj = JSON.parse(bodyText);
    } catch {
      // ignore parse errors
    }

    if (isSupabaseExpiredError(response.status, bodyObj ?? bodyText)) {
      // Single refresh + single retry
      const session = getStoredSession();
      if (!session?.refresh_token) {
        clearSession();
        throw new Error("ServiceOS: session expired — please sign in again");
      }
      let refreshed;
      try {
        refreshed = await refreshSession(session.refresh_token);
      } catch {
        // refreshSession already called clearSession on failure
        throw new Error("ServiceOS: session expired and refresh failed — please sign in again");
      }
      return authenticatedRestFetch(path, refreshed.access_token, options);
    }
  }

  return response;
}

// ── Canonical ServiceOS context validation ────────────────────────────────────

export async function validateServiceOSContext(session) {
  const { access_token, user } = session;
  const authUserId = user?.id;

  if (!access_token || !authUserId) {
    throw new Error("ServiceOS access denied: missing credentials");
  }

  // 1. Validate organization HUC
  const orgRes = await authenticatedRestFetch(
    "organization?select=id,code,name&code=eq.HUC&limit=1",
    access_token
  );
  if (!orgRes || !orgRes.ok) {
    throw new Error("ServiceOS access denied: organization validation failed");
  }
  const orgs = await orgRes.json();
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error("ServiceOS access denied: organization HUC not found");
  }
  const orgId = orgs[0].id;

  // 2. Validate both business units HUC-ON and HUC-AZ (include jurisdiction_id for service_location)
  const buRes = await authenticatedRestFetch(
    `business_unit?select=id,code,name,jurisdiction_id&code=in.(HUC-ON,HUC-AZ)&order=code.asc`,
    access_token
  );
  if (!buRes || !buRes.ok) {
    throw new Error("ServiceOS access denied: business unit validation failed");
  }
  const bus = await buRes.json();
  if (!Array.isArray(bus)) {
    throw new Error("ServiceOS access denied: business unit validation failed");
  }
  const buCodes = bus.map((b) => b.code);
  if (!buCodes.includes("HUC-ON") || !buCodes.includes("HUC-AZ")) {
    throw new Error(
      `ServiceOS access denied: required business units not found (found: ${buCodes.join(", ")})`
    );
  }

  // Build a lookup map so Wave 2 can resolve HUC-ON / HUC-AZ → canonical UUID + jurisdiction
  const businessUnitByCode = {};
  for (const bu of bus) {
    businessUnitByCode[bu.code] = {
      id: bu.id,
      code: bu.code,
      name: bu.name,
      jurisdictionId: bu.jurisdiction_id ?? null,
    };
  }
  // Primary business unit defaults to HUC-ON (Ontario pilot)
  const primaryBusinessUnitId = businessUnitByCode["HUC-ON"]?.id ?? null;
  // Jurisdiction for HUC-ON pilot service locations — derived from live DB, never invented
  const primaryJurisdictionId = businessUnitByCode["HUC-ON"]?.jurisdictionId ?? null;

  // 3. Validate exactly one active app_user matching the auth user ID
  const userRes = await authenticatedRestFetch(
    `app_user?select=id,auth_user_id,email,status&auth_user_id=eq.${encodeURIComponent(authUserId)}`,
    access_token
  );
  if (!userRes || !userRes.ok) {
    throw new Error("ServiceOS access denied: app_user validation failed");
  }
  const appUsers = await userRes.json();
  if (!Array.isArray(appUsers) || appUsers.length !== 1) {
    throw new Error(
      `ServiceOS access denied: expected exactly one visible app_user, found ${Array.isArray(appUsers) ? appUsers.length : "error"}`
    );
  }
  const appUser = appUsers[0];
  if (appUser.auth_user_id !== authUserId) {
    throw new Error("ServiceOS access denied: app_user auth_user_id mismatch");
  }
  if (appUser.status !== "active") {
    throw new Error("ServiceOS access denied: app_user is not active");
  }
  const appUserId = appUser.id;

  // 4. Validate app_role with code = owner_admin
  const roleRes = await authenticatedRestFetch(
    "app_role?select=id,code,name&code=eq.owner_admin&limit=1",
    access_token
  );
  if (!roleRes || !roleRes.ok) {
    throw new Error("ServiceOS access denied: role validation failed");
  }
  const roles = await roleRes.json();
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error("ServiceOS access denied: owner_admin role not found");
  }
  const roleId = roles[0].id;

  // 5. Validate active user_membership: matching app_user, org, and owner_admin role
  //    Enterprise-wide memberships have business_unit_id null — that is valid.
  const memberRes = await authenticatedRestFetch(
    `user_membership?select=id,app_user_id,organization_id,business_unit_id,role_id,status&app_user_id=eq.${encodeURIComponent(appUserId)}&organization_id=eq.${encodeURIComponent(orgId)}&role_id=eq.${encodeURIComponent(roleId)}`,
    access_token
  );
  if (!memberRes || !memberRes.ok) {
    throw new Error("ServiceOS access denied: membership validation failed");
  }
  const memberships = await memberRes.json();
  const activeMembership = Array.isArray(memberships)
    ? memberships.find((m) => m.status === "active")
    : null;
  if (!activeMembership) {
    throw new Error("ServiceOS access denied: active owner_admin membership not found");
  }

  // 6. Authenticated customer SELECT (zero rows is acceptable; auth failure is not)
  const custRes = await authenticatedRestFetch(
    "customer?select=id&limit=1",
    access_token
  );
  if (!custRes || !custRes.ok) {
    throw new Error("ServiceOS access denied: customer access validation failed");
  }

  // All checks passed
  return {
    orgId,
    appUserId,
    roleId,
    // Backward-compat: array of codes for any code still checking businessUnits
    businessUnits: buCodes,
    // Structured records keyed by code for UUID resolution (HUC-ON, HUC-AZ → id + jurisdictionId)
    businessUnitByCode,
    // Full array of { id, code, name, jurisdictionId } records
    businessUnitRecords: bus.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      jurisdictionId: b.jurisdiction_id ?? null,
    })),
    // Primary canonical business_unit.id (HUC-ON pilot default)
    primaryBusinessUnitId,
    // HUC-ON jurisdiction_id for service_location — from live DB, never invented
    primaryJurisdictionId,
  };
}
