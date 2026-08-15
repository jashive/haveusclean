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

const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const QBO_PRODUCTION_BASE = "https://quickbooks.api.intuit.com/v3/company";

function getEnvironment() {
  return (process.env.SERVICEOS_ENVIRONMENT || "test").toLowerCase();
}

function isProductionEnvironment() {
  return getEnvironment() === "production";
}

function hasLiveQBOCredentials() {
  return !!(
    process.env.QBO_CLIENT_ID &&
    process.env.QBO_CLIENT_SECRET &&
    process.env.QBO_REFRESH_TOKEN &&
    process.env.QBO_REALM_ID
  );
}

/**
 * Refresh a QBO access token using the refresh token.
 * Returns { access_token, expires_in }.
 */
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

/**
 * Create an invoice in QuickBooks Online.
 * Returns the QBO Invoice object with Id and SyncToken.
 */
async function createQBOInvoice(accessToken, realmId, invoicePayload, isSandbox) {
  const base = isSandbox ? QBO_SANDBOX_BASE : QBO_PRODUCTION_BASE;
  const url = `${base}/${realmId}/invoice`;

  const res = await fetch(url, {
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

  const env = getEnvironment();
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

  const {
    idempotency_key,
    invoice_request_id,
    currency_code,
    subtotal_amount,
    tax_amount,
    total_amount,
    financial_snapshot,
    operational_job_id,
  } = body;

  // ── Input validation ──────────────────────────────────────────────────────

  if (!idempotency_key || !String(idempotency_key).trim()) {
    return res.status(400).json({ success: false, error: "idempotency_key is required" });
  }

  if (!invoice_request_id) {
    return res.status(400).json({ success: false, error: "invoice_request_id is required" });
  }

  if (!currency_code || total_amount === undefined || total_amount === null) {
    return res.status(400).json({ success: false, error: "currency_code and total_amount are required" });
  }

  // ── Production guard: test adapter prohibited ─────────────────────────────

  const liveCreds = hasLiveQBOCredentials();

  if (isProductionEnvironment() && !liveCreds) {
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

  if (!liveCreds && !isProductionEnvironment()) {
    // Safe test adapter: clearly marked, no real QuickBooks call.
    const testReference = `PREVIEW-TEST-${String(idempotency_key).trim().replace(/[^a-zA-Z0-9-]/g, "_")}`;

    return res.status(200).json({
      success: true,
      is_test_adapter: true,
      adapter_note:
        "PREVIEW/TEST ONLY — this response does not represent a real QuickBooks invoice. " +
        "No accounting entry has been created in any QuickBooks company.",
      provider: "preview_test",
      provider_reference_id: testReference,
      provider_reference_type: "test_invoice_ref",
      idempotency_key: String(idempotency_key).trim(),
      invoice_request_id,
      currency_code,
      total_amount,
      acknowledged_at: new Date().toISOString(),
      environment: env,
      missing_live_prerequisites: [
        "QBO_CLIENT_ID",
        "QBO_CLIENT_SECRET",
        "QBO_REFRESH_TOKEN",
        "QBO_REALM_ID",
      ].filter((k) => !process.env[k]),
    });
  }

  // ── Live QuickBooks path ──────────────────────────────────────────────────

  try {
    const isSandbox = process.env.QBO_SANDBOX !== "false";
    const realmId = process.env.QBO_REALM_ID;

    // Refresh access token
    const tokenData = await refreshQBOAccessToken();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("QBO token refresh returned no access_token");
    }

    // Build a minimal QBO Invoice object.
    // Line items use the frozen subtotal from the accepted pricing snapshot.
    // Tax is included as a separate TxnTaxDetail if applicable.
    const qboInvoice = {
      DocNumber: String(invoice_request_id).substring(0, 21),
      PrivateNote: `ServiceOS Wave 5 | operational_job: ${operational_job_id} | idempotency: ${idempotency_key}`,
      Line: [
        {
          Amount: Number(subtotal_amount),
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ItemRef: { value: "1", name: "Services" },
            UnitPrice: Number(subtotal_amount),
            Qty: 1,
          },
          Description: `Professional cleaning service — ServiceOS | invoice_request: ${invoice_request_id}`,
        },
      ],
      CurrencyRef: { value: String(currency_code).toUpperCase() },
    };

    // Add tax line if tax_amount > 0
    if (Number(tax_amount) > 0) {
      qboInvoice.TxnTaxDetail = {
        TotalTax: Number(tax_amount),
      };
    }

    const qboResponse = await createQBOInvoice(accessToken, realmId, { Invoice: qboInvoice }, isSandbox);
    const qboInvoiceId = qboResponse?.Invoice?.Id;

    if (!qboInvoiceId) {
      throw new Error("QBO invoice creation returned no Invoice.Id");
    }

    return res.status(200).json({
      success: true,
      is_test_adapter: false,
      provider: "quickbooks",
      provider_reference_id: String(qboInvoiceId),
      provider_reference_type: "qbo_invoice_id",
      idempotency_key: String(idempotency_key).trim(),
      invoice_request_id,
      currency_code,
      total_amount,
      acknowledged_at: new Date().toISOString(),
      environment: env,
      qbo_sync_token: qboResponse?.Invoice?.SyncToken ?? null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "QuickBooks accounting sync failed",
      detail: err.message,
      idempotency_key: String(idempotency_key).trim(),
      invoice_request_id,
    });
  }
}
