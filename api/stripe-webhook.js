// api/stripe-webhook.js — Listens for Stripe payment confirmation
// Requires STRIPE_WEBHOOK_SECRET in Vercel environment variables
// Set up in Stripe Dashboard → Webhooks → Add endpoint
// Endpoint URL: https://haveusclean.vercel.app/api/stripe-webhook
// Events to listen for: checkout.session.completed
//
// A8: SERVICEOS_ENVIRONMENT must be explicitly set (production|preview|test).
//     Missing/unknown environment causes fail-closed hard rejection.
//
// A9: In SERVICEOS_ENVIRONMENT=production:
//     BOTH STRIPE_WEBHOOK_SECRET and stripe-signature header are REQUIRED.
//     If either is missing → return non-2xx.
//     Signature verification failure → return non-2xx.
//     No unsigned production fallback.
//
// A10: When SERVICEOS_FINANCE_ENABLED=true and the event is a ServiceOS Wave 5
//      payment event:
//      - Supabase config missing → retriable non-2xx
//      - invoice_request cannot be resolved → retriable non-2xx
//      - amount/currency mismatch → retriable non-2xx
//      - canonical insert fails for non-idempotency reason → retriable non-2xx
//      - Duplicate provider event → idempotent 200
//      - Legacy non-ServiceOS payment events are NOT failed by Wave 5 logic.
//
// A11: Stripe payment_observation rows are INSERT-only via service role in
//      this server handler. Authenticated browser clients may not INSERT
//      payment_observation rows representing Stripe events.

import Stripe from 'stripe';

// A8: FAIL CLOSED — missing/unknown SERVICEOS_ENVIRONMENT returns null
function getServiceosEnvironment() {
  const raw = (process.env.SERVICEOS_ENVIRONMENT || '').trim().toLowerCase();
  if (raw === 'production' || raw === 'preview' || raw === 'test') return raw;
  return null;
}

// ── A10: Classify whether a Stripe session is a ServiceOS Wave 5 event ───────
// Deterministic: legacy checkout may carry job_id, so Wave 5 requires explicit metadata.
function isWave5InvoiceEvent(session) {
  return (
    session?.metadata?.serviceos_finance_version === 'wave5' &&
    !!String(session?.metadata?.serviceos_invoice_request_id || '').trim()
  );
}

