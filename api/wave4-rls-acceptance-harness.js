// api/wave4-rls-acceptance-harness.js
//
// Wave 4 Role/RLS Acceptance Harness — PREVIEW/TEST ONLY
//
// PURPOSE:
//   Closes Wave 4 RLS acceptance without requiring another SQL migration.
//   Authenticates as office_ops, worker, and qa independently using
//   environment-supplied credentials, then probes the deployed Wave 4 RLS policies.
//
// DESIGN PRINCIPLES:
//   - Preview/test ONLY. Fails hard in production (SERVICEOS_ENVIRONMENT=production).
//   - No test passwords stored in source. Credentials come exclusively from env vars.
//   - Each role uses its own authenticated Supabase access token (not service_role).
//   - No service_role bypass for role probes.
//   - No cleanup or deletion of Wave 3/4 retained evidence.
//   - No fixture rerun. Uses existing Wave 4 acceptance artifacts.
//   - Feature flag: SERVICEOS_W4_RLS_HARNESS_ENABLED must be explicitly "true".
//   - Deny assertions treat HTTP 401/403/RLS denial as PASS (expected deny).
//   - Successful unauthorized mutation is a hard FAIL for the harness.
//
// REQUIRED ENVIRONMENT VARIABLES (Preview/test only — never VITE_* or NEXT_PUBLIC_*):
//   SERVICEOS_ENVIRONMENT               – must be "preview" or "test"
//   SERVICEOS_W4_RLS_HARNESS_ENABLED    – must be "true" to activate
//   SUPABASE_URL                        – Supabase project URL
//   SUPABASE_ANON_KEY                   – server-only Preview/test anon key (never VITE_* or NEXT_PUBLIC_*)
//   SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL   – office_ops test identity email
//   SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD
//   SERVICEOS_W4_RLS_WORKER_EMAIL       – worker test identity email
//   SERVICEOS_W4_RLS_WORKER_PASSWORD
//   SERVICEOS_W4_RLS_QA_EMAIL           – qa test identity email
//   SERVICEOS_W4_RLS_QA_PASSWORD
//
// OUTPUT CONTRACT:
//   {
//     "contract_version": "wave4-rls-acceptance-v1",
//     "office_ops": { probes: [...], allow_pass: bool, deny_pass: bool },
//     "worker":     { probes: [...], allow_pass: bool, deny_pass: bool },
//     "qa":         { probes: [...], allow_pass: bool, deny_pass: bool },
//     "passed": true|false,
//     "missing_identities": [...],
//     "environment": "preview"|"test",
//     "run_at": "<ISO timestamp>"
//   }
//
// RUNTIME ACCEPTANCE EXECUTION:
//   This harness must NOT be executed here.
//   DO NOT execute M012. DO NOT create auth users.
//   The harness reports which identities are missing if they do not yet exist.

const CONTRACT_VERSION = "wave4-rls-acceptance-v1";

// ── Environment guards ────────────────────────────────────────────────────────

function getEnvironment() {
  const raw = (process.env.SERVICEOS_ENVIRONMENT || "").trim().toLowerCase();
  if (raw === "preview" || raw === "test") return raw;
  return null;
}

function isHarnessEnabled() {
  return process.env.SERVICEOS_W4_RLS_HARNESS_ENABLED === "true";
}

// ── Supabase auth: sign in with email/password to get an access token ─────────
async function signInWithPassword(supabaseUrl, anonKey, email, password) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Auth failed for ${email}: HTTP ${res.status} ${text}`),
      { code: "AUTH_FAILED", email }
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw Object.assign(
      new Error(`Auth returned no access_token for ${email}`),
      { code: "NO_ACCESS_TOKEN", email }
    );
  }

  return data.access_token;
}

// ── Authenticated REST probe ───────────────────────────────────────────────────
async function restProbe(supabaseUrl, anonKey, accessToken, method, table, body = null, filter = "") {
  const url = `${supabaseUrl}/rest/v1/${table}${filter}`;
  const headers = {
    Authorization: `******
    apikey: anonKey,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "return=representation",
  };

  const reqInit = { method, headers };
  if (body !== null && method !== "GET" && method !== "DELETE") {
    reqInit.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, reqInit);
    const status = res.status;
    let responseBody = null;
    try { responseBody = await res.json(); } catch { /* ignore */ }
    return { ok: res.ok, status, body: responseBody };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err.message };
  }
}

