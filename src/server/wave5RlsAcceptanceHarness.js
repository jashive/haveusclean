// src/server/wave5RlsAcceptanceHarness.js
//
// Wave 5 authenticated RLS acceptance harness — PREVIEW/TEST ONLY.
//
// SECURITY MODEL:
//   - Requires SERVICEOS_ENVIRONMENT=preview|test
//   - Requires SERVICEOS_W5_RLS_HARNESS_ENABLED=true
//   - Fails closed in production or unknown environments
//   - Uses the requesting browser's authenticated ****** for owner_admin
//   - Verifies requester resolves to active app_user, HUC organization, active owner_admin membership
//   - Uses role-specific Supabase sessions for office_ops / worker / qa probes
//   - Never creates auth users or mutates retained Wave 5 evidence intentionally
//   - Never returns or logs passwords, access tokens, refresh tokens, SUPABASE_ANON_KEY, or SERVICE_ROLE_KEY
//   - Uses service_role only for authoritative before/after snapshots and integrity verification

import { randomUUID } from "node:crypto";

const CONTRACT_VERSION = "wave5-rls-acceptance-v1";

const CANONICAL = Object.freeze({
  organization_id: "5614e474-7334-4c15-b430-52597c103e18",
  business_unit_id: "1089e787-5316-437f-884e-adad3a907c81",
  operational_job_id: "e1100000-0000-0000-0000-00000000000e",
  work_order_id: "e1100000-0000-0000-0000-000000000011",
  worker_assignment_id: "e1100000-0000-0000-0000-000000000010",
  worker_id: "1b3a6903-0c50-4a95-afc3-280628c10508",
  billing_readiness_gate_id: "c626972d-3d5f-411c-ba87-613a62f5a885",
  invoice_request_id: "71fec2d6-a941-4644-901b-f35d2a29afdd",
  accounting_sync_outbox_id: "a2e69627-fb22-4017-a4e2-122f433430d5",
  payment_observation_id: "50f67517-4d3d-4c06-b591-d8eb957c274f",
  contractor_compensation_version_id: "311af2e2-b5b8-4a0d-a738-cb0eaf440284",
  contractor_payable_id: "23026a2e-13e9-4a0a-938a-95f4fc28761b",
  job_profitability_snapshot_id: "ccb119bb-a6cc-49da-8ede-72454404fb48",
});

const RETAINED_TABLES = Object.freeze([
  ["billing_readiness_gate", CANONICAL.billing_readiness_gate_id],
  ["invoice_request", CANONICAL.invoice_request_id],
  ["accounting_sync_outbox", CANONICAL.accounting_sync_outbox_id],
  ["payment_observation", CANONICAL.payment_observation_id],
  ["contractor_compensation_version", CANONICAL.contractor_compensation_version_id],
  ["contractor_payable", CANONICAL.contractor_payable_id],
  ["job_profitability_snapshot", CANONICAL.job_profitability_snapshot_id],
]);

const CLASSIFICATION = Object.freeze({
  PROVEN_ALLOW: "proven_allow",
  PROVEN_RLS_DENY: "proven_rls_deny",
  PROVEN_AUTHZ_DENY: "proven_authz_deny",
  UNEXPECTED_ALLOW: "unexpected_allow",
  UNEXPECTED_DENY: "unexpected_deny",
  VALIDATION_FAILURE: "validation_failure",
  NOT_PROVEN: "not_proven",
  TRANSPORT_FAILURE: "transport_failure",
});

function getEnvironment() {
  const raw = (process.env.SERVICEOS_ENVIRONMENT || "").trim().toLowerCase();
  if (raw === "preview" || raw === "test") return raw;
  return null;
}

function isHarnessEnabled() {
  return process.env.SERVICEOS_W5_RLS_HARNESS_ENABLED === "true";
}

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
}

function bodyText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function isTransportFailure(result) {
  return result.status === 0 || !!result.error;
}

function isRlsDeniedResponse(result) {
  if (result.status === 401 || result.status === 403) return true;
  const text = `${bodyText(result.body)} ${result.raw_text || ""}`.toLowerCase();
  return (
    text.includes("row-level security") ||
    text.includes("permission denied") ||
    text.includes("insufficient_privilege") ||
    text.includes('"code":"42501"') ||
    text.includes("permission denied for table")
  );
}

function isAuthorizationGuardResponse(result) {
  const text = `${bodyText(result.body)} ${result.raw_text || ""}`.toLowerCase();
  return (
    text.includes("expected exactly one app_user") ||
    text.includes("app_user is not active") ||
    text.includes("authenticated worker context") ||
    text.includes("actor_worker_id") ||
    text.includes("actor_app_user_id") ||
    text.includes("active owner_admin") ||
    text.includes("active office_ops") ||
    text.includes("serviceos finance authorization failed")
  );
}

function isValidationFailureResponse(result) {
  const text = `${bodyText(result.body)} ${result.raw_text || ""}`.toLowerCase();
  return (
    result.status === 400 ||
    result.status === 409 ||
    result.status === 422 ||
    text.includes("violates check constraint") ||
    text.includes("violates foreign key constraint") ||
    text.includes("violates unique constraint") ||
    text.includes("duplicate key") ||
    text.includes("null value") ||
    text.includes("invalid input syntax") ||
    text.includes("not-null") ||
    text.includes("must be") ||
    text.includes("immutable") ||
    text.includes("append-only")
  );
}

function buildProbe({
  role,
  operation,
  table,
  expected,
  mandatory = true,
  classification,
  result = null,
  note = null,
  proof_detail = null,
  expected_scope = null,
  actual_row_count = null,
  integrity = null,
}) {
  const pass =
    classification === CLASSIFICATION.PROVEN_ALLOW ||
    classification === CLASSIFICATION.PROVEN_RLS_DENY ||
    classification === CLASSIFICATION.PROVEN_AUTHZ_DENY;
  return {
    role,
    operation,
    table,
    expected,
    mandatory,
    classification,
    pass,
    actual_status: result?.status ?? null,
    actual_ok: result?.ok ?? null,
    actual_row_count,
    expected_scope,
    proof_detail,
    integrity,
    note,
  };
}

function summarizeProbes(role, probes) {
  const mandatory = probes.filter((probe) => probe.mandatory);
  const provenCount = probes.filter((probe) => probe.pass).length;
  const failedCount = probes.filter(
    (probe) => !probe.pass && probe.classification !== CLASSIFICATION.NOT_PROVEN
  ).length;
  const notProvenCount = probes.filter(
    (probe) => probe.classification === CLASSIFICATION.NOT_PROVEN
  ).length;
  const mandatoryNotProven = mandatory.filter(
    (probe) => probe.classification === CLASSIFICATION.NOT_PROVEN
  );
  return {
    role,
    probes,
    passed: mandatory.every((probe) => probe.pass),
    proven_count: provenCount,
    failed_count: failedCount,
    not_proven_count: notProvenCount,
    mandatory_not_proven_count: mandatoryNotProven.length,
    mandatory_failures: mandatory
      .filter((probe) => !probe.pass && probe.classification !== CLASSIFICATION.NOT_PROVEN)
      .map((probe) => probe.operation),
    mandatory_not_proven: mandatoryNotProven.map((probe) => probe.operation),
  };
}

async function signInWithPassword(supabaseUrl, anonKey, email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Auth failed for ${email}: HTTP ${res.status} ${text}`), {
      code: "AUTH_FAILED",
      email,
    });
  }
  const data = await res.json();
  if (!data?.access_token) {
    throw Object.assign(new Error(`Auth returned no access_token for ${email}`), {
      code: "NO_ACCESS_TOKEN",
      email,
    });
  }
  return data.access_token;
}

async function restProbe(supabaseUrl, apiKey, accessToken, method, table, options = {}) {
  const { body = null, filter = "", prefer = "return=representation" } = options;
  const url = `${supabaseUrl}/rest/v1/${table}${filter}`;
  const headers = {
    apikey: apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: prefer,
  };
  if (accessToken) headers.Authorization = "Bearer " + accessToken;
  const reqInit = { method, headers };
  if (body !== null && method !== "GET" && method !== "DELETE") {
    reqInit.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, reqInit);
    const status = res.status;
    const rawText = await res.text().catch(() => "");
    let responseBody = null;
    if (rawText) {
      try {
        responseBody = JSON.parse(rawText);
      } catch {
        responseBody = rawText;
      }
    }
    return { ok: res.ok, status, body: responseBody, raw_text: rawText, method, table };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      raw_text: "",
      error: error.message,
      method,
      table,
    };
  }
}

async function loadAuthenticatedAuthUser(accessToken) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Failed to validate ServiceOS bearer token: HTTP ${res.status} ${text}`), {
      status: 401,
    });
  }
  const user = await res.json();
  if (!user?.id) {
    throw Object.assign(new Error("ServiceOS bearer token did not resolve to an auth user"), {
      status: 401,
    });
  }
  return user;
}

