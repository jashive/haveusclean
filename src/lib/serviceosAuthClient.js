import { getSupabaseConfig } from "./supabaseConfig";

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

  // 2. Validate both business units HUC-ON and HUC-AZ
  const buRes = await authenticatedRestFetch(
    `business_unit?select=id,code,name&code=in.(HUC-ON,HUC-AZ)&order=code.asc`,
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

  // Build a lookup map so Wave 2 can resolve HUC-ON / HUC-AZ → canonical UUID
  const businessUnitByCode = {};
  for (const bu of bus) {
    businessUnitByCode[bu.code] = { id: bu.id, code: bu.code, name: bu.name };
  }
  // Primary business unit defaults to HUC-ON (Ontario pilot)
  const primaryBusinessUnitId = businessUnitByCode["HUC-ON"]?.id ?? null;

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
    // Structured records keyed by code for UUID resolution (HUC-ON, HUC-AZ → id)
    businessUnitByCode,
    // Full array of { id, code, name } records
    businessUnitRecords: bus.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    // Primary canonical business_unit.id (HUC-ON pilot default)
    primaryBusinessUnitId,
  };
}
