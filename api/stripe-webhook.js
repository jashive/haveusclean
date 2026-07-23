// api/stripe-webhook.js — Listens for Stripe payment confirmation
// Requires STRIPE_WEBHOOK_SECRET in Vercel environment variables
// Set up in Stripe Dashboard → Webhooks → Add endpoint
// Endpoint URL: https://haveusclean.vercel.app/api/stripe-webhook
// Events to listen for: checkout.session.completed

import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

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
    return res.status(200).json({ received: true, jobId, clientName, amount });
  }

  return res.status(200).json({ received: true });
}