async function authenticatedRestFetchPath(accessToken, path) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

async function loadActiveAppUser(accessToken, authUserId) {
  const res = await authenticatedRestFetchPath(
    accessToken,
    `app_user?select=id,auth_user_id,status,email&auth_user_id=eq.${encodeURIComponent(authUserId)}`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`app_user lookup failed: HTTP ${res.status} ${text}`), { status: 403 });
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw Object.assign(new Error("expected exactly one app_user for authenticated auth user"), {
      status: 403,
    });
  }
  const appUser = rows[0];
  if (appUser.auth_user_id !== authUserId) {
    throw Object.assign(new Error("app_user auth_user_id mismatch"), { status: 403 });
  }
  if (appUser.status !== "active") {
    throw Object.assign(new Error("app_user is not active"), { status: 403 });
  }
  return appUser;
}

async function loadHucOrganization(accessToken) {
  const res = await authenticatedRestFetchPath(
    accessToken,
    "organization?select=id,code,name&code=eq.HUC&limit=1"
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`organization lookup failed: HTTP ${res.status} ${text}`), {
      status: 403,
    });
  }
  const rows = await res.json();
  const org = Array.isArray(rows) ? rows[0] ?? null : null;
  if (!org?.id) {
    throw Object.assign(new Error("HUC organization is not visible to the requester"), { status: 403 });
  }
  if (org.id !== CANONICAL.organization_id) {
    throw Object.assign(new Error("HUC organization id does not match retained Wave 5 scope"), {
      status: 403,
    });
  }
  return org;
}

async function loadRoleMap(accessToken, codes) {
  const res = await authenticatedRestFetchPath(
    accessToken,
    `app_role?select=id,code&code=in.(${codes.map((code) => code).join(",")})`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`role lookup failed: HTTP ${res.status} ${text}`), { status: 403 });
  }
  const rows = await res.json();
  const map = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.id && row?.code)
      .map((row) => [row.code, row.id])
  );
  return map;
}

async function loadActiveOwnerAdminMembership(accessToken, appUserId, hucOrgId) {
  const roleMap = await loadRoleMap(accessToken, ["owner_admin"]);
  const ownerAdminRoleId = roleMap.get("owner_admin");
  if (!ownerAdminRoleId) {
    throw Object.assign(new Error("owner_admin role is not visible to the requester"), { status: 403 });
  }
  const res = await authenticatedRestFetchPath(
    accessToken,
    `user_membership?select=id,app_user_id,organization_id,business_unit_id,role_id,status` +
      `&app_user_id=eq.${encodeURIComponent(appUserId)}` +
      `&organization_id=eq.${encodeURIComponent(hucOrgId)}` +
      `&status=eq.active` +
      `&role_id=eq.${encodeURIComponent(ownerAdminRoleId)}`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`user_membership lookup failed: HTTP ${res.status} ${text}`), {
      status: 403,
    });
  }
  const rows = await res.json();
  const membership = (Array.isArray(rows) ? rows : []).find(
    (row) =>
      row.organization_id === hucOrgId &&
      row.role_id === ownerAdminRoleId &&
      row.status === "active" &&
      (row.business_unit_id == null || row.business_unit_id === CANONICAL.business_unit_id)
  );
  if (!membership) {
    throw Object.assign(
      new Error("active owner_admin membership in HUC for the retained Wave 5 scope was not found"),
      { status: 403 }
    );
  }
  return membership;
}

function resolveRoleCredential(roleKey, wave5Prefix, wave4Prefix) {
  const w5Email = process.env[`${wave5Prefix}_EMAIL`] || "";
  const w5Password = process.env[`${wave5Prefix}_PASSWORD`] || "";
  if (w5Email && w5Password) {
    return {
      role: roleKey,
      email: w5Email,
      password: w5Password,
      source: "wave5",
      env_keys: [`${wave5Prefix}_EMAIL`, `${wave5Prefix}_PASSWORD`],
    };
  }
  const w4Email = process.env[`${wave4Prefix}_EMAIL`] || "";
  const w4Password = process.env[`${wave4Prefix}_PASSWORD`] || "";
  if (w4Email && w4Password) {
    return {
      role: roleKey,
      email: w4Email,
      password: w4Password,
      source: "wave4_fallback",
      env_keys: [`${wave4Prefix}_EMAIL`, `${wave4Prefix}_PASSWORD`],
    };
  }
  return {
    role: roleKey,
    email: null,
    password: null,
    source: null,
    env_keys: [
      `${wave5Prefix}_EMAIL`,
      `${wave5Prefix}_PASSWORD`,
      `${wave4Prefix}_EMAIL`,
      `${wave4Prefix}_PASSWORD`,
    ],
  };
}

// ── Identity resolution helpers ───────────────────────────────────────────────

const CANONICAL_APP_USERS = Object.freeze({
  office_ops: "e884d76e-d54d-4af3-93df-accf9bf34f44",
  worker: "93338807-efa2-4ada-88a9-54c18813c336",
  qa: "e04a824d-6b06-41fd-addf-14ce35d488b7",
});

const CANONICAL_WORKER_ID = "1b3a6903-0c50-4a95-afc3-280628c10508";

