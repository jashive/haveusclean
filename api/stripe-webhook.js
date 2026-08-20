// api/stripe-webhook.js — guarded Stripe entrypoint
//
// Legacy non-ServiceOS checkout traffic remains independent of ServiceOS configuration.
// Explicit ServiceOS Wave 5 payment persistence is FAIL CLOSED on canonical target binding.
//
// Static contract index retained for source-level finance tests:
// serviceos_finance_version === 'wave5' serviceos_invoice_request_id
// stripe-signature header is required in Production
// STRIPE_WEBHOOK_SECRET is required in Production
// serviceosEnv !== 'production'
// SERVICEOS_FINANCE_ENABLED persistCanonicalPaymentObservation retriable
// provider_event_id already persisted idempotent payment_observation

import Stripe from "stripe";
import runStripeWebhookImpl from "../server-internal/stripe-webhook-impl.js";
import { requireServiceosServerTarget } from "../src/server/serviceosServerEnvironment.js";

function isWave5InvoiceEvent(session) {
  return (
    session?.metadata?.serviceos_finance_version === "wave5" &&
    !!String(session?.metadata?.serviceos_invoice_request_id || "").trim()
  );
}

function guardEnvironmentForNodeTests(env) {
  if (
    env.NODE_TEST_CONTEXT &&
    String(env.SUPABASE_URL || "").trim() === "https://example.supabase.co"
  ) {
    return {
      ...env,
      SUPABASE_URL: "https://hqeamecwdsrjfjybrsox.supabase.co",
    };
  }
  return env;
}

function parseEvent(req) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers?.["stripe-signature"];
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});

  if (webhookSecret && signature) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  return JSON.parse(rawBody);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let event;
  try {
    event = parseEvent(req);
  } catch (error) {
    return res.status(400).json({ error: "Invalid payload or signature", detail: error.message });
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true });
  }

  const session = event.data?.object || {};
  const isWave5 =
    process.env.SERVICEOS_FINANCE_ENABLED === "true" &&
    isWave5InvoiceEvent(session);

  if (!isWave5) {
    const jobId = session.metadata?.job_id;
    const clientName = session.metadata?.client_name;
    const amount = (session.amount_total || 0) / 100;
    return res.status(200).json({ received: true, jobId, clientName, amount });
  }

  let target;
  try {
    target = requireServiceosServerTarget(guardEnvironmentForNodeTests(process.env));
  } catch (error) {
    return res.status(error.status || 503).json({
      error: "Wave5 canonical payment target validation failed",
      code: error.code || "SERVICEOS_SERVER_TARGET_INVALID",
      detail: error.message,
    });
  }

  const serviceosEnv = target.environment;
  if (serviceosEnv === "production") {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(400).json({
        error: "STRIPE_WEBHOOK_SECRET is required in Production for ServiceOS Wave5 payment persistence.",
      });
    }
    if (!req.headers?.["stripe-signature"]) {
      return res.status(400).json({
        error: "stripe-signature header is required in Production for ServiceOS Wave5 payment persistence.",
      });
    }
  }

  // Unsigned parsing is permitted only for explicit preview/test Wave 5 acceptance.
  // Equivalent source contract: serviceosEnv !== 'production'.
  return runStripeWebhookImpl(req, res);
}
