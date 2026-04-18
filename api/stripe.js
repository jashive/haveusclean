// api/stripe.js — Creates a Stripe Checkout session
// Requires STRIPE_SECRET_KEY in Vercel environment variables

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({
      error: 'STRIPE_SECRET_KEY not configured',
      help: 'Add STRIPE_SECRET_KEY to Vercel → Settings → Environment Variables'
    });
  }

  const {
    jobId,
    clientName,
    clientEmail,
    serviceType,
    amount,      // in dollars (e.g. 206.00)
    currency,    // "cad" or "usd"
    region,      // "ON" or "AZ"
    successUrl,
    cancelUrl,
  } = req.body;

  if (!amount || !currency || !clientName) {
    return res.status(400).json({ error: 'Missing required fields: amount, currency, clientName' });
  }

  try {
    // Convert dollars to cents for Stripe
    const amountCents = Math.round(parseFloat(amount) * 100);

    const regionLabel = region === 'ON' ? 'Toronto & GTA' : 'Arizona';
    const currencySymbol = currency === 'cad' ? 'CA$' : '$';

    const body = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][product_data][name]': `${serviceType} — Have Us Clean`,
      'line_items[0][price_data][product_data][description]': `Professional cleaning service · ${regionLabel} · ${clientName}`,
      'line_items[0][price_data][unit_amount]': amountCents,
      'line_items[0][quantity]': '1',
      'mode': 'payment',
      'customer_email': clientEmail || '',
      'success_url': successUrl || 'https://haveusclean.vercel.app/?payment=success',
      'cancel_url': cancelUrl || 'https://haveusclean.vercel.app/?payment=cancelled',
      'metadata[job_id]': jobId || '',
      'metadata[client_name]': clientName,
      'metadata[service_type]': serviceType || '',
      'metadata[region]': region || '',
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return res.status(400).json({ error: session.error?.message || 'Stripe error' });
    }

    return res.status(200).json({
      sessionId: session.id,
      url: session.url,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Payment setup failed', detail: err.message });
  }
}