function collectAllCredentialCandidates() {
  const prefixes = [
    { label: "SERVICEOS_W5_RLS_OFFICE_OPS", env_role: "office_ops" },
    { label: "SERVICEOS_W4_RLS_OFFICE_OPS", env_role: "office_ops" },
    { label: "SERVICEOS_W5_RLS_WORKER",     env_role: "worker"     },
    { label: "SERVICEOS_W4_RLS_WORKER",     env_role: "worker"     },
    { label: "SERVICEOS_W5_RLS_QA",         env_role: "qa"         },
    { label: "SERVICEOS_W4_RLS_QA",         env_role: "qa"         },
  ];
  const seen = new Set();
  const candidates = [];
  for (const { label, env_role } of prefixes) {
    const email    = process.env[`${label}_EMAIL`]    || "";
    const password = process.env[`${label}_PASSWORD`] || "";
    if (!email || !password) continue;
    const key = `${email}::${password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ env_label: label, env_role, email, password });
  }
  return candidates;
}

async function resolveTokenIdentity(token, ownerToken) {
  // Use the candidate's own token for auth-user lookup; use ownerToken for RLS-protected lookups
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  // 1. Resolve auth user id
  const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: "Bearer " + token },
  });
  if (!authRes.ok) {
    throw new Error(`auth/v1/user failed: HTTP ${authRes.status}`);
  }
  const authUser = await authRes.json();
  if (!authUser?.id) throw new Error("token did not resolve to an auth user");

  // 2. Resolve app_user via owner token (for cross-account lookups)
  const appUserRes = await authenticatedRestFetchPath(
    ownerToken,
    `app_user?select=id,auth_user_id,status&auth_user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`
  );
  let appUserId = null;
  if (appUserRes.ok) {
    const rows = await appUserRes.json().catch(() => []);
    appUserId = Array.isArray(rows) && rows.length === 1 ? rows[0].id : null;
  }

  // 3. Resolve active memberships
  let activeRoleCodes = [];
  if (appUserId) {
    const memRes = await authenticatedRestFetchPath(
      ownerToken,
      `user_membership?select=role_id,status&app_user_id=eq.${encodeURIComponent(appUserId)}&organization_id=eq.${encodeURIComponent(CANONICAL.organization_id)}&status=eq.active`
    );
    if (memRes.ok) {
      const memRows = await memRes.json().catch(() => []);
      const roleIds = Array.isArray(memRows) ? memRows.map((r) => r.role_id).filter(Boolean) : [];
      if (roleIds.length > 0) {
        const roleRes = await authenticatedRestFetchPath(
          ownerToken,
          `app_role?select=id,code&id=in.(${roleIds.join(",")})`
        );
        if (roleRes.ok) {
          const roleRows = await roleRes.json().catch(() => []);
          activeRoleCodes = Array.isArray(roleRows) ? roleRows.map((r) => r.code).filter(Boolean) : [];
        }
      }
    }
  }

  // 4. Resolve worker row if one exists
  let workerId = null;
  if (appUserId) {
    const workerRes = await authenticatedRestFetchPath(
      ownerToken,
      `worker?select=id,app_user_id,is_active,organization_id&app_user_id=eq.${encodeURIComponent(appUserId)}&limit=1`
    );
    if (workerRes.ok) {
      const workerRows = await workerRes.json().catch(() => []);
      workerId = Array.isArray(workerRows) && workerRows.length === 1 ? workerRows[0].id : null;
    }
  }

  return { auth_user_id: authUser.id, app_user_id: appUserId, active_role_codes: activeRoleCodes, worker_id: workerId };
}

export function buildIdentityAudit({ candidates, identities, tokensByLabel }) {
  // candidates: [{env_label, env_role, email, password}]
  // identities: Map<token, {auth_user_id, app_user_id, active_role_codes, worker_id}>
  // tokensByLabel: Map<env_label, token>

  function auditRole(canonicalRole, expectedAppUserId) {
    const matching = candidates.filter((c) => {
      const t = tokensByLabel.get(c.env_label);
      if (!t) return false;
      const id = identities.get(t);
      return id && id.app_user_id === expectedAppUserId;
    });

    if (matching.length === 0) {
      return {
        passed: false,
        expected_app_user_id: expectedAppUserId,
        actual_app_user_id: null,
        expected_role: canonicalRole,
        active_role_codes: [],
        scope_valid: false,
        credential_source: null,
        credential_label_mismatch: false,
        privilege_contamination: [],
        error: "expected_identity_not_found",
      };
    }

    const cred = matching[0];
    const token = tokensByLabel.get(cred.env_label);
    const identity = identities.get(token);
    const labelMismatch = cred.env_role !== canonicalRole;
    const contamination = [];

    if (canonicalRole === "office_ops") {
      if (identity.active_role_codes.includes("owner_admin")) contamination.push("owner_admin");
    }
    if (canonicalRole === "worker") {
      if (identity.active_role_codes.includes("owner_admin")) contamination.push("owner_admin");
      if (identity.active_role_codes.includes("office_ops"))  contamination.push("office_ops");
    }
    if (canonicalRole === "qa") {
      if (identity.active_role_codes.includes("owner_admin")) contamination.push("owner_admin");
      if (identity.active_role_codes.includes("office_ops"))  contamination.push("office_ops");
    }

    const hasExpectedRole = identity.active_role_codes.includes(canonicalRole) ||
      (canonicalRole === "worker" && identity.worker_id != null);

    const result = {
      passed: hasExpectedRole && contamination.length === 0,
      expected_app_user_id: expectedAppUserId,
      actual_app_user_id: identity.app_user_id,
      expected_role: canonicalRole,
      active_role_codes: identity.active_role_codes,
      credential_source: cred.env_label,
      credential_label_mismatch: labelMismatch,
      privilege_contamination: contamination,
    };

    if (canonicalRole === "worker") {
      result.canonical_worker_id = CANONICAL_WORKER_ID;
      result.actual_worker_id = identity.worker_id;
      result.worker_link_valid = identity.worker_id === CANONICAL_WORKER_ID;
      result.passed = result.passed && result.worker_link_valid;
      delete result.scope_valid;
    } else {
      result.scope_valid = hasExpectedRole;
    }

    return result;
  }

  // Check for duplicate resolution (two credentials → same canonical app_user)
  const appUserTokenCount = new Map();
  for (const [token, id] of identities) {
    if (!id.app_user_id) continue;
    appUserTokenCount.set(id.app_user_id, (appUserTokenCount.get(id.app_user_id) || 0) + 1);
  }
  const duplicates = [...appUserTokenCount.entries()]
    .filter(([, count]) => count > 1)
    .map(([appUserId]) => appUserId);

  return {
    office_ops: auditRole("office_ops", CANONICAL_APP_USERS.office_ops),
    worker: auditRole("worker", CANONICAL_APP_USERS.worker),
    qa: auditRole("qa", CANONICAL_APP_USERS.qa),
    duplicate_resolutions: duplicates,
  };
}

export function resolveNormalizedTokenMap(candidates, identities, tokensByLabel) {
  // For each canonical role, find the candidate whose token resolves to the expected app_user_id
  const result = {};
  for (const [canonicalRole, expectedAppUserId] of Object.entries(CANONICAL_APP_USERS)) {
    for (const cred of candidates) {
      const token = tokensByLabel.get(cred.env_label);
      if (!token) continue;
      const identity = identities.get(token);
      if (identity && identity.app_user_id === expectedAppUserId) {
        result[canonicalRole] = token;
        break;
      }
    }
  }
  return result;
}

async function serviceRoleExactRow(table, id) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(
    `${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Service-role ${table} lookup failed: HTTP ${res.status} ${text}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function serviceRoleHasRow(table, id) {
  return !!(await serviceRoleExactRow(table, id));
}

async function captureRetainedSnapshots() {
  const entries = await Promise.all(
    RETAINED_TABLES.map(async ([table, id]) => [table, await serviceRoleExactRow(table, id)])
  );
  return Object.fromEntries(entries);
}

function compareRetainedSnapshots(before, after) {
  const drift = [];
  for (const [table] of RETAINED_TABLES) {
    const left = stableStringify(before[table] ?? null);
    const right = stableStringify(after[table] ?? null);
    if (left !== right) drift.push(table);
  }
  return { unchanged: drift.length === 0, drift_tables: drift };
}

async function discoverOtherWorkerEvidence() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const [ccvRes, cpRes] = await Promise.all([
    fetch(
      `${supabaseUrl}/rest/v1/contractor_compensation_version?select=id,worker_id&worker_id=neq.${encodeURIComponent(CANONICAL.worker_id)}&limit=1`,
      { headers }
    ),
    fetch(
      `${supabaseUrl}/rest/v1/contractor_payable?select=id,worker_id&worker_id=neq.${encodeURIComponent(CANONICAL.worker_id)}&limit=1`,
      { headers }
    ),
  ]);
  const parse = async (res) => {
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows[0] ?? null : null;
  };
  return {
    compensation: await parse(ccvRes),
    payable: await parse(cpRes),
  };
}

function makeBrgInsertPayload(id) {
  return {
    id,
    organization_id: CANONICAL.organization_id,
    business_unit_id: CANONICAL.business_unit_id,
    operational_job_id: CANONICAL.operational_job_id,
    work_order_id: CANONICAL.work_order_id,
    pricing_snapshot_id: randomUUID(),
    quote_version_id: randomUUID(),
    gate_status: "ready",
    gate_assessment: { probe: "wave5-rls-acceptance" },
    blocking_reasons: [],
    metadata: { probe: "wave5-rls-acceptance" },
  };
}

function makeInvoiceInsertPayload(id) {
  return {
    id,
    organization_id: CANONICAL.organization_id,
    business_unit_id: CANONICAL.business_unit_id,
    billing_readiness_gate_id: CANONICAL.billing_readiness_gate_id,
    operational_job_id: CANONICAL.operational_job_id,
    work_order_id: CANONICAL.work_order_id,
    pricing_snapshot_id: randomUUID(),
    quote_version_id: randomUUID(),
    currency_code: "CAD",
    subtotal_amount: 220,
    tax_amount: 0,
    total_amount: 220,
    request_status: "draft",
    financial_snapshot: { probe: "wave5-rls-acceptance" },
    metadata: { probe: "wave5-rls-acceptance" },
  };
}

function makeOutboxInsertPayload(id) {
  return {
    id,
    organization_id: CANONICAL.organization_id,
    business_unit_id: CANONICAL.business_unit_id,
    invoice_request_id: CANONICAL.invoice_request_id,
    idempotency_key: `wave5-rls-${id}`,
    provider: "preview_test",
    outbox_status: "pending",
    request_payload: { probe: "wave5-rls-acceptance" },
    metadata: { probe: "wave5-rls-acceptance" },
  };
}

function makePaymentInsertPayload(id) {
  return {
    id,
    organization_id: CANONICAL.organization_id,
    business_unit_id: CANONICAL.business_unit_id,
    invoice_request_id: CANONICAL.invoice_request_id,
    provider: "preview_test",
    provider_event_id: `wave5-rls-${id}`,
    provider_event_type: "wave5.rls.acceptance",
    currency_code: "CAD",
    amount_observed: 0,
    payment_status: "observed",
    event_payload_snapshot: { probe: "wave5-rls-acceptance" },
    observed_at: new Date().toISOString(),
    is_test_provider: true,
    metadata: { probe: "wave5-rls-acceptance" },
  };
}

function makeCompensationInsertPayload(id) {
  return {
    id,
    organization_id: CANONICAL.organization_id,
    business_unit_id: CANONICAL.business_unit_id,
    worker_id: CANONICAL.worker_id,
    version: `wave5-rls-${id}`,
    compensation_method: "percentage",
    currency_code: "CAD",
    rate_value: 2,
    effective_from: new Date().toISOString(),
    compensation_status: "draft",
    governance_reference_snapshot: { probe: "wave5-rls-acceptance" },
    metadata: { probe: "wave5-rls-acceptance" },
  };
}

function makePayableInsertPayload(id) {
  return {
    id,
    organization_id: CANONICAL.organization_id,
    business_unit_id: CANONICAL.business_unit_id,
    worker_id: CANONICAL.worker_id,
    worker_assignment_id: CANONICAL.worker_assignment_id,
    operational_job_id: CANONICAL.operational_job_id,
    work_order_id: CANONICAL.work_order_id,
    contractor_compensation_version_id: CANONICAL.contractor_compensation_version_id,
    compensation_method: "flat_amount",
    currency_code: "CAD",
    basis_value: -1,
    computed_amount: 80,
    payable_status: "pending",
    eligibility_assessment: { probe: "wave5-rls-acceptance" },
    metadata: { probe: "wave5-rls-acceptance" },
  };
}

function makeProfitabilityInsertPayload(id) {
  return {
    id,
    organization_id: CANONICAL.organization_id,
    business_unit_id: CANONICAL.business_unit_id,
    operational_job_id: CANONICAL.operational_job_id,
    invoice_request_id: CANONICAL.invoice_request_id,
    currency_code: "CAD",
    recognized_revenue_amount: 220,
    tax_amount: 0,
    direct_labor_cost: 80,
    other_direct_cost: -1,
    gross_margin_percent: 0.6364,
    source_lineage: { probe: "wave5-rls-acceptance" },
    metadata: { probe: "wave5-rls-acceptance" },
  };
}

function makeNoOpPatch(table, row) {
  switch (table) {
    case "billing_readiness_gate":
      return {
        gate_status: row.gate_status,
        gate_assessment: row.gate_assessment ?? {},
        blocking_reasons: row.blocking_reasons ?? [],
      };
    case "invoice_request":
      return {
        request_status: row.request_status,
        metadata: row.metadata ?? {},
      };
    case "accounting_sync_outbox":
      return {
        outbox_status: row.outbox_status,
        metadata: row.metadata ?? {},
      };
    case "payment_observation":
      return {
        payment_status: row.payment_status,
        metadata: row.metadata ?? {},
      };
    case "contractor_compensation_version":
      return {
        compensation_status: row.compensation_status,
        governance_reference_snapshot: row.governance_reference_snapshot ?? {},
      };
    case "contractor_payable":
      return {
        payable_status: row.payable_status,
        eligibility_assessment: row.eligibility_assessment ?? {},
      };
    case "job_profitability_snapshot":
      return {
        metadata: row.metadata ?? {},
      };
    default:
      return {};
  }
}

function classifyAllowSelectProbe({ role, operation, table, result, expected_scope, verifier }) {
  if (isTransportFailure(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      classification: CLASSIFICATION.TRANSPORT_FAILURE,
      result,
      expected_scope,
      note: result.error || "Transport failure",
    });
  }
  if (!result.ok) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      classification: CLASSIFICATION.UNEXPECTED_DENY,
      result,
      expected_scope,
      note: `Expected 2xx plus retained row visibility, received HTTP ${result.status}`,
    });
  }
  const rows = Array.isArray(result.body) ? result.body : [];
  if (verifier(rows)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      classification: CLASSIFICATION.PROVEN_ALLOW,
      result,
      expected_scope,
      actual_row_count: rows.length,
      note: "2xx response returned the retained expected row",
    });
  }
  return buildProbe({
    role,
    operation,
    table,
    expected: "allow",
    classification: CLASSIFICATION.NOT_PROVEN,
    result,
    expected_scope,
    actual_row_count: rows.length,
    note: "2xx response did not prove visibility of the retained row",
  });
}

