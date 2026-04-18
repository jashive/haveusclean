// api/stripe-webhook.js — Listens for Stripe payment confirmation
// Requires STRIPE_WEBHOOK_SECRET in Vercel environment variables
// Set up in Stripe Dashboard → Webhooks → Add endpoint
// Endpoint URL: https://haveusclean.vercel.app/api/stripe-webhook
// Events to listen for: checkout.session.completed

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];

  // For now — accept the event without signature verification
  // To enable signature verification, install stripe npm package
  let event;
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    event = JSON.parse(body);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const jobId = session.metadata?.job_id;
    const clientName = session.metadata?.client_name;
    const amount = session.amount_total / 100;
    const currency = session.currency?.toUpperCase();

    // Log the payment - in production you'd update your database here
    console.log(`✅ Payment received: ${currency} ${amount} from ${clientName} (Job: ${jobId})`);

    // Return success so Stripe knows we got it
    return res.status(200).json({ received: true, jobId, clientName, amount });
  }

  return res.status(200).json({ received: true });
}