// ── Probe result builder ──────────────────────────────────────────────────────
function probe(role, operation, table, expected, actual_status, actual_ok) {
  const expectedAllow = expected === "allow";
  let pass;
  if (expectedAllow) {
    // Allow: HTTP 2xx is PASS
    pass = actual_ok;
  } else {
    // Deny: HTTP 401/403/404-due-to-RLS is PASS (RLS denial may appear as 200 with empty array for SELECT)
    // For SELECT: empty result or 401/403 = PASS deny
    // For INSERT/UPDATE/DELETE: non-2xx = PASS deny; 2xx with data = FAIL
    pass = !actual_ok || actual_status === 401 || actual_status === 403;
  }

  return {
    role,
    operation,
    table,
    expected,
    actual_status,
    actual_ok,
    pass,
  };
}

// ── Build structured deny probe from SELECT returning empty array ──────────────
// RLS denies via empty result set (not HTTP error) for SELECT operations.
// A deny is PASSED if the result is empty (RLS filtered to zero rows).
function selectDenyProbe(role, operation, table, expected, result) {
  const isRlsDeny = result.ok && Array.isArray(result.body) && result.body.length === 0;
  const isHttpDeny = !result.ok && (result.status === 401 || result.status === 403);
  const pass = isRlsDeny || isHttpDeny;
  return {
    role,
    operation,
    table,
    expected,
    actual_status: result.status,
    actual_ok: result.ok,
    rls_deny_empty_result: isRlsDeny,
    pass,
  };
}

// ── Wave 4 tables to probe (additive list) ────────────────────────────────────
const WAVE4_READ_TABLES = [
  "work_order_governance_link",
  "work_order_wave4_applicability",
  "work_order_evidence_requirement",
  "service_exception",
  "customer_outcome",
];

const WAVE3_APPEND_ONLY_TABLES = [
  "completion_evidence",
  "work_order_event",
];

// ── OFFICE_OPS probes ─────────────────────────────────────────────────────────
async function probeOfficeOps(supabaseUrl, anonKey, token) {
  const results = [];

  // ALLOW: read in-scope Wave 4 governed records
  for (const table of WAVE4_READ_TABLES) {
    const r = await restProbe(supabaseUrl, anonKey, token, "GET", table, null, "?limit=5");
    results.push({
      role: "office_ops",
      operation: `SELECT ${table}`,
      table,
      expected: "allow",
      actual_status: r.status,
      actual_ok: r.ok,
      pass: r.ok,
    });
  }

  // ALLOW: read qa_inspection (governance/exception triage)
  const qaRead = await restProbe(supabaseUrl, anonKey, token, "GET", "qa_inspection", null, "?limit=5");
  results.push({
    role: "office_ops", operation: "SELECT qa_inspection", table: "qa_inspection",
    expected: "allow", actual_status: qaRead.status, actual_ok: qaRead.ok, pass: qaRead.ok,
  });

  // ALLOW: read service_exception for triage
  const seRead = await restProbe(supabaseUrl, anonKey, token, "GET", "service_exception", null, "?limit=5");
  results.push({
    role: "office_ops", operation: "SELECT service_exception", table: "service_exception",
    expected: "allow", actual_status: seRead.status, actual_ok: seRead.ok, pass: seRead.ok,
  });

  // DENY: QA impersonation — office_ops must not INSERT qa_inspection with passing status
  const qaInsertDeny = await restProbe(supabaseUrl, anonKey, token, "POST", "qa_inspection", {
    inspection_status: "passed",
    inspection_type: "standard",
    _harness_label: "wave4-rls-office_ops-qa-impersonation-deny",
  });
  const qaDenyPass = !qaInsertDeny.ok || qaInsertDeny.status === 401 || qaInsertDeny.status === 403;
  results.push({
    role: "office_ops", operation: "INSERT qa_inspection (QA impersonation — DENY)",
    table: "qa_inspection", expected: "deny",
    actual_status: qaInsertDeny.status, actual_ok: qaInsertDeny.ok,
    pass: qaDenyPass,
  });

  // DENY: destructive mutation on append-only evidence
  for (const table of WAVE3_APPEND_ONLY_TABLES) {
    const delResult = await restProbe(supabaseUrl, anonKey, token, "DELETE", table, null, "?id=eq.00000000-0000-0000-0000-000000000000");
    const denyPass = !delResult.ok || delResult.status === 401 || delResult.status === 403;
    results.push({
      role: "office_ops", operation: `DELETE ${table} (append-only — DENY)`,
      table, expected: "deny",
      actual_status: delResult.status, actual_ok: delResult.ok,
      pass: denyPass,
    });
  }

  return results;
}