function classifyVisibilityDenyProbe({ role, operation, table, result, expected_scope }) {
  if (isTransportFailure(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.TRANSPORT_FAILURE,
      result,
      expected_scope,
      note: result.error || "Transport failure",
    });
  }
  if (!result.ok) {
    if (isRlsDeniedResponse(result)) {
      return buildProbe({
        role,
        operation,
        table,
        expected: "deny",
        classification: CLASSIFICATION.PROVEN_RLS_DENY,
        result,
        expected_scope,
        note: "Authorization/RLS denial proven",
      });
    }
    if (isAuthorizationGuardResponse(result)) {
      return buildProbe({
        role,
        operation,
        table,
        expected: "deny",
        classification: CLASSIFICATION.PROVEN_AUTHZ_DENY,
        result,
        expected_scope,
        note: "Authorization guard denial proven",
      });
    }
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.NOT_PROVEN,
      result,
      expected_scope,
      note: `HTTP ${result.status} did not prove visibility denial`,
    });
  }
  const rows = Array.isArray(result.body) ? result.body : [];
  if (rows.length === 0) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.PROVEN_RLS_DENY,
      result,
      expected_scope,
      actual_row_count: 0,
      note: "Known retained row was filtered from the result set",
    });
  }
  return buildProbe({
    role,
    operation,
    table,
    expected: "deny",
    classification: CLASSIFICATION.UNEXPECTED_ALLOW,
    result,
    expected_scope,
    actual_row_count: rows.length,
    note: "Known retained row remained visible across the denied boundary",
  });
}

function classifyDenyMutationProbe({ role, operation, table, result, expected_scope, integrity = null }) {
  if (isTransportFailure(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.TRANSPORT_FAILURE,
      result,
      expected_scope,
      integrity,
      note: result.error || "Transport failure",
    });
  }
  if (result.ok) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.UNEXPECTED_ALLOW,
      result,
      expected_scope,
      integrity,
      note: "INSERT returned 2xx; this is an unexpected allow",
    });
  }
  if (isRlsDeniedResponse(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.PROVEN_RLS_DENY,
      result,
      expected_scope,
      integrity,
      note: "Authorization/RLS denial proven",
    });
  }
  if (isAuthorizationGuardResponse(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.PROVEN_AUTHZ_DENY,
      result,
      expected_scope,
      integrity,
      note: "Authorization guard denial proven",
    });
  }
  if (isValidationFailureResponse(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.VALIDATION_FAILURE,
      result,
      expected_scope,
      integrity,
      proof_detail: "request_reached_db_validation_after_authz",
      note: "DB validation/immutability reached after authorization; deny expectation failed",
    });
  }
  return buildProbe({
    role,
    operation,
    table,
    expected: "deny",
    classification: CLASSIFICATION.NOT_PROVEN,
    result,
    expected_scope,
    integrity,
    note: `HTTP ${result.status} did not prove authorization/RLS denial`,
  });
}

function classifyDenyPatchProbe({ role, operation, table, result, expected_scope, beforeRow, afterRow }) {
  if (isTransportFailure(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.TRANSPORT_FAILURE,
      result,
      expected_scope,
      note: result.error || "Transport failure",
    });
  }
  // CASE 6: canonical retained row did not exist before the probe — cannot prove denial
  if (!beforeRow) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.NOT_PROVEN,
      result,
      expected_scope,
      note: "Canonical retained row did not exist before the probe; RLS denial cannot be proven.",
    });
  }
  if (!result.ok) {
    // CASE 3: explicit RLS / authorization denial
    if (isRlsDeniedResponse(result)) {
      return buildProbe({
        role,
        operation,
        table,
        expected: "deny",
        classification: CLASSIFICATION.PROVEN_RLS_DENY,
        result,
        expected_scope,
        note: "Authorization/RLS denial proven",
      });
    }
    if (isAuthorizationGuardResponse(result)) {
      return buildProbe({
        role,
        operation,
        table,
        expected: "deny",
        classification: CLASSIFICATION.PROVEN_AUTHZ_DENY,
        result,
        expected_scope,
        note: "Authorization guard denial proven",
      });
    }
    // CASE 4: request reached DB validation/trigger after authorization
    if (isValidationFailureResponse(result)) {
      return buildProbe({
        role,
        operation,
        table,
        expected: "deny",
        classification: CLASSIFICATION.VALIDATION_FAILURE,
        result,
        expected_scope,
        proof_detail: "request_reached_db_validation_after_authz",
        note: "DB validation/immutability reached after authorization; deny expectation failed",
      });
    }
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.NOT_PROVEN,
      result,
      expected_scope,
      note: `HTTP ${result.status} did not prove authorization/RLS denial`,
    });
  }
  // result.ok (2xx) — must verify before/after row state
  const rows = Array.isArray(result.body) ? result.body : null;
  const beforeStable = stableStringify(beforeRow ?? null);
  const afterStable = stableStringify(afterRow ?? null);
  // CASE 5: retained row changed after probe — integrity failure
  if (afterStable !== beforeStable) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.UNEXPECTED_ALLOW,
      result,
      expected_scope,
      note: "PATCH returned 2xx and the retained row changed after the probe; integrity failure",
    });
  }
  // CASE 1: HTTP 2xx + empty representation + row existed and is unchanged
  if (rows !== null && rows.length === 0) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.PROVEN_RLS_DENY,
      result,
      expected_scope,
      actual_row_count: 0,
      proof_detail: "rls_filtered_update_zero_rows",
      note: "Known retained row existed, role PATCH affected zero rows, and retained row remained unchanged.",
    });
  }
  // CASE 2: HTTP 2xx + non-empty representation — unexpected allow
  if (rows !== null && rows.length > 0) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "deny",
      classification: CLASSIFICATION.UNEXPECTED_ALLOW,
      result,
      expected_scope,
      actual_row_count: rows.length,
      note: "PATCH returned 2xx with affected rows; unexpected allow",
    });
  }
  // 2xx with non-array body — cannot prove denial
  return buildProbe({
    role,
    operation,
    table,
    expected: "deny",
    classification: CLASSIFICATION.NOT_PROVEN,
    result,
    expected_scope,
    note: "PATCH returned 2xx with non-array body; cannot prove denial",
  });
}

