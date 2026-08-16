// api/wave5-accounting-sync.js
//
// Wave 5: Server-side QuickBooks accounting sync provider adapter.
//
// ARCHITECTURE:
//   This is a governed INTERFACE boundary between ServiceOS and QuickBooks.
//   QuickBooks is the FORMAL ACCOUNTING LEDGER AUTHORITY.
//   This handler does NOT fabricate QuickBooks IDs.
//   It does NOT substitute Stripe as the accounting ledger.
//
// CANONICAL INPUT (A6):
//   Client MUST provide:
//     invoice_request_id  – stable reference to the canonical invoice record
//     idempotency_key     – stable idempotency identifier for this sync attempt
//
//   The server loads ALL monetary values (currency, subtotal, tax, total) and
//   operational_job_id from the canonical invoice_request row using the
//   Supabase service-role credential. Client-supplied monetary values are
//   IGNORED and REJECTED if present.
//
// IDEMPOTENCY (A7):
//   accounting_sync_outbox.idempotency_key is the durable canonical record.
//   Before creating a QBO invoice:
//     1. Resolve outbox by idempotency_key.
//     2. If acknowledged with provider_reference_id, return stored result.
//     3. Never issue a second live provider request after acknowledged state.
//
// ENVIRONMENT FAIL-CLOSED (A8):
//   Missing or unknown SERVICEOS_ENVIRONMENT causes hard failure.
//   Preview/test adapter ONLY when environment is explicitly "preview" or "test".
//   Production ONLY when explicitly "production".
//
// LIVE QUICKBOOKS PREREQUISITES:
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, QBO_REALM_ID, QBO_SANDBOX
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// IMPORTANT: This handler does NOT use the legacy placeholder accounting file.
// That file fabricates synthetic QB IDs at runtime and must not be used for
// canonical accounting.

import { createHash } from "node:crypto";

const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const QBO_PRODUCTION_BASE = "https://quickbooks.api.intuit.com/v3/company";

// A8: FAIL CLOSED — missing/unknown SERVICEOS_ENVIRONMENT returns null (caller must reject)
function getEnvironment() {
  const raw = (process.env.SERVICEOS_ENVIRONMENT || "").trim().toLowerCase();
  if (raw === "production" || raw === "preview" || raw === "test") return raw;
  return null; // unknown/missing — caller must fail closed
}

function hasLiveQBOCredentials() {
  return !!(
    process.env.QBO_CLIENT_ID &&
    process.env.QBO_CLIENT_SECRET &&
    process.env.QBO_REFRESH_TOKEN &&
    process.env.QBO_REALM_ID
  );
}