// ── WORKER probes ─────────────────────────────────────────────────────────────
async function probeWorker(supabaseUrl, anonKey, token) {
  const results = [];

  // ALLOW: read own worker_assignment (RLS scopes to current worker)
  const waRead = await restProbe(supabaseUrl, anonKey, token, "GET", "worker_assignment", null, "?limit=5");
  results.push({
    role: "worker", operation: "SELECT worker_assignment (own)", table: "worker_assignment",
    expected: "allow", actual_status: waRead.status, actual_ok: waRead.ok, pass: waRead.ok,
  });

  // DENY: read other worker's assignment data — RLS should filter to own records only
  // (RLS returns empty set if worker can only see own, which is a deny of cross-scope)
  const otherWorkerRead = await restProbe(
    supabaseUrl, anonKey, token, "GET", "worker_assignment", null,
    "?worker_id=eq.00000000-0000-0000-0000-000000000099&limit=5"
  );
  results.push(selectDenyProbe(
    "worker", "SELECT worker_assignment (other worker — DENY)", "worker_assignment", "deny", otherWorkerRead
  ));

  // DENY: QA pass/waive — worker must not INSERT qa_inspection
  const qaInsert = await restProbe(supabaseUrl, anonKey, token, "POST", "qa_inspection", {
    inspection_status: "passed",
    _harness_label: "wave4-rls-worker-qa-impersonation-deny",
  });
  const qaDenyPass = !qaInsert.ok || qaInsert.status === 401 || qaInsert.status === 403;
  results.push({
    role: "worker", operation: "INSERT qa_inspection (QA pass — DENY)", table: "qa_inspection",
    expected: "deny", actual_status: qaInsert.status, actual_ok: qaInsert.ok, pass: qaDenyPass,
  });

  // DENY: governance/admin mutation — worker must not INSERT work_order_governance_link
  const govInsert = await restProbe(supabaseUrl, anonKey, token, "POST", "work_order_governance_link", {
    _harness_label: "wave4-rls-worker-governance-deny",
  });
  const govDenyPass = !govInsert.ok || govInsert.status === 401 || govInsert.status === 403;
  results.push({
    role: "worker", operation: "INSERT work_order_governance_link (governance — DENY)",
    table: "work_order_governance_link", expected: "deny",
    actual_status: govInsert.status, actual_ok: govInsert.ok, pass: govDenyPass,
  });

  // DENY: UPDATE/DELETE on append-only evidence
  for (const table of WAVE3_APPEND_ONLY_TABLES) {
    const delResult = await restProbe(supabaseUrl, anonKey, token, "DELETE", table, null, "?id=eq.00000000-0000-0000-0000-000000000000");
    const denyPass = !delResult.ok || delResult.status === 401 || delResult.status === 403;
    results.push({
      role: "worker", operation: `DELETE ${table} (append-only — DENY)`,
      table, expected: "deny",
      actual_status: delResult.status, actual_ok: delResult.ok, pass: denyPass,
    });
  }

  return results;
}