function classifyAllowMutationNoPersistProbe({
  role,
  operation,
  table,
  result,
  expected_scope,
  attemptedRowPersisted,
}) {
  const integrity = { attempted_row_persisted: attemptedRowPersisted };
  if (isTransportFailure(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      classification: CLASSIFICATION.TRANSPORT_FAILURE,
      result,
      expected_scope,
      integrity,
      note: result.error || "Transport failure",
    });
  }
  if (result.ok) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      classification: CLASSIFICATION.UNEXPECTED_ALLOW,
      result,
      expected_scope,
      integrity,
      note: "Mutation returned 2xx for a non-persisting authorization probe",
    });
  }
  if (isValidationFailureResponse(result) && !attemptedRowPersisted) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      classification: CLASSIFICATION.PROVEN_ALLOW,
      result,
      expected_scope,
      integrity,
      proof_detail: "authorization_path_proven_no_row_persisted",
      note: "RLS/WITH CHECK passed and the request reached DB validation with zero retained data drift",
    });
  }
  if (isRlsDeniedResponse(result) || isAuthorizationGuardResponse(result)) {
    return buildProbe({
      role,
      operation,
      table,
      expected: "allow",
      classification: CLASSIFICATION.UNEXPECTED_DENY,
      result,
      expected_scope,
      integrity,
      note: "Request was denied before the DB validation layer",
    });
  }
  return buildProbe({
    role,
    operation,
    table,
    expected: "allow",
    classification: CLASSIFICATION.NOT_PROVEN,
    result,
    expected_scope,
    integrity,
    note: "Authorization path was not conclusively proven",
  });
}

async function selectExactRowProbe(role, token, table, id, expectation = "allow", extraScope = null) {
  const result = await restProbe(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    token,
    "GET",
    table,
    {
      filter: `?id=eq.${encodeURIComponent(id)}&limit=1`,
      prefer: "return=representation",
    }
  );
  const expected_scope = { id, ...(extraScope ?? {}) };
  if (expectation === "allow") {
    return classifyAllowSelectProbe({
      role,
      operation: `SELECT ${table} (retained canonical row)`,
      table,
      result,
      expected_scope,
      verifier: (rows) => rows.some((row) => row.id === id),
    });
  }
  return classifyVisibilityDenyProbe({
    role,
    operation: `SELECT ${table} (retained canonical row)`,
    table,
    result,
    expected_scope,
  });
}

async function scopedMismatchSelectProbe(role, token, table, id, filterKey, filterValue) {
  const result = await restProbe(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    token,
    "GET",
    table,
    {
      filter:
        `?id=eq.${encodeURIComponent(id)}` +
        `&${filterKey}=eq.${encodeURIComponent(filterValue)}` +
        `&limit=1`,
      prefer: "return=representation",
    }
  );
  return classifyVisibilityDenyProbe({
    role,
    operation: `SELECT ${table} (retained row with mismatched ${filterKey})`,
    table,
    result,
    expected_scope: { id, [filterKey]: filterValue },
  });
}

async function denyInsertProbe(role, token, table, payload) {
  const result = await restProbe(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    token,
    "POST",
    table,
    { body: payload }
  );
  const persisted = await serviceRoleHasRow(table, payload.id);
  return classifyDenyMutationProbe({
    role,
    operation: `INSERT ${table} (safe validation probe)`,
    table,
    result,
    expected_scope: { id: payload.id, organization_id: CANONICAL.organization_id, business_unit_id: CANONICAL.business_unit_id },
    integrity: { attempted_row_persisted: persisted },
  });
}

async function allowInsertNoPersistProbe(role, token, table, payload) {
  const result = await restProbe(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    token,
    "POST",
    table,
    { body: payload }
  );
  const persisted = await serviceRoleHasRow(table, payload.id);
  return classifyAllowMutationNoPersistProbe({
    role,
    operation: `INSERT ${table} (safe authorization-path probe)`,
    table,
    result,
    expected_scope: { id: payload.id, organization_id: CANONICAL.organization_id, business_unit_id: CANONICAL.business_unit_id },
    attemptedRowPersisted: persisted,
  });
}

async function denyPatchProbe(role, token, table, id) {
  const beforeRow = await serviceRoleExactRow(table, id);
  const patch = makeNoOpPatch(table, beforeRow ?? {});
  const result = await restProbe(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    token,
    "PATCH",
    table,
    {
      filter: `?id=eq.${encodeURIComponent(id)}`,
      body: patch,
      prefer: "return=representation",
    }
  );
  const afterRow = await serviceRoleExactRow(table, id);
  return classifyDenyPatchProbe({
    role,
    operation: `UPDATE ${table} (retained canonical row, no-op patch)`,
    table,
    result,
    expected_scope: { id },
    beforeRow,
    afterRow,
  });
}

async function probeOwnerAdmin(requesterToken) {
  const role = "owner_admin";
  const probes = [];
  for (const [table, id] of RETAINED_TABLES) {
    probes.push(await selectExactRowProbe(role, requesterToken, table, id));
  }
  probes.push(
    await allowInsertNoPersistProbe(role, requesterToken, "billing_readiness_gate", makeBrgInsertPayload(randomUUID()))
  );
  probes.push(
    await allowInsertNoPersistProbe(role, requesterToken, "invoice_request", makeInvoiceInsertPayload(randomUUID()))
  );
  probes.push(
    await allowInsertNoPersistProbe(
      role,
      requesterToken,
      "contractor_compensation_version",
      makeCompensationInsertPayload(randomUUID())
    )
  );
  probes.push(
    await allowInsertNoPersistProbe(role, requesterToken, "contractor_payable", makePayableInsertPayload(randomUUID()))
  );
  probes.push(
    await allowInsertNoPersistProbe(
      role,
      requesterToken,
      "job_profitability_snapshot",
      makeProfitabilityInsertPayload(randomUUID())
    )
  );
  probes.push(
    await denyInsertProbe(role, requesterToken, "accounting_sync_outbox", makeOutboxInsertPayload(randomUUID()))
  );
  probes.push(
    await denyPatchProbe(role, requesterToken, "accounting_sync_outbox", CANONICAL.accounting_sync_outbox_id)
  );
  probes.push(
    await denyInsertProbe(role, requesterToken, "payment_observation", makePaymentInsertPayload(randomUUID()))
  );
  probes.push(
    await denyPatchProbe(role, requesterToken, "payment_observation", CANONICAL.payment_observation_id)
  );
  return probes;
}

