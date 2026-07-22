// api/stripe.js — Handles Stripe Checkout Sessions & Card-on-File SetupIntents
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
    action,      // 'create-setup-intent' (for widget card capture) or null/checkout (for direct payment)
    jobId,
    clientName,
    clientEmail,
    clientPhone,
    serviceType,
    amount,      // in dollars (e.g. 206.00)
    currency,    // "cad" or "usd"
    region,      // "ON" or "AZ"
    successUrl,
    cancelUrl,
  } = req.body;

  try {
    // -------------------------------------------------------------
    // ACTION 1: Create SetupIntent (Used by Booking Widget to Save Card)
    // -------------------------------------------------------------
    if (action === 'create-setup-intent') {
      if (!clientEmail) {
        return res.status(400).json({ error: 'Missing required field: clientEmail' });
      }

      // 1. Check or Create Stripe Customer
      const listRes = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(clientEmail)}&limit=1`, {
        headers: { 'Authorization': `Bearer ${secretKey}` },
      });
      const listData = await listRes.json();

      let customerId = listData.data && listData.data.length > 0 ? listData.data[0].id : null;

      if (!customerId) {
        const createCustBody = new URLSearchParams({
          email: clientEmail,
          name: clientName || '',
          phone: clientPhone || '',
        });

        const createCustRes = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: createCustBody.toString(),
        });
        const newCustomer = await createCustRes.json();
        customerId = newCustomer.id;
      }

      // 2. Create SetupIntent
      const setupBody = new URLSearchParams({
        customer: customerId,
        'payment_method_types[]': 'card',
      });

      const setupRes = await fetch('https://api.stripe.com/v1/setup_intents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: setupBody.toString(),
      });

      const setupIntent = await setupRes.json();

      if (!setupRes.ok) {
        return res.status(400).json({ error: setupIntent.error?.message || 'Stripe SetupIntent error' });
      }

      return res.status(200).json({
        clientSecret: setupIntent.client_secret,
        customerId: customerId,
      });
    }

    // -------------------------------------------------------------
    // ACTION 2: Standard Stripe Checkout Session (Original Flow)
    // -------------------------------------------------------------
    if (!amount || !currency || !clientName) {
      return res.status(400).json({ error: 'Missing required fields: amount, currency, clientName' });
    }

    // Convert dollars to cents for Stripe
    const amountCents = Math.round(parseFloat(amount) * 100);
    const regionLabel = region === 'ON' ? 'Toronto & GTA' : 'Arizona';

    const body = new URLSearchParams({
      'payment_method_types[]': 'card',
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][product_data][name]': `${serviceType || 'Cleaning Service'} — Have Us Clean`,
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