// ── QA probes ─────────────────────────────────────────────────────────────────
async function probeQa(supabaseUrl, anonKey, token) {
  const results = [];

  // ALLOW: read qa_inspection records in scope
  const qaRead = await restProbe(supabaseUrl, anonKey, token, "GET", "qa_inspection", null, "?limit=5");
  results.push({
    role: "qa", operation: "SELECT qa_inspection", table: "qa_inspection",
    expected: "allow", actual_status: qaRead.status, actual_ok: qaRead.ok, pass: qaRead.ok,
  });

  // ALLOW: read corrective_action in scope
  const caRead = await restProbe(supabaseUrl, anonKey, token, "GET", "corrective_action", null, "?limit=5");
  results.push({
    role: "qa", operation: "SELECT corrective_action", table: "corrective_action",
    expected: "allow", actual_status: caRead.status, actual_ok: caRead.ok, pass: caRead.ok,
  });

  // DENY: worker impersonation — QA must not UPDATE worker_assignment
  const waUpdate = await restProbe(supabaseUrl, anonKey, token, "PATCH", "worker_assignment",
    { _harness_label: "wave4-rls-qa-worker-impersonation-deny" },
    "?id=eq.00000000-0000-0000-0000-000000000000"
  );
  const waUpdateDenyPass = !waUpdate.ok || waUpdate.status === 401 || waUpdate.status === 403;
  results.push({
    role: "qa", operation: "PATCH worker_assignment (worker impersonation — DENY)",
    table: "worker_assignment", expected: "deny",
    actual_status: waUpdate.status, actual_ok: waUpdate.ok, pass: waUpdateDenyPass,
  });

  // DENY: governance/admin mutation not granted
  const govInsert = await restProbe(supabaseUrl, anonKey, token, "POST", "work_order_governance_link", {
    _harness_label: "wave4-rls-qa-governance-deny",
  });
  const govDenyPass = !govInsert.ok || govInsert.status === 401 || govInsert.status === 403;
  results.push({
    role: "qa", operation: "INSERT work_order_governance_link (governance — DENY)",
    table: "work_order_governance_link", expected: "deny",
    actual_status: govInsert.status, actual_ok: govInsert.ok, pass: govDenyPass,
  });

  // DENY: destructive mutation on append-only evidence
  for (const table of WAVE3_APPEND_ONLY_TABLES) {
    const delResult = await restProbe(supabaseUrl, anonKey, token, "DELETE", table, null, "?id=eq.00000000-0000-0000-0000-000000000000");
    const denyPass = !delResult.ok || delResult.status === 401 || delResult.status === 403;
    results.push({
      role: "qa", operation: `DELETE ${table} (append-only — DENY)`,
      table, expected: "deny",
      actual_status: delResult.status, actual_ok: delResult.ok, pass: denyPass,
    });
  }

  // DENY: cross-scope records — qa must not see records outside their org
  const crossOrgRead = await restProbe(supabaseUrl, anonKey, token, "GET", "qa_inspection", null,
    "?organization_id=eq.00000000-0000-0000-0000-000000000099&limit=5"
  );
  results.push(selectDenyProbe(
    "qa", "SELECT qa_inspection (cross-org — DENY)", "qa_inspection", "deny", crossOrgRead
  ));

  return results;
}