async function probeOfficeOps(token) {
  const role = "office_ops";
  const probes = [];
  probes.push(
    await selectExactRowProbe(role, token, "billing_readiness_gate", CANONICAL.billing_readiness_gate_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "invoice_request", CANONICAL.invoice_request_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "accounting_sync_outbox", CANONICAL.accounting_sync_outbox_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "payment_observation", CANONICAL.payment_observation_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "job_profitability_snapshot", CANONICAL.job_profitability_snapshot_id)
  );
  probes.push(
    await allowInsertNoPersistProbe(role, token, "billing_readiness_gate", makeBrgInsertPayload(randomUUID()))
  );
  probes.push(
    await allowInsertNoPersistProbe(role, token, "invoice_request", makeInvoiceInsertPayload(randomUUID()))
  );
  probes.push(
    await scopedMismatchSelectProbe(
      role,
      token,
      "billing_readiness_gate",
      CANONICAL.billing_readiness_gate_id,
      "business_unit_id",
      randomUUID()
    )
  );
  probes.push(
    await scopedMismatchSelectProbe(
      role,
      token,
      "billing_readiness_gate",
      CANONICAL.billing_readiness_gate_id,
      "organization_id",
      randomUUID()
    )
  );
  probes.push(
    await denyPatchProbe(role, token, "billing_readiness_gate", CANONICAL.billing_readiness_gate_id)
  );
  probes.push(
    await denyPatchProbe(role, token, "invoice_request", CANONICAL.invoice_request_id)
  );
  probes.push(
    await denyInsertProbe(role, token, "accounting_sync_outbox", makeOutboxInsertPayload(randomUUID()))
  );
  probes.push(
    await denyPatchProbe(role, token, "accounting_sync_outbox", CANONICAL.accounting_sync_outbox_id)
  );
  probes.push(
    await denyInsertProbe(role, token, "payment_observation", makePaymentInsertPayload(randomUUID()))
  );
  probes.push(
    await denyPatchProbe(role, token, "payment_observation", CANONICAL.payment_observation_id)
  );
  probes.push(
    await selectExactRowProbe(
      role,
      token,
      "contractor_compensation_version",
      CANONICAL.contractor_compensation_version_id,
      "deny"
    )
  );
  probes.push(
    await denyInsertProbe(
      role,
      token,
      "contractor_compensation_version",
      makeCompensationInsertPayload(randomUUID())
    )
  );
  probes.push(
    await denyPatchProbe(
      role,
      token,
      "contractor_compensation_version",
      CANONICAL.contractor_compensation_version_id
    )
  );
  probes.push(
    await selectExactRowProbe(role, token, "contractor_payable", CANONICAL.contractor_payable_id, "deny")
  );
  probes.push(
    await denyInsertProbe(role, token, "contractor_payable", makePayableInsertPayload(randomUUID()))
  );
  probes.push(
    await denyPatchProbe(role, token, "contractor_payable", CANONICAL.contractor_payable_id)
  );
  probes.push(
    await denyInsertProbe(
      role,
      token,
      "job_profitability_snapshot",
      makeProfitabilityInsertPayload(randomUUID())
    )
  );
  probes.push(
    await denyPatchProbe(role, token, "job_profitability_snapshot", CANONICAL.job_profitability_snapshot_id)
  );
  return probes;
}

async function probeWorker(token, otherWorkerEvidence) {
  const role = "worker";
  const probes = [];
  probes.push(
    await selectExactRowProbe(
      role,
      token,
      "contractor_compensation_version",
      CANONICAL.contractor_compensation_version_id,
      "allow",
      { worker_id: CANONICAL.worker_id }
    )
  );
  probes.push(
    await selectExactRowProbe(
      role,
      token,
      "contractor_payable",
      CANONICAL.contractor_payable_id,
      "allow",
      { worker_id: CANONICAL.worker_id }
    )
  );
  probes.push(
    await denyInsertProbe(role, token, "contractor_compensation_version", makeCompensationInsertPayload(randomUUID()))
  );
  probes.push(
    await denyPatchProbe(role, token, "contractor_compensation_version", CANONICAL.contractor_compensation_version_id)
  );
  probes.push(
    await denyInsertProbe(role, token, "contractor_payable", makePayableInsertPayload(randomUUID()))
  );
  probes.push(
    await denyPatchProbe(role, token, "contractor_payable", CANONICAL.contractor_payable_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "billing_readiness_gate", CANONICAL.billing_readiness_gate_id, "deny")
  );
  probes.push(
    await denyPatchProbe(role, token, "billing_readiness_gate", CANONICAL.billing_readiness_gate_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "invoice_request", CANONICAL.invoice_request_id, "deny")
  );
  probes.push(
    await denyPatchProbe(role, token, "invoice_request", CANONICAL.invoice_request_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "accounting_sync_outbox", CANONICAL.accounting_sync_outbox_id, "deny")
  );
  probes.push(
    await denyPatchProbe(role, token, "accounting_sync_outbox", CANONICAL.accounting_sync_outbox_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "payment_observation", CANONICAL.payment_observation_id, "deny")
  );
  probes.push(
    await denyPatchProbe(role, token, "payment_observation", CANONICAL.payment_observation_id)
  );
  probes.push(
    await selectExactRowProbe(role, token, "job_profitability_snapshot", CANONICAL.job_profitability_snapshot_id, "deny")
  );
  probes.push(
    await denyPatchProbe(role, token, "job_profitability_snapshot", CANONICAL.job_profitability_snapshot_id)
  );
  if (otherWorkerEvidence?.compensation?.id) {
    probes.push(
      await selectExactRowProbe(
        role,
        token,
        "contractor_compensation_version",
        otherWorkerEvidence.compensation.id,
        "deny"
      )
    );
  } else {
    probes.push(
      buildProbe({
        role,
        operation: "SELECT contractor_compensation_version (another worker row if any exist)",
        table: "contractor_compensation_version",
        expected: "deny",
        mandatory: false,
        classification: CLASSIFICATION.NOT_PROVEN,
        note: "No distinct contractor_compensation_version for another worker was discoverable for cross-worker visibility proof",
      })
    );
  }
  if (otherWorkerEvidence?.payable?.id) {
    probes.push(
      await selectExactRowProbe(role, token, "contractor_payable", otherWorkerEvidence.payable.id, "deny")
    );
  } else {
    probes.push(
      buildProbe({
        role,
        operation: "SELECT contractor_payable (another worker row if any exist)",
        table: "contractor_payable",
        expected: "deny",
        mandatory: false,
        classification: CLASSIFICATION.NOT_PROVEN,
        note: "No distinct contractor_payable for another worker was discoverable for cross-worker visibility proof",
      })
    );
  }
  return probes;
}

async function probeQa(token) {
  const role = "qa";
  const probes = [];
  for (const [table, id] of RETAINED_TABLES) {
    probes.push(await selectExactRowProbe(role, token, table, id, "deny"));
  }
  probes.push(await denyInsertProbe(role, token, "billing_readiness_gate", makeBrgInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, token, "billing_readiness_gate", CANONICAL.billing_readiness_gate_id));
  probes.push(await denyInsertProbe(role, token, "invoice_request", makeInvoiceInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, token, "invoice_request", CANONICAL.invoice_request_id));
  probes.push(await denyInsertProbe(role, token, "accounting_sync_outbox", makeOutboxInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, token, "accounting_sync_outbox", CANONICAL.accounting_sync_outbox_id));
  probes.push(await denyInsertProbe(role, token, "payment_observation", makePaymentInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, token, "payment_observation", CANONICAL.payment_observation_id));
  probes.push(await denyInsertProbe(role, token, "contractor_compensation_version", makeCompensationInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, token, "contractor_compensation_version", CANONICAL.contractor_compensation_version_id));
  probes.push(await denyInsertProbe(role, token, "contractor_payable", makePayableInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, token, "contractor_payable", CANONICAL.contractor_payable_id));
  probes.push(await denyInsertProbe(role, token, "job_profitability_snapshot", makeProfitabilityInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, token, "job_profitability_snapshot", CANONICAL.job_profitability_snapshot_id));
  return probes;
}

async function probeAnon() {
  const role = "anon";
  const probes = [];
  for (const [table, id] of RETAINED_TABLES) {
    probes.push(await selectExactRowProbe(role, null, table, id, "deny"));
  }
  probes.push(await denyInsertProbe(role, null, "billing_readiness_gate", makeBrgInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, null, "billing_readiness_gate", CANONICAL.billing_readiness_gate_id));
  probes.push(await denyInsertProbe(role, null, "invoice_request", makeInvoiceInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, null, "invoice_request", CANONICAL.invoice_request_id));
  probes.push(await denyInsertProbe(role, null, "accounting_sync_outbox", makeOutboxInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, null, "accounting_sync_outbox", CANONICAL.accounting_sync_outbox_id));
  probes.push(await denyInsertProbe(role, null, "payment_observation", makePaymentInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, null, "payment_observation", CANONICAL.payment_observation_id));
  probes.push(await denyInsertProbe(role, null, "contractor_compensation_version", makeCompensationInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, null, "contractor_compensation_version", CANONICAL.contractor_compensation_version_id));
  probes.push(await denyInsertProbe(role, null, "contractor_payable", makePayableInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, null, "contractor_payable", CANONICAL.contractor_payable_id));
  probes.push(await denyInsertProbe(role, null, "job_profitability_snapshot", makeProfitabilityInsertPayload(randomUUID())));
  probes.push(await denyPatchProbe(role, null, "job_profitability_snapshot", CANONICAL.job_profitability_snapshot_id));
  return probes;
}