function hasSupabaseServiceCredentials() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function hasSupabaseAnonCredentials() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
  return match ? match[1].trim() : null;
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
    throw new Error(`Failed to validate ServiceOS bearer token: HTTP ${res.status} ${text}`);
  }

  const user = await res.json();
  if (!user?.id) {
    throw new Error("ServiceOS bearer token did not resolve to an auth user");
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

async function loadAuthorizedAppUser(accessToken, authUserId) {
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
    throw Object.assign(new Error("expected exactly one app_user for authenticated auth user"), { status: 403 });
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

async function loadAuthorizedMembershipContext(accessToken, appUserId, invoiceRequestId) {
  const roleRes = await authenticatedRestFetchPath(
    accessToken,
    "app_role?select=id,code&code=in.(owner_admin,office_ops)"
  );
  if (!roleRes.ok) {
    const text = await roleRes.text().catch(() => "");
    throw Object.assign(new Error(`role lookup failed: HTTP ${roleRes.status} ${text}`), { status: 403 });
  }

  const roles = await roleRes.json();
  const roleById = new Map(
    (Array.isArray(roles) ? roles : [])
      .filter((row) => row?.id && row?.code)
      .map((row) => [row.id, row.code])
  );
  const allowedRoleIds = [...roleById.keys()];
  if (allowedRoleIds.length === 0) {
    throw Object.assign(new Error("authorized finance roles are not visible"), { status: 403 });
  }

  const membershipsRes = await authenticatedRestFetchPath(
    accessToken,
    `user_membership?select=id,app_user_id,organization_id,business_unit_id,role_id,status&app_user_id=eq.${encodeURIComponent(appUserId)}&status=eq.active&role_id=in.(${allowedRoleIds.map((id) => encodeURIComponent(id)).join(",")})`
  );
  if (!membershipsRes.ok) {
    const text = await membershipsRes.text().catch(() => "");
    throw Object.assign(new Error(`user_membership lookup failed: HTTP ${membershipsRes.status} ${text}`), { status: 403 });
  }

  const memberships = await membershipsRes.json();
  const invoiceRes = await authenticatedRestFetchPath(
    accessToken,
    `invoice_request?select=id,organization_id,business_unit_id,request_status&id=eq.${encodeURIComponent(invoiceRequestId)}&limit=1`
  );
  if (!invoiceRes.ok) {
    const text = await invoiceRes.text().catch(() => "");
    throw Object.assign(new Error(`authorized invoice_request lookup failed: HTTP ${invoiceRes.status} ${text}`), { status: 403 });
  }

  const invoiceRows = await invoiceRes.json();
  const invoiceSummary = Array.isArray(invoiceRows) ? invoiceRows[0] ?? null : null;
  if (!invoiceSummary) {
    throw Object.assign(
      new Error("canonical invoice_request is not visible to an active owner_admin/office_ops membership in the same organization/business unit"),
      { status: 403 }
    );
  }

  const activeMemberships = Array.isArray(memberships) ? memberships : [];
  const matchingMembership = activeMemberships.find(
    (membership) =>
      membership.organization_id === invoiceSummary.organization_id &&
      (membership.business_unit_id == null ||
        membership.business_unit_id === invoiceSummary.business_unit_id) &&
      roleById.has(membership.role_id)
  );

  if (!matchingMembership) {
    throw Object.assign(
      new Error("active owner_admin/office_ops membership for the canonical invoice_request organization/business unit was not found"),
      { status: 403 }
    );
  }

  return {
    invoiceSummary,
    membership: matchingMembership,
    roleCode: roleById.get(matchingMembership.role_id) ?? null,
  };
}

// ── A6: Load canonical invoice_request from DB via service role ───────────────
async function loadCanonicalInvoiceRequest(invoiceRequestId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/invoice_request?id=eq.${encodeURIComponent(invoiceRequestId)}&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `******
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load invoice_request: HTTP ${res.status} ${text}`);
  }

  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error(`invoice_request ${invoiceRequestId} not found`);
  return row;
}

// ── A7: Resolve outbox by idempotency_key via service role ────────────────────
async function resolveOutboxByIdempotencyKey(idempotencyKey) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/accounting_sync_outbox?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `******
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

// ── A7: Persist outbox row via service role ───────────────────────────────────
async function upsertOutboxRow(payload) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(`${supabaseUrl}/rest/v1/accounting_sync_outbox`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `******
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to persist accounting_sync_outbox: HTTP ${res.status} ${text}`);
  }

  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

// ── A7: Update outbox status via service role ─────────────────────────────────
async function updateOutboxRow(id, patch) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/accounting_sync_outbox?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `******
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update accounting_sync_outbox: HTTP ${res.status} ${text}`);
  }

  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

function deriveQboRequestId(idempotencyKey) {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) throw new Error("deriveQboRequestId: idempotencyKey required");
  const digest = createHash("sha256").update(normalizedKey).digest("hex");
  return `serviceos-${digest.slice(0, 32)}`;
}

// ── QBO token refresh ─────────────────────────────────────────────────────────
async function refreshQBOAccessToken() {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const refreshToken = process.env.QBO_REFRESH_TOKEN;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QBO token refresh failed: HTTP ${res.status} ${text}`);
  }

  return res.json();
}