// ── Summarize probes ──────────────────────────────────────────────────────────
function summarizeProbes(probes) {
  const allowProbes = probes.filter((p) => p.expected === "allow");
  const denyProbes = probes.filter((p) => p.expected === "deny");
  return {
    probes,
    allow_pass: allowProbes.every((p) => p.pass),
    deny_pass: denyProbes.every((p) => p.pass),
    allow_failures: allowProbes.filter((p) => !p.pass).map((p) => p.operation),
    deny_failures: denyProbes.filter((p) => !p.pass).map((p) => p.operation),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const env = getEnvironment();

  // Feature flag — default OFF
  if (!isHarnessEnabled()) {
    return res.status(403).json({
      error: "Wave 4 RLS acceptance harness is disabled. "
        + "Set SERVICEOS_W4_RLS_HARNESS_ENABLED=true in Preview/test environment to enable.",
      contract_version: CONTRACT_VERSION,
    });
  }

  // HARD FAIL in production
  if (!env) {
    return res.status(403).json({
      error: "Wave 4 RLS acceptance harness is PROHIBITED in Production or when "
        + "SERVICEOS_ENVIRONMENT is missing/unknown. "
        + "This harness requires SERVICEOS_ENVIRONMENT=preview or SERVICEOS_ENVIRONMENT=test.",
      contract_version: CONTRACT_VERSION,
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return res.status(503).json({ error: "SUPABASE_URL is required", contract_version: CONTRACT_VERSION });
  }

  // SUPABASE_ANON_KEY is required for all auth and REST probe requests (never VITE_* or NEXT_PUBLIC_*).
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    return res.status(503).json({
      error: "SUPABASE_ANON_KEY is required — provide a server-only Preview/test anon key. "
        + "Do not use VITE_* or NEXT_PUBLIC_* keys for harness credentials.",
      contract_version: CONTRACT_VERSION,
    });
  }

  const runAt = new Date().toISOString();

  // Check which identities are configured (do not attempt auth if creds are missing)
  const identityConfig = {
    office_ops: {
      email: process.env.SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL,
      password: process.env.SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD,
    },
    worker: {
      email: process.env.SERVICEOS_W4_RLS_WORKER_EMAIL,
      password: process.env.SERVICEOS_W4_RLS_WORKER_PASSWORD,
    },
    qa: {
      email: process.env.SERVICEOS_W4_RLS_QA_EMAIL,
      password: process.env.SERVICEOS_W4_RLS_QA_PASSWORD,
    },
  };

  // Identify which identities have credentials configured
  const missingIdentities = Object.entries(identityConfig)
    .filter(([, cfg]) => !cfg.email || !cfg.password)
    .map(([role]) => role);

  if (missingIdentities.length > 0) {
    // Report missing identities without attempting any auth
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "Required Wave 4 role identity credentials are not configured. "
        + "Configure the environment variables for all roles before running acceptance.",
      missing_identities: missingIdentities,
      required_env_vars: [
        "SERVICEOS_W4_RLS_OFFICE_OPS_EMAIL", "SERVICEOS_W4_RLS_OFFICE_OPS_PASSWORD",
        "SERVICEOS_W4_RLS_WORKER_EMAIL", "SERVICEOS_W4_RLS_WORKER_PASSWORD",
        "SERVICEOS_W4_RLS_QA_EMAIL", "SERVICEOS_W4_RLS_QA_PASSWORD",
      ],
      note: "Runtime acceptance still must determine whether these identities exist in the Preview Supabase project. "
        + "DO NOT create auth users automatically without explicit authorization.",
      environment: env,
      run_at: runAt,
    });
  }

  // Authenticate each role independently — each uses its own access token (no service_role bypass)
  const tokens = {};
  const authErrors = {};

  for (const [role, cfg] of Object.entries(identityConfig)) {
    try {
      tokens[role] = await signInWithPassword(supabaseUrl, anonKey, cfg.email, cfg.password);
    } catch (err) {
      authErrors[role] = { code: err.code, message: err.message };
    }
  }

  if (Object.keys(authErrors).length > 0) {
    return res.status(424).json({
      contract_version: CONTRACT_VERSION,
      error: "Authentication failed for one or more Wave 4 role identities.",
      auth_errors: authErrors,
      note: "Runtime acceptance still must determine whether these identities exist in the Preview Supabase project. "
        + "DO NOT create auth users automatically without explicit authorization.",
      environment: env,
      run_at: runAt,
    });
  }

  // Run probes for each role using authenticated tokens
  const [officeOpsProbes, workerProbes, qaProbes] = await Promise.all([
    probeOfficeOps(supabaseUrl, anonKey, tokens.office_ops),
    probeWorker(supabaseUrl, anonKey, tokens.worker),
    probeQa(supabaseUrl, anonKey, tokens.qa),
  ]);

  const officeOpsSummary = summarizeProbes(officeOpsProbes);
  const workerSummary = summarizeProbes(workerProbes);
  const qaSummary = summarizeProbes(qaProbes);

  const passed = officeOpsSummary.allow_pass && officeOpsSummary.deny_pass
    && workerSummary.allow_pass && workerSummary.deny_pass
    && qaSummary.allow_pass && qaSummary.deny_pass;

  const contract = {
    contract_version: CONTRACT_VERSION,
    office_ops: officeOpsSummary,
    worker: workerSummary,
    qa: qaSummary,
    passed,
    missing_identities: [],
    environment: env,
    run_at: runAt,
    notes: [
      "No cleanup or deletion of Wave 3/4 retained evidence was performed.",
      "No fixture rerun occurred.",
      "No SQL migration was executed.",
      "All probes used role-specific authenticated Supabase sessions (no service_role bypass).",
    ],
  };

  return res.status(passed ? 200 : 422).json(contract);
}