export async function runWave5RlsAcceptanceHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", contract_version: CONTRACT_VERSION });
  }
  if (!isHarnessEnabled()) {
    return res.status(403).json({
      error: "Wave 5 RLS acceptance harness is disabled. Set SERVICEOS_W5_RLS_HARNESS_ENABLED=true in Preview/test environment to enable.",
      contract_version: CONTRACT_VERSION,
    });
  }
  const env = getEnvironment();
  if (!env) {
    return res.status(403).json({
      error: "Wave 5 RLS acceptance harness is PROHIBITED in Production or when SERVICEOS_ENVIRONMENT is missing/unknown. This harness requires SERVICEOS_ENVIRONMENT=preview or SERVICEOS_ENVIRONMENT=test.",
      contract_version: CONTRACT_VERSION,
    });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(503).json({
      error: "SUPABASE_URL and SUPABASE_ANON_KEY are required.",
      contract_version: CONTRACT_VERSION,
    });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({
      error: "SUPABASE_SERVICE_ROLE_KEY is required for authoritative retained-data integrity verification.",
      contract_version: CONTRACT_VERSION,
    });
  }

  const runAt = new Date().toISOString();
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return res.status(401).json({
      error: "Authorization: ****** is required",
      contract_version: CONTRACT_VERSION,
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (error) {
    return res.status(400).json({
      error: "Request body must be valid JSON",
      detail: error.message,
      contract_version: CONTRACT_VERSION,
    });
  }
  const requestedJobId = String(body.operational_job_id || "").trim();
  if (requestedJobId && requestedJobId !== CANONICAL.operational_job_id) {
    return res.status(400).json({
      error: "operational_job_id does not match the retained Wave 5 acceptance scope",
      canonical_job_id: CANONICAL.operational_job_id,
      contract_version: CONTRACT_VERSION,
    });
  }

  // ── Verify requester is owner_admin ─────────────────────────────────────────
  let authUser;
  let appUser;
  let hucOrganization;
  let membership;
  try {
    authUser = await loadAuthenticatedAuthUser(bearerToken);
    appUser = await loadActiveAppUser(bearerToken, authUser.id);
    hucOrganization = await loadHucOrganization(bearerToken);
    membership = await loadActiveOwnerAdminMembership(bearerToken, appUser.id, hucOrganization.id);
  } catch (error) {
    return res.status(error.status === 401 ? 401 : 403).json({
      error: "Wave 5 harness requester authorization failed",
      detail: error.message,
      contract_version: CONTRACT_VERSION,
      canonical_job_id: CANONICAL.operational_job_id,
      environment: env,
      run_at: runAt,
    });
  }

  // ── A: Collect all credential candidates ───────────────────────────────────
  const candidates = collectAllCredentialCandidates();

  if (candidates.length === 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "ROLE_IDENTITY_CONFIGURATION_BLOCKER: No non-owner role credentials found. Configure SERVICEOS_W5_RLS_* or SERVICEOS_W4_RLS_* env vars.",
      missing_identities: ["office_ops", "worker", "qa"],
      required_env_vars: [
        "SERVICEOS_W5_RLS_OFFICE_OPS_EMAIL", "SERVICEOS_W5_RLS_OFFICE_OPS_PASSWORD",
        "SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL", "SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD",
        "SERVICEOS_W5_RLS_WORKER_EMAIL",     "SERVICEOS_W5_RLS_WORKER_PASSWORD",
        "SERVICEOS_W4_RLS_WORKER_EMAIL",     "SERVICEOS_W4_RLS_WORKER_PASSWORD",
        "SERVICEOS_W5_RLS_QA_EMAIL",         "SERVICEOS_W5_RLS_QA_PASSWORD",
        "SERVICEOS_W4_RLS_QA_EMAIL",         "SERVICEOS_W4_RLS_QA_PASSWORD",
      ],
      canonical_job_id: CANONICAL.operational_job_id,
      environment: env,
      run_at: runAt,
    });
  }

  // ── Authenticate each unique candidate ─────────────────────────────────────
  const tokensByLabel = new Map(); // env_label → token
  const authErrors = {};
  for (const cred of candidates) {
    try {
      const token = await signInWithPassword(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        cred.email,
        cred.password
      );
      tokensByLabel.set(cred.env_label, token);
    } catch (error) {
      authErrors[cred.env_label] = { code: error.code, message: error.message };
    }
  }
  if (Object.keys(authErrors).length > 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "ROLE_IDENTITY_CONFIGURATION_BLOCKER: Authentication failed for one or more role credential candidates.",
      auth_errors: Object.fromEntries(
        Object.entries(authErrors).map(([label, err]) => [label, { code: err.code, message: err.message }])
      ),
      canonical_job_id: CANONICAL.operational_job_id,
      environment: env,
      run_at: runAt,
    });
  }

  // ── B: Resolve actual identity of each authenticated token ──────────────────
  const identities = new Map(); // token → {auth_user_id, app_user_id, active_role_codes, worker_id}
  const identityErrors = {};
  for (const cred of candidates) {
    const token = tokensByLabel.get(cred.env_label);
    if (!token) continue;
    if (identities.has(token)) continue; // deduplicated tokens
    try {
      const identity = await resolveTokenIdentity(token, bearerToken);
      identities.set(token, identity);
    } catch (error) {
      identityErrors[cred.env_label] = error.message;
    }
  }
  if (Object.keys(identityErrors).length > 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "ROLE_IDENTITY_CONFIGURATION_BLOCKER: Failed to resolve identity for one or more authenticated candidates.",
      identity_errors: identityErrors,
      canonical_job_id: CANONICAL.operational_job_id,
      environment: env,
      run_at: runAt,
    });
  }

  // ── C/D: Map tokens by canonical identity, fail-closed on duplicates/missing ─
  const identityAudit = buildIdentityAudit({ candidates, identities, tokensByLabel });

  if (identityAudit.duplicate_resolutions.length > 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "ROLE_IDENTITY_CONFIGURATION_BLOCKER: Two or more credential candidates resolve to the same canonical app_user.",
      duplicate_app_user_ids: identityAudit.duplicate_resolutions,
      identity_audit: identityAudit,
      canonical_job_id: CANONICAL.operational_job_id,
      environment: env,
      run_at: runAt,
    });
  }

  const missingCanonicalRoles = Object.entries(CANONICAL_APP_USERS)
    .filter(([role]) => {
      const audit = identityAudit[role];
      return !audit || audit.actual_app_user_id == null;
    })
    .map(([role]) => role);

  if (missingCanonicalRoles.length > 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "ROLE_IDENTITY_CONFIGURATION_BLOCKER: One or more expected canonical role identities could not be resolved from the provided credentials.",
      missing_canonical_roles: missingCanonicalRoles,
      identity_audit: identityAudit,
      canonical_job_id: CANONICAL.operational_job_id,
      environment: env,
      run_at: runAt,
    });
  }

  // ── E: Verify role/privilege requirements before probes ────────────────────
  const identityAuditFailed = ["office_ops", "worker", "qa"].filter(
    (role) => !identityAudit[role]?.passed
  );
  if (identityAuditFailed.length > 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "ROLE_IDENTITY_CONFIGURATION_BLOCKER: Identity audit failed for one or more canonical roles. Check privilege_contamination and worker_link_valid fields.",
      identity_audit_failed_roles: identityAuditFailed,
      identity_audit: identityAudit,
      canonical_job_id: CANONICAL.operational_job_id,
      environment: env,
      run_at: runAt,
    });
  }

  // Build the normalized token map (tokens keyed by canonical role)
  const normalizedTokens = resolveNormalizedTokenMap(candidates, identities, tokensByLabel);

  // ── G: Sequential probe execution with per-role retained snapshot ───────────
  const beforeSnapshots = await captureRetainedSnapshots();
  const otherWorkerEvidence = await discoverOtherWorkerEvidence();

  // 1. owner_admin
  const ownerAdminProbes = await probeOwnerAdmin(bearerToken);
  const afterOwnerAdmin = await captureRetainedSnapshots();
  const retainedAfterOwnerAdmin = compareRetainedSnapshots(beforeSnapshots, afterOwnerAdmin);
  if (!retainedAfterOwnerAdmin.unchanged) {
    const owner_admin = summarizeProbes("owner_admin", ownerAdminProbes);
    const passed = false;
    console.warn("wave5_rls_acceptance_failed", {
      failed_roles: ["owner_admin"],
      failed_count: owner_admin.failed_count,
      not_proven_count: owner_admin.not_proven_count,
      retained_data_unchanged: false,
      identity_audit_summary: { office_ops: "pass", worker: "pass", qa: "pass" },
      failed_probe_summary: [],
    });
    return res.status(422).json({
      contract_version: CONTRACT_VERSION,
      environment: env,
      canonical_job_id: CANONICAL.operational_job_id,
      error: "Retained data changed after owner_admin probes; aborting.",
      retained_data_drift_tables: retainedAfterOwnerAdmin.drift_tables,
      identity_audit: identityAudit,
      owner_admin,
      passed,
      run_at: runAt,
    });
  }

  // 2. office_ops
  const officeOpsProbes = await probeOfficeOps(normalizedTokens.office_ops);
  const afterOfficeOps = await captureRetainedSnapshots();
  const retainedAfterOfficeOps = compareRetainedSnapshots(beforeSnapshots, afterOfficeOps);
  if (!retainedAfterOfficeOps.unchanged) {
    const owner_admin = summarizeProbes("owner_admin", ownerAdminProbes);
    const office_ops = summarizeProbes("office_ops", officeOpsProbes);
    const passed = false;
    console.warn("wave5_rls_acceptance_failed", {
      failed_roles: ["office_ops"],
      failed_count: office_ops.failed_count,
      not_proven_count: office_ops.not_proven_count,
      retained_data_unchanged: false,
      identity_audit_summary: { office_ops: "pass", worker: "pass", qa: "pass" },
      failed_probe_summary: [],
    });
    return res.status(422).json({
      contract_version: CONTRACT_VERSION,
      environment: env,
      canonical_job_id: CANONICAL.operational_job_id,
      error: "Retained data changed after office_ops probes; aborting.",
      retained_data_drift_tables: retainedAfterOfficeOps.drift_tables,
      identity_audit: identityAudit,
      owner_admin,
      office_ops,
      passed,
      run_at: runAt,
    });
  }

  // 3. worker
  const workerProbes = await probeWorker(normalizedTokens.worker, otherWorkerEvidence);
  const afterWorker = await captureRetainedSnapshots();
  const retainedAfterWorker = compareRetainedSnapshots(beforeSnapshots, afterWorker);
  if (!retainedAfterWorker.unchanged) {
    const owner_admin = summarizeProbes("owner_admin", ownerAdminProbes);
    const office_ops = summarizeProbes("office_ops", officeOpsProbes);
    const worker = summarizeProbes("worker", workerProbes);
    const passed = false;
    console.warn("wave5_rls_acceptance_failed", {
      failed_roles: ["worker"],
      failed_count: worker.failed_count,
      not_proven_count: worker.not_proven_count,
      retained_data_unchanged: false,
      identity_audit_summary: { office_ops: "pass", worker: "pass", qa: "pass" },
      failed_probe_summary: [],
    });
    return res.status(422).json({
      contract_version: CONTRACT_VERSION,
      environment: env,
      canonical_job_id: CANONICAL.operational_job_id,
      error: "Retained data changed after worker probes; aborting.",
      retained_data_drift_tables: retainedAfterWorker.drift_tables,
      identity_audit: identityAudit,
      owner_admin,
      office_ops,
      worker,
      passed,
      run_at: runAt,
    });
  }

  // 4. qa
  const qaProbes = await probeQa(normalizedTokens.qa);
  const afterQa = await captureRetainedSnapshots();
  const retainedAfterQa = compareRetainedSnapshots(beforeSnapshots, afterQa);
  if (!retainedAfterQa.unchanged) {
    const owner_admin = summarizeProbes("owner_admin", ownerAdminProbes);
    const office_ops = summarizeProbes("office_ops", officeOpsProbes);
    const worker = summarizeProbes("worker", workerProbes);
    const qa = summarizeProbes("qa", qaProbes);
    const passed = false;
    console.warn("wave5_rls_acceptance_failed", {
      failed_roles: ["qa"],
      failed_count: qa.failed_count,
      not_proven_count: qa.not_proven_count,
      retained_data_unchanged: false,
      identity_audit_summary: { office_ops: "pass", worker: "pass", qa: "pass" },
      failed_probe_summary: [],
    });
    return res.status(422).json({
      contract_version: CONTRACT_VERSION,
      environment: env,
      canonical_job_id: CANONICAL.operational_job_id,
      error: "Retained data changed after qa probes; aborting.",
      retained_data_drift_tables: retainedAfterQa.drift_tables,
      identity_audit: identityAudit,
      owner_admin,
      office_ops,
      worker,
      qa,
      passed,
      run_at: runAt,
    });
  }

  // 5. anon
  const anonProbes = await probeAnon();
  const afterAnon = await captureRetainedSnapshots();
  const retainedIntegrity = compareRetainedSnapshots(beforeSnapshots, afterAnon);

  // ── Summarize ───────────────────────────────────────────────────────────────
  const owner_admin = summarizeProbes("owner_admin", ownerAdminProbes);
  const office_ops = summarizeProbes("office_ops", officeOpsProbes);
  const worker = summarizeProbes("worker", workerProbes);
  const qa = summarizeProbes("qa", qaProbes);
  const anon = summarizeProbes("anon", anonProbes);

  const sections = [owner_admin, office_ops, worker, qa, anon];
  const mandatoryProbeCount = sections.reduce(
    (sum, section) => sum + section.probes.filter((probe) => probe.mandatory).length,
    0
  );
  const provenCount = sections.reduce((sum, section) => sum + section.proven_count, 0);
  const failedCount = sections.reduce((sum, section) => sum + section.failed_count, 0);
  const notProvenCount = sections.reduce((sum, section) => sum + section.not_proven_count, 0);
  const passed =
    sections.every((section) => section.passed) &&
    retainedIntegrity.unchanged &&
    failedCount === 0 &&
    identityAudit.office_ops.passed &&
    identityAudit.worker.passed &&
    identityAudit.qa.passed;

  // ── K: Concise failure summary ─────────────────────────────────────────────
  const failedMandatoryProbes = sections.flatMap((section) =>
    section.probes
      .filter((probe) => probe.mandatory && !probe.pass)
      .map((probe) => ({
        role: probe.role,
        operation: probe.operation,
        table: probe.table,
        expected: probe.expected,
        classification: probe.classification,
        actual_status: probe.actual_status,
        note: probe.note || null,
      }))
  );

  const identityAuditSummary = {
    office_ops: identityAudit.office_ops.passed ? "pass" : "fail",
    worker: identityAudit.worker.passed ? "pass" : "fail",
    qa: identityAudit.qa.passed ? "pass" : "fail",
  };

  if (!passed) {
    console.warn("wave5_rls_acceptance_failed", {
      failed_roles: sections.filter((s) => !s.passed).map((s) => s.role),
      failed_count: failedCount,
      not_proven_count: notProvenCount,
      retained_data_unchanged: retainedIntegrity.unchanged,
      identity_audit_summary: identityAuditSummary,
      failed_probe_summary: failedMandatoryProbes.map((p) => ({
        role: p.role,
        operation: p.operation,
        table: p.table,
        expected: p.expected,
        classification: p.classification,
        actual_status: p.actual_status,
      })),
    });
  }

  return res.status(passed ? 200 : 422).json({
    contract_version: CONTRACT_VERSION,
    environment: env,
    canonical_job_id: CANONICAL.operational_job_id,
    identity_audit: identityAudit,
    identity_audit_summary: identityAuditSummary,
    owner_admin,
    office_ops,
    worker,
    qa,
    anon,
    failed_mandatory_probes: failedMandatoryProbes,
    retained_data_unchanged: retainedIntegrity.unchanged,
    retained_data_drift_tables: retainedIntegrity.drift_tables,
    mandatory_probe_count: mandatoryProbeCount,
    proven_count: provenCount,
    failed_count: failedCount,
    not_proven_count: notProvenCount,
    missing_identities: [],
    requester: {
      auth_user_id: authUser.id,
      app_user_id: appUser.id,
      owner_admin_membership_id: membership.id,
      organization_id: hucOrganization.id,
    },
    credential_sources: {
      office_ops: identityAudit.office_ops.credential_source,
      worker: identityAudit.worker.credential_source,
      qa: identityAudit.qa.credential_source,
    },
    passed,
    run_at: runAt,
    notes: [
      "No auth users were created.",
      "No retained Wave 5 evidence was intentionally mutated or cleaned up.",
      "Owner_admin probes used the requesting browser bearer token; office_ops / worker / qa tokens were resolved by canonical app_user_id.",
      "Service role was used only for authoritative before/after integrity verification and optional cross-worker discovery.",
      "Role probes ran sequentially with retained-data integrity verification between each role.",
    ],
  });
}

export { classifyDenyPatchProbe, classifyDenyMutationProbe };
export default runWave5RlsAcceptanceHandler;
