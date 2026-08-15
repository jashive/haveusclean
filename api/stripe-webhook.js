// api/stripe-webhook.js — Listens for Stripe payment confirmation
// Requires STRIPE_WEBHOOK_SECRET in Vercel environment variables
// Set up in Stripe Dashboard → Webhooks → Add endpoint
// Endpoint URL: https://haveusclean.vercel.app/api/stripe-webhook
// Events to listen for: checkout.session.completed
//
// Wave 5 additive: when SERVICEOS_FINANCE_ENABLED=true and Supabase
// server-side credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) are
// configured, a canonical payment_observation row is persisted.
// Duplicate Stripe webhook delivery is idempotent via UNIQUE (provider, provider_event_id).
// Canonical persistence failure is logged but does NOT break the legacy response.
// Webhook signature verification fails closed in Production (SERVICEOS_ENVIRONMENT=production).

import Stripe from 'stripe';

// ── Wave 5: attempt to persist a canonical payment_observation ───────────────
// Server-side only; uses process.env Supabase credentials, not Vite VITE_* vars.

async function persistCanonicalPaymentObservation(session, eventId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) return null;

  // Resolve invoice_request for this job (by operational_job metadata if present)
  // If job_id metadata is not mapped to an invoice_request, skip canonical persistence.
  const jobId = session.metadata?.job_id;
  if (!jobId) return null;

  try {
    // Look up an active invoice_request by operational_job_id
    const irRes = await fetch(
      `${supabaseUrl}/rest/v1/invoice_request?operational_job_id=eq.${encodeURIComponent(jobId)}&request_status=not.in.(void,cancelled)&order=created_at.desc&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `******
          "Content-Type": "application/json",
        },
      }
    );
    if (!irRes.ok) return null;

    const irRows = await irRes.json();
    const invoiceRequest = Array.isArray(irRows) ? irRows[0] : null;
    if (!invoiceRequest) return null;

    const amount = (session.amount_total || 0) / 100;
    const currency = (session.currency || "").toUpperCase();

    // Check for existing observation (idempotency)
    const existRes = await fetch(
      `${supabaseUrl}/rest/v1/payment_observation?provider=eq.stripe&provider_event_id=eq.${encodeURIComponent(eventId)}&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `******
          "Content-Type": "application/json",
        },
      }
    );
    if (existRes.ok) {
      const existRows = await existRes.json();
      if (Array.isArray(existRows) && existRows.length > 0) {
        return existRows[0]; // already persisted — idempotent
      }
    }

    const payload = {
      organization_id: invoiceRequest.organization_id,
      business_unit_id: invoiceRequest.business_unit_id,
      invoice_request_id: invoiceRequest.id,
      provider: "stripe",
      provider_event_id: eventId,
      provider_event_type: "checkout.session.completed",
      provider_reference_id: session.payment_intent || null,
      currency_code: currency || invoiceRequest.currency_code,
      amount_observed: amount,
      payment_status: "observed",
      event_payload_snapshot: {
        session_id: session.id,
        payment_intent: session.payment_intent,
        customer_email: session.customer_email,
        metadata: session.metadata,
      },
      observed_at: new Date().toISOString(),
      is_test_provider: false,
      metadata: { wave: "wave5", source: "stripe_webhook" },
    };

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/payment_observation`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `******
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });

    if (!insertRes.ok) return null;
    const rows = await insertRes.json();
    return Array.isArray(rows) ? rows[0] : rows;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const serviceosEnv = (process.env.SERVICEOS_ENVIRONMENT || '').toLowerCase();

  // Fail closed in Production if webhook secret is not configured
  if (serviceosEnv === 'production' && !webhookSecret) {
    return res.status(400).json({
      error: 'Webhook signature verification required in Production but STRIPE_WEBHOOK_SECRET is not configured',
    });
  }

  let event;
  try {
    if (webhookSecret && signature) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } else {
      event = JSON.parse(rawBody);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid payload', detail: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const jobId = session.metadata?.job_id;
    const clientName = session.metadata?.client_name;
    const amount = (session.amount_total || 0) / 100;
    const currency = session.currency?.toUpperCase();

    console.log(`✅ Payment received: ${currency} ${amount} from ${clientName} (Job: ${jobId})`);

    // Wave 5 additive: canonical payment persistence (non-blocking)
    if (process.env.SERVICEOS_FINANCE_ENABLED === 'true') {
      const eventId = event.id || session.id;
      try {
        await persistCanonicalPaymentObservation(session, eventId);
      } catch (persistErr) {
        console.error('Wave5 canonical payment persistence failed (non-blocking):', persistErr.message);
      }
    }

    return res.status(200).json({ received: true, jobId, clientName, amount });
  }

  return res.status(200).json({ received: true });
}
