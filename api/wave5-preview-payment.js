// api/wave5-preview-payment.js
//
// Server-only Wave 5 preview payment observation endpoint.
// Preview/test ONLY. Production is prohibited.

function getEnvironment() {
  const raw = (process.env.SERVICEOS_ENVIRONMENT || "").trim().toLowerCase();
  if (raw === "preview" || raw === "test" || raw === "production") return raw;
  return null;
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
    throw Object.assign(new Error(`Failed to validate ServiceOS bearer token: HTTP ${res.status} ${text}`), { status: 401 });
  }

  const user = await res.json();
  if (!user?.id) {
    throw Object.assign(new Error("ServiceOS bearer token did not resolve to an auth user"), { status: 401 });
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
    `app_user?select=id,auth_user_id,status&auth_user_id=eq.${encodeURIComponent(authUserId)}`
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
    `invoice_request?select=id,organization_id,business_unit_id&id=eq.${encodeURIComponent(invoiceRequestId)}&limit=1`
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

  const matchingMembership = (Array.isArray(memberships) ? memberships : []).find(
    (membership) =>
      membership.organization_id === invoiceSummary.organization_id &&
      membership.business_unit_id === invoiceSummary.business_unit_id &&
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
  const row = Array.isArray(rows) ? rows[0] ?? null : null;
  if (!row) throw new Error(`invoice_request ${invoiceRequestId} not found`);
  return row;
}

async function loadPaymentObservationByProviderEvent(provider, providerEventId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(
    `${supabaseUrl}/rest/v1/payment_observation?provider=eq.${encodeURIComponent(provider)}&provider_event_id=eq.${encodeURIComponent(providerEventId)}&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `******
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load payment_observation: HTTP ${res.status} ${text}`);
  }

  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function createPaymentObservation(payload) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetch(`${supabaseUrl}/rest/v1/payment_observation`, {
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
    const isDuplicate = res.status === 409 || text.toLowerCase().includes("duplicate");
    const error = new Error(`Failed to persist payment_observation: HTTP ${res.status} ${text}`);
    error.isDuplicate = isDuplicate;
    throw error;
  }

  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

function buildCrossInvoiceConflict(invoiceRequestId, providerEventId, existingInvoiceRequestId) {
  return {
    success: false,
    error: "provider_event_id already belongs to a different invoice_request",
    detail:
      `provider_event_id ${providerEventId} is already linked to invoice_request ` +
      `${existingInvoiceRequestId}, not ${invoiceRequestId}`,
    invoice_request_id: invoiceRequestId,
    provider_event_id: providerEventId,
    existing_invoice_request_id: existingInvoiceRequestId,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const env = getEnvironment();
  if (!env) {
    return res.status(503).json({
      success: false,
      error: "SERVICEOS_ENVIRONMENT is not set or is not a recognized value. Preview payment requires explicit environment: preview | test.",
    });
  }
  if (env === "production") {
    return res.status(403).json({
      success: false,
      error: "Preview payment endpoint is prohibited in production.",
    });
  }
  if (process.env.SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED !== "true") {
    return res.status(403).json({
      success: false,
      error: "SERVICEOS_W5_PREVIEW_PAYMENT_ENABLED=true is required.",
    });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(503).json({
      success: false,
      error: "SUPABASE_URL and SUPABASE_ANON_KEY are required to validate the ServiceOS bearer token.",
    });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({
      success: false,
      error: "SUPABASE_SERVICE_ROLE_KEY is required for server-only preview payment persistence.",
    });
  }

  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return res.status(401).json({ success: false, error: "Authorization: ****** is required" });
  }

  let authUser;
  try {
    authUser = await loadAuthenticatedAuthUser(bearerToken);
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: "ServiceOS bearer token validation failed",
      detail: err.message,
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: "Request body must be valid JSON",
      detail: err.message,
    });
  }

  const invoiceRequestId = String(body.invoice_request_id || "").trim();
  const providerEventId = String(body.provider_event_id || "").trim();

  if (!invoiceRequestId) {
    return res.status(400).json({ success: false, error: "invoice_request_id is required" });
  }
  if (!providerEventId) {
    return res.status(400).json({ success: false, error: "provider_event_id is required" });
  }

  let appUser;
  let membershipContext;
  try {
    appUser = await loadAuthorizedAppUser(bearerToken, authUser.id);
    membershipContext = await loadAuthorizedMembershipContext(bearerToken, appUser.id, invoiceRequestId);
  } catch (err) {
    return res.status(err.status === 403 ? 403 : 500).json({
      success: false,
      error: "ServiceOS finance authorization failed",
      detail: err.message,
      invoice_request_id: invoiceRequestId,
    });
  }

  let invoiceRequest;
  try {
    invoiceRequest = await loadCanonicalInvoiceRequest(invoiceRequestId);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: "Cannot load canonical invoice_request from DB",
      detail: err.message,
      invoice_request_id: invoiceRequestId,
    });
  }

  if (
    invoiceRequest.organization_id !== membershipContext.invoiceSummary.organization_id ||
    invoiceRequest.business_unit_id !== membershipContext.invoiceSummary.business_unit_id
  ) {
    return res.status(403).json({
      success: false,
      error: "Canonical invoice_request authorization scope changed during resolution",
      invoice_request_id: invoiceRequestId,
    });
  }

  if (["void", "cancelled"].includes(String(invoiceRequest.request_status || "").trim().toLowerCase())) {
    return res.status(409).json({
      success: false,
      error: "Preview payment is prohibited for terminal invoice_request status",
      detail: `invoice_request ${invoiceRequestId} is ${invoiceRequest.request_status}`,
      invoice_request_id: invoiceRequestId,
    });
  }

  try {
    const existing = await loadPaymentObservationByProviderEvent("preview_test", providerEventId);
    if (existing) {
      if (existing.invoice_request_id !== invoiceRequestId) {
        return res.status(409).json(
          buildCrossInvoiceConflict(
            invoiceRequestId,
            providerEventId,
            existing.invoice_request_id
          )
        );
      }
      return res.status(200).json({
        success: true,
        idempotent: true,
        payment_observation: existing,
      });
    }

    const persisted = await createPaymentObservation({
      organization_id: invoiceRequest.organization_id,
      business_unit_id: invoiceRequest.business_unit_id,
      invoice_request_id: invoiceRequest.id,
      provider: "preview_test",
      provider_event_id: providerEventId,
      provider_event_type: "preview.payment.observed",
      currency_code: invoiceRequest.currency_code,
      amount_observed: invoiceRequest.total_amount,
      payment_status: "observed",
      event_payload_snapshot: {
        preview_only: true,
        endpoint: "wave5-preview-payment",
        invoice_request_id: invoiceRequest.id,
      },
      observed_at: new Date().toISOString(),
      is_test_provider: true,
      metadata: {
        wave: "wave5",
        environment: env,
        source: "wave5-preview-payment",
        requested_by_auth_user_id: authUser.id,
        requested_by_app_user_id: appUser.id,
        authorized_role: membershipContext.roleCode,
        authorized_membership_id: membershipContext.membership.id,
      },
    });

    return res.status(200).json({
      success: true,
      idempotent: false,
      payment_observation: persisted,
    });
  } catch (err) {
    if (err.isDuplicate) {
      try {
        const existing = await loadPaymentObservationByProviderEvent("preview_test", providerEventId);
        if (existing) {
          if (existing.invoice_request_id !== invoiceRequestId) {
            return res.status(409).json(
              buildCrossInvoiceConflict(
                invoiceRequestId,
                providerEventId,
                existing.invoice_request_id
              )
            );
          }
          return res.status(200).json({
            success: true,
            idempotent: true,
            payment_observation: existing,
          });
        }
      } catch {}
    }

    return res.status(500).json({
      success: false,
      error: "Preview payment persistence failed",
      detail: err.message,
      invoice_request_id: invoiceRequestId,
      provider_event_id: providerEventId,
    });
  }
}