// ── QBO invoice creation ──────────────────────────────────────────────────────
async function createQBOInvoice(accessToken, realmId, invoicePayload, isSandbox, requestId) {
  const base = isSandbox ? QBO_SANDBOX_BASE : QBO_PRODUCTION_BASE;
  const url = new URL(`${base}/${realmId}/invoice`);
  // Intuit requestid provides provider-side duplicate-request protection for invoice creation.
  // This improves duplicate suppression, but does not eliminate the remaining provider/durability boundary.
  url.searchParams.set("requestid", requestId);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `******
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(invoicePayload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QBO invoice creation failed: HTTP ${res.status} ${text}`);
  }

  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // A8: FAIL CLOSED — reject unknown/missing environment
  const env = getEnvironment();
  if (!env) {
    return res.status(503).json({
      success: false,
      error: "SERVICEOS_ENVIRONMENT is not set or is not a recognized value. "
        + "Server finance provider code requires explicit environment: production | preview | test.",
      missing_prerequisites: ["SERVICEOS_ENVIRONMENT"],
    });
  }

  const isProduction = env === "production";
  const isPreviewOrTest = env === "preview" || env === "test";

  if (!hasSupabaseAnonCredentials()) {
    return res.status(503).json({
      success: false,
      error: "SUPABASE_URL and SUPABASE_ANON_KEY are required to validate the ServiceOS bearer token.",
      missing_prerequisites: ["SUPABASE_URL", "SUPABASE_ANON_KEY"].filter((k) => !process.env[k]),
    });
  }

  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return res.status(401).json({
      success: false,
      error: "Authorization: ****** is required",
    });
  }

  let authUser;
  try {
    authUser = await loadAuthenticatedAuthUser(bearerToken);
  } catch (authErr) {
    return res.status(401).json({
      success: false,
      error: "ServiceOS bearer token validation failed",
      detail: authErr.message,
    });
  }

  let body;
  try {
   body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (parseErr) {
   return res.status(400).json({
     success: false,
     error: "Request body must be valid JSON",
     detail: parseErr.message,
   });
  }

  // A6: Accept ONLY invoice_request_id and idempotency_key from client
  const { idempotency_key, invoice_request_id } = body;

  if (!idempotency_key || !String(idempotency_key).trim()) {
    return res.status(400).json({ success: false, error: "idempotency_key is required" });
  }
  if (!invoice_request_id) {
    return res.status(400).json({ success: false, error: "invoice_request_id is required" });
  }

  const canonicalKey = String(idempotency_key).trim();

  let appUser;
  let membershipContext;
  try {
    appUser = await loadAuthorizedAppUser(bearerToken, authUser.id);
    membershipContext = await loadAuthorizedMembershipContext(bearerToken, appUser.id, invoice_request_id);
  } catch (authzErr) {
    return res.status(authzErr.status === 403 ? 403 : 500).json({
      success: false,
      error: "ServiceOS finance authorization failed",
      detail: authzErr.message,
      invoice_request_id,
    });
  }

  // Supabase service credentials required to load canonical data
  if (!hasSupabaseServiceCredentials()) {
    return res.status(503).json({
      success: false,
      error: "Supabase service credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are required for canonical invoice loading.",
      missing_prerequisites: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]),
    });
  }

  // A7: Resolve outbox by idempotency_key — return stored result if already acknowledged
  let outboxRow = await resolveOutboxByIdempotencyKey(canonicalKey).catch(() => null);

  if (outboxRow && String(outboxRow.invoice_request_id) !== String(invoice_request_id)) {
    return res.status(409).json({
      success: false,
      error: "idempotency_key is already bound to a different invoice_request_id",
      idempotency_key: canonicalKey,
      invoice_request_id,
      existing_invoice_request_id: outboxRow.invoice_request_id,
      outbox_id: outboxRow.id ?? null,
    });
  }

  if (outboxRow && outboxRow.outbox_status === "acknowledged" && outboxRow.provider_reference_id) {
    // A7: Already acknowledged — return stored result without issuing another provider request
    return res.status(200).json({
      success: true,
      idempotent: true,
      outbox_id: outboxRow.id,
      is_test_adapter: outboxRow.is_test_adapter,
      provider: outboxRow.provider,
      provider_reference_id: outboxRow.provider_reference_id,
      provider_reference_type: outboxRow.provider_reference_type ?? null,
      idempotency_key: canonicalKey,
      invoice_request_id,
      acknowledged_at: outboxRow.acknowledged_at,
      environment: env,
    });
  }

  // A6: Load canonical invoice_request from DB (server-side only — never trust client monetary values)
  let invoiceRequest;
  try {
    invoiceRequest = await loadCanonicalInvoiceRequest(invoice_request_id);
  } catch (loadErr) {
    return res.status(400).json({
      success: false,
      error: "Cannot load canonical invoice_request from DB",
      detail: loadErr.message,
      invoice_request_id,
    });
  }

  if (
    invoiceRequest.organization_id !== membershipContext.invoiceSummary.organization_id ||
    invoiceRequest.business_unit_id !== membershipContext.invoiceSummary.business_unit_id
  ) {
    return res.status(403).json({
      success: false,
      error: "Canonical invoice_request authorization scope changed during resolution",
      invoice_request_id,
    });
  }

  if (invoiceRequest.request_status === "void" || invoiceRequest.request_status === "cancelled") {
    return res.status(400).json({
      success: false,
      error: `invoice_request is ${invoiceRequest.request_status} — cannot sync`,
      invoice_request_id,
    });
  }

  // A6: Derive ALL monetary values from canonical DB record
  const canonicalCurrency    = invoiceRequest.currency_code;
  const canonicalSubtotal    = Number(invoiceRequest.subtotal_amount);
  const canonicalTax         = Number(invoiceRequest.tax_amount);
  const canonicalTotal       = Number(invoiceRequest.total_amount);
  const canonicalJobId       = invoiceRequest.operational_job_id;
  const canonicalOrgId       = invoiceRequest.organization_id;
  const canonicalBuId        = invoiceRequest.business_unit_id;

  const liveCreds = hasLiveQBOCredentials();

  // ── Production guard: test adapter PROHIBITED ─────────────────────────────
  if (isProduction && !liveCreds) {
    return res.status(503).json({
      success: false,
      error: "QuickBooks accounting sync is not configured for Production.",
      missing_prerequisites: [
        "QBO_CLIENT_ID",
        "QBO_CLIENT_SECRET",
        "QBO_REFRESH_TOKEN",
        "QBO_REALM_ID",
      ].filter((k) => !process.env[k]),
      instructions:
        "Configure the required QuickBooks OAuth 2.0 credentials as Vercel environment variables before enabling Production accounting sync.",
    });
  }

  // ── Preview / test adapter path ───────────────────────────────────────────
  if (isPreviewOrTest && !liveCreds) {
    // A7: Persist through the same governed outbox flow — marked is_test_adapter=true, provider=preview_test
    const testReference = `PREVIEW-TEST-${canonicalKey.replace(/[^a-zA-Z0-9-]/g, "_")}`;
    const acknowledgedAt = new Date().toISOString();

    // Persist outbox row (server-side via service role)
    let persistedOutbox = outboxRow;
    if (!persistedOutbox) {
      try {
        persistedOutbox = await upsertOutboxRow({
          organization_id: canonicalOrgId,
          business_unit_id: canonicalBuId,
          invoice_request_id,
          idempotency_key: canonicalKey,
          provider: "preview_test",
          outbox_status: "acknowledged",
          is_test_adapter: true,
          provider_reference_id: testReference,
          provider_reference_type: "test_invoice_ref",
          response_payload: { adapter: "preview_test", reference: testReference },
          acknowledged_at: acknowledgedAt,
          attempt_count: 1,
          last_attempted_at: acknowledgedAt,
          request_payload: {
            invoice_request_id,
            operational_job_id: canonicalJobId,
            currency_code: canonicalCurrency,
            subtotal_amount: canonicalSubtotal,
            tax_amount: canonicalTax,
            total_amount: canonicalTotal,
          },
          metadata: {
            wave: "wave5",
            environment: env,
            source: "wave5-accounting-sync",
            requested_by_auth_user_id: authUser.id,
            requested_by_app_user_id: appUser.id,
            authorized_role: membershipContext.roleCode,
            authorized_membership_id: membershipContext.membership.id,
          },
        });
      } catch (persistErr) {
        return res.status(500).json({
          success: false,
          error: "Preview accounting sync could not persist accounting_sync_outbox",
          detail: persistErr.message,
          idempotency_key: canonicalKey,
          invoice_request_id,
        });
      }
    } else if (persistedOutbox.outbox_status !== "acknowledged" || !persistedOutbox.provider_reference_id) {
      try {
        persistedOutbox = await updateOutboxRow(persistedOutbox.id, {
          outbox_status: "acknowledged",
          is_test_adapter: true,
          provider: "preview_test",
          provider_reference_id: testReference,
          provider_reference_type: "test_invoice_ref",
          response_payload: { adapter: "preview_test", reference: testReference },
          acknowledged_at: acknowledgedAt,
          last_attempted_at: acknowledgedAt,
          attempt_count: Math.max(Number(persistedOutbox.attempt_count ?? 0), 0) + 1,
        });
      } catch (persistErr) {
        return res.status(500).json({
          success: false,
          error: "Preview accounting sync could not persist acknowledged outbox state",
          detail: persistErr.message,
          outbox_id: persistedOutbox.id ?? null,
          idempotency_key: canonicalKey,
          invoice_request_id,
        });
      }
    }

    if (!persistedOutbox?.id) {
      return res.status(500).json({
        success: false,
        error: "Preview accounting sync did not produce a persisted outbox_id",
        idempotency_key: canonicalKey,
        invoice_request_id,
      });
    }

    return res.status(200).json({
      success: true,
      is_test_adapter: true,
      adapter_note:
        "PREVIEW/TEST ONLY — this response does not represent a real QuickBooks invoice. " +
        "No accounting entry has been created in any QuickBooks company.",
      provider: "preview_test",
      provider_reference_id: testReference,
      provider_reference_type: "test_invoice_ref",
      idempotency_key: canonicalKey,
      invoice_request_id,
      currency_code: canonicalCurrency,
      subtotal_amount: canonicalSubtotal,
      tax_amount: canonicalTax,
      total_amount: canonicalTotal,
      acknowledged_at: acknowledgedAt,
      environment: env,
      outbox_id: persistedOutbox.id,
      missing_live_prerequisites: [
        "QBO_CLIENT_ID",
        "QBO_CLIENT_SECRET",
        "QBO_REFRESH_TOKEN",
        "QBO_REALM_ID",
      ].filter((k) => !process.env[k]),
    });
  }

  // ── Live QuickBooks path ──────────────────────────────────────────────────

  // A7: Create outbox row in 'pending' state if not yet exists
  let outboxId = outboxRow?.id ?? null;
  const nowIso = new Date().toISOString();

  if (!outboxRow) {
    try {
      const newOutbox = await upsertOutboxRow({
        organization_id: canonicalOrgId,
        business_unit_id: canonicalBuId,
        invoice_request_id,
        idempotency_key: canonicalKey,
        provider: "quickbooks",
        outbox_status: "pending",
        is_test_adapter: false,
        attempt_count: 0,
        request_payload: {
          invoice_request_id,
          operational_job_id: canonicalJobId,
          currency_code: canonicalCurrency,
          subtotal_amount: canonicalSubtotal,
          tax_amount: canonicalTax,
          total_amount: canonicalTotal,
        },
        metadata: {
          wave: "wave5",
          environment: env,
          source: "wave5-accounting-sync",
          requested_by_auth_user_id: authUser.id,
          requested_by_app_user_id: appUser.id,
          authorized_role: membershipContext.roleCode,
          authorized_membership_id: membershipContext.membership.id,
        },
      });
      outboxId = newOutbox?.id ?? null;
    } catch (outboxErr) {
      return res.status(500).json({
        success: false,
        error: "Failed to create accounting_sync_outbox row",
        detail: outboxErr.message,
        idempotency_key: canonicalKey,
        invoice_request_id,
      });
    }
  }

  try {
    const isSandbox = process.env.QBO_SANDBOX !== "false";
    const realmId = process.env.QBO_REALM_ID;
    const qboRequestId = deriveQboRequestId(canonicalKey);

    // Mark as sent
    if (outboxId) {
      outboxRow = await updateOutboxRow(outboxId, {
        outbox_status: "sent",
        last_attempted_at: nowIso,
        attempt_count: (outboxRow?.attempt_count ?? 0) + 1,
      });
    }

    const tokenData = await refreshQBOAccessToken();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("QBO token refresh returned no access_token");
    }

    // A6: Build QBO Invoice from canonical DB values — client monetary values are never used
    const qboInvoice = {
      DocNumber: String(invoice_request_id).substring(0, 21),
      PrivateNote: `ServiceOS Wave 5 | operational_job: ${canonicalJobId} | idempotency: ${canonicalKey}`,
      Line: [
        {
          Amount: canonicalSubtotal,
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ItemRef: { value: "1", name: "Services" },
            UnitPrice: canonicalSubtotal,
            Qty: 1,
          },
          Description: `Professional cleaning service — ServiceOS | invoice_request: ${invoice_request_id}`,
        },
      ],
      CurrencyRef: { value: String(canonicalCurrency).toUpperCase() },
    };

    if (canonicalTax > 0) {
      qboInvoice.TxnTaxDetail = { TotalTax: canonicalTax };
    }

    const qboResponse = await createQBOInvoice(accessToken, realmId, { Invoice: qboInvoice }, isSandbox, qboRequestId);
    const qboInvoiceId = qboResponse?.Invoice?.Id;

    if (!qboInvoiceId) {
      throw new Error("QBO invoice creation returned no Invoice.Id");
    }

    // A7: Mark acknowledged with real provider_reference_id from QBO response
    const acknowledgedAt = new Date().toISOString();
    if (outboxId) {
      try {
        await updateOutboxRow(outboxId, {
          outbox_status: "acknowledged",
          provider_reference_id: String(qboInvoiceId),
          provider_reference_type: "qbo_invoice_id",
          response_payload: qboResponse,
          acknowledged_at: acknowledgedAt,
          last_attempted_at: acknowledgedAt,
        });
      } catch (ackPersistErr) {
        return res.status(502).json({
          success: false,
          error: "QuickBooks invoice was created but acknowledgment persistence failed",
          detail: ackPersistErr.message,
          synchronization_durability_error: true,
          provider: "quickbooks",
          provider_reference_id: String(qboInvoiceId),
          provider_reference_type: "qbo_invoice_id",
          qbo_request_id: qboRequestId,
          idempotency_key: canonicalKey,
          invoice_request_id,
          outbox_id: outboxId,
        });
      }
    }

    return res.status(200).json({
      success: true,
      is_test_adapter: false,
      provider: "quickbooks",
      provider_reference_id: String(qboInvoiceId),
      provider_reference_type: "qbo_invoice_id",
      idempotency_key: canonicalKey,
      invoice_request_id,
      currency_code: canonicalCurrency,
      subtotal_amount: canonicalSubtotal,
      tax_amount: canonicalTax,
      total_amount: canonicalTotal,
      acknowledged_at: acknowledgedAt,
      environment: env,
      outbox_id: outboxId,
      qbo_request_id: qboRequestId,
      qbo_sync_token: qboResponse?.Invoice?.SyncToken ?? null,
    });
  } catch (err) {
    // Mark failed in outbox
    let failureStatePersistenceFailed = false;
    let failureStatePersistenceError = null;
    if (outboxId) {
      try {
        await updateOutboxRow(outboxId, {
          outbox_status: "failed",
          response_payload: { error: err.message },
          last_attempted_at: new Date().toISOString(),
        });
      } catch (failurePersistErr) {
        failureStatePersistenceFailed = true;
        failureStatePersistenceError = failurePersistErr.message;
      }
    }

    return res.status(500).json({
      success: false,
      error: "QuickBooks accounting sync failed",
      detail: err.message,
      idempotency_key: canonicalKey,
      invoice_request_id,
      failure_state_persistence_failed: failureStatePersistenceFailed,
      failure_state_persistence_error: failureStatePersistenceError,
    });
  }
}
//
// ARCHITECTURE:
//   This is a governed INTERFACE boundary between ServiceOS and QuickBooks.
//   QuickBooks is the FORMAL ACCOUNTING LEDGER AUTHORITY.
//   This handler does NOT fabricate QuickBooks IDs.
//   It does NOT substitute Stripe as the accounting ledger.
//
// LIVE QUICKBOOKS PREREQUISITES (not yet satisfied — see notes below):
//   The following environment variables must be present for live QBO operation:
//     QBO_CLIENT_ID         – QuickBooks OAuth 2.0 Client ID
//     QBO_CLIENT_SECRET     – QuickBooks OAuth 2.0 Client Secret
//     QBO_REFRESH_TOKEN     – OAuth 2.0 refresh token (per company/realm)
//     QBO_REALM_ID          – QuickBooks Company/Realm ID
//     QBO_SANDBOX           – "true" for sandbox; "false" for production
//     SERVICEOS_ENVIRONMENT – "production" | "preview" | "test"
//
// PREVIEW/TEST ADAPTER:
//   When SERVICEOS_ENVIRONMENT is "preview" or "test" AND all QBO credentials
//   are absent, a safe test adapter path is used.
//   The test adapter is PROHIBITED when SERVICEOS_ENVIRONMENT === "production".
//
// IDEMPOTENCY:
//   The caller must provide an idempotency_key.
//   The handler returns the same synthetic/real reference for duplicate keys.
//
// IMPORTANT: This handler does NOT use the legacy placeholder accounting file.
// That file fabricates synthetic QB IDs at runtime and must not be used for canonical accounting.
// It must NOT be used as canonical proof of QuickBooks synchronization.