// ── A10/A11: Persist canonical payment_observation via service role ──────────
async function persistCanonicalPaymentObservation(session, eventId, env) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // A10: Supabase service config is required for Wave 5 canonical persistence
  if (!supabaseUrl || !serviceKey) {
    throw Object.assign(
      new Error('Supabase service credentials missing — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required'),
      { retriable: true, code: 'SUPABASE_CONFIG_MISSING' }
    );
  }

  const invoiceRequestId = String(session.metadata?.serviceos_invoice_request_id || '').trim();
  if (!invoiceRequestId) {
    // Not a ServiceOS Wave 5 event — skip (non-retriable)
    return null;
  }

  // Look up the exact canonical invoice_request referenced by Wave 5 metadata
  const irRes = await fetch(
    `${supabaseUrl}/rest/v1/invoice_request?id=eq.${encodeURIComponent(invoiceRequestId)}&request_status=not.in.(void,cancelled)&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `******
        'Content-Type': 'application/json',
      },
    }
  );

  if (!irRes.ok) {
    throw Object.assign(
      new Error(`Failed to query invoice_request: HTTP ${irRes.status}`),
      { retriable: true, code: 'IR_QUERY_FAILED' }
    );
  }

  const irRows = await irRes.json();
  const invoiceRequest = Array.isArray(irRows) ? irRows[0] : null;

  // A10: invoice_request cannot be resolved → retriable non-2xx
  if (!invoiceRequest) {
    throw Object.assign(
      new Error(`No active invoice_request found for serviceos_invoice_request_id ${invoiceRequestId}`),
      { retriable: true, code: 'IR_NOT_FOUND' }
    );
  }

  const amount = (session.amount_total || 0) / 100;
  const currency = (session.currency || '').toUpperCase();

  // A10: amount/currency mismatch → retriable non-2xx
  const irCurrency = (invoiceRequest.currency_code || '').toUpperCase();
  const irTotal = Number(invoiceRequest.total_amount);

  if (currency && irCurrency && currency !== irCurrency) {
    throw Object.assign(
      new Error(`Stripe session currency ${currency} does not match invoice_request currency ${irCurrency}`),
      { retriable: true, code: 'CURRENCY_MISMATCH' }
    );
  }

  if (amount && irTotal && Math.abs(amount - irTotal) > 0.01) {
    throw Object.assign(
      new Error(`Stripe session amount ${amount} does not match invoice_request total_amount ${irTotal}`),
      { retriable: true, code: 'AMOUNT_MISMATCH' }
    );
  }

  // Check for existing observation (idempotency)
  const existRes = await fetch(
    `${supabaseUrl}/rest/v1/payment_observation?provider=eq.stripe&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `******
        'Content-Type': 'application/json',
      },
    }
  );

  if (existRes.ok) {
    const existRows = await existRes.json();
    if (Array.isArray(existRows) && existRows.length > 0) {
      return { idempotent: true, row: existRows[0] }; // already persisted — idempotent
    }
  }

  // A11: INSERT via service role only (server-side authority)
  const payload = {
    organization_id: invoiceRequest.organization_id,
    business_unit_id: invoiceRequest.business_unit_id,
    invoice_request_id: invoiceRequest.id,
    provider: 'stripe',
    provider_event_id: eventId,
    provider_event_type: 'checkout.session.completed',
    provider_reference_id: session.payment_intent || null,
    currency_code: currency || invoiceRequest.currency_code,
    amount_observed: amount,
    payment_status: 'observed',
    event_payload_snapshot: {
      session_id: session.id,
      payment_intent: session.payment_intent,
      customer_email: session.customer_email,
      metadata: session.metadata,
    },
    observed_at: new Date().toISOString(),
    is_test_provider: env !== 'production',
    metadata: { wave: 'wave5', source: 'stripe_webhook', environment: env },
  };

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/payment_observation`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `******
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text().catch(() => '');
    // A10: idempotency duplicate (conflict) → not retriable; other insert failure → retriable
    const isConflict = insertRes.status === 409 || (errText && errText.includes('duplicate'));
    if (isConflict) {
      return { idempotent: true }; // duplicate event, already inserted
    }
    throw Object.assign(
      new Error(`Failed to insert payment_observation: HTTP ${insertRes.status} ${errText}`),
      { retriable: true, code: 'INSERT_FAILED' }
    );
  }

  const rows = await insertRes.json();
  return { idempotent: false, row: Array.isArray(rows) ? rows[0] : rows };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // A8: FAIL CLOSED — require explicit, known SERVICEOS_ENVIRONMENT
  const serviceosEnv = getServiceosEnvironment();
  if (!serviceosEnv) {
    return res.status(503).json({
      error: 'SERVICEOS_ENVIRONMENT is not set or is not a recognized value (production|preview|test). '
        + 'Stripe webhook handler requires explicit environment configuration.',
    });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

  // A9: In production, BOTH webhook secret AND signature are REQUIRED
  if (serviceosEnv === 'production') {
    if (!webhookSecret) {
      return res.status(400).json({
        error: 'STRIPE_WEBHOOK_SECRET is required in Production. Configure it in Vercel environment variables.',
      });
    }
    if (!signature) {
      return res.status(400).json({
        error: 'stripe-signature header is required in Production. Unsigned requests are rejected.',
      });
    }
  }

  let event;
  try {
    if (webhookSecret && signature) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } else if (serviceosEnv !== 'production') {
      // Allow unsigned parsing in preview/test only
      event = JSON.parse(rawBody);
    } else {
      // Should not be reachable given the production guard above, but fail closed
      return res.status(400).json({ error: 'Signature verification required in Production.' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid payload or signature', detail: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const jobId = session.metadata?.job_id;
    const clientName = session.metadata?.client_name;
    const amount = (session.amount_total || 0) / 100;
    const currency = session.currency?.toUpperCase();

    console.log(`✅ Payment received: ${currency} ${amount} from ${clientName} (Job: ${jobId})`);

    // A10: Canonical payment persistence for ServiceOS Wave 5 events
    if (process.env.SERVICEOS_FINANCE_ENABLED === 'true' && isWave5InvoiceEvent(session)) {
      const eventId = event.id || session.id;
      try {
        const result = await persistCanonicalPaymentObservation(session, eventId, serviceosEnv);
        if (result?.idempotent) {
          // Duplicate provider event — idempotent 200
          return res.status(200).json({ received: true, idempotent: true, jobId, amount });
        }
      } catch (persistErr) {
        // A10: Retriable failures return non-2xx so Stripe will retry
        if (persistErr.retriable) {
          console.error('Wave5 canonical payment persistence failed (retriable):', persistErr.message, persistErr.code);
          return res.status(503).json({
            error: 'Wave5 canonical payment persistence failed — retriable',
            code: persistErr.code,
            detail: persistErr.message,
          });
        }
        // Non-retriable (e.g. non-Wave5 skip) — log and continue
        console.warn('Wave5 canonical payment observation skipped (non-retriable):', persistErr.message);
      }
    } else if (process.env.SERVICEOS_FINANCE_ENABLED === 'true' && !isWave5InvoiceEvent(session)) {
      // Legacy non-ServiceOS payment event — do NOT fail because of missing explicit Wave 5 metadata
      console.log('Non-Wave5 payment event received (missing explicit wave5 metadata) — legacy path, no canonical persistence');
    }

    return res.status(200).json({ received: true, jobId, clientName, amount });
  }

  return res.status(200).json({ received: true });
}
