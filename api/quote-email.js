import crypto from 'node:crypto';

function envConfig() {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(process.env.VITE_SUPABASE_ANON || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON || process.env.SUPABASE_ANON_KEY || '');
  if (!url || !anon) throw new Error('ServiceOS Supabase server configuration is incomplete');
  return { url, anon };
}

function bearer(req) {
  const raw = String(req.headers.authorization || '');
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
}

async function supabaseFetch(path, token, options = {}) {
  const { url, anon } = envConfig();
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function jsonOrError(response, fallback) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.error || data?.hint || fallback);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function publicOrigin(req) {
  const configured = String(process.env.SERVICEOS_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('Unable to determine ServiceOS public URL');
  return `${proto}://${host}`;
}

async function one(path, token, fallback) {
  const response = await supabaseFetch(path, token);
  const rows = await jsonOrError(response, fallback);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(fallback);
  return rows[0];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const accessToken = bearer(req);
    if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
    const quoteVersionId = String(req.body?.quoteVersionId || '').trim();
    if (!quoteVersionId) return res.status(400).json({ error: 'quoteVersionId is required' });

    const qv = await one(
      `quote_version?select=id,organization_id,business_unit_id,quote_id,lifecycle_status,title,line_items_snapshot,commercial_snapshot&id=eq.${encodeURIComponent(quoteVersionId)}`,
      accessToken,
      'Quote version not found or not authorized'
    );
    if (!['draft', 'sent'].includes(qv.lifecycle_status)) {
      return res.status(409).json({ error: 'Only a draft or sent quote can be emailed' });
    }

    const priorResponse = await supabaseFetch(
      `quote_delivery?select=id,recipient_email,provider,provider_message_id,provider_accepted_at,decision_expires_at&quote_version_id=eq.${encodeURIComponent(qv.id)}&channel=eq.email&order=created_at.desc&limit=1`,
      accessToken
    );
    const prior = await jsonOrError(priorResponse, 'Unable to check prior quote delivery');
    if (Array.isArray(prior) && prior.length) {
      return res.status(200).json({ success: true, alreadySent: true, delivery: prior[0], quoteVersionId: qv.id });
    }

    const quote = await one(
      `quote?select=id,opportunity_id&id=eq.${encodeURIComponent(qv.quote_id)}`,
      accessToken,
      'Canonical quote lineage is unavailable'
    );
    const opportunity = await one(
      `opportunity?select=id,service_request_id&id=eq.${encodeURIComponent(quote.opportunity_id)}`,
      accessToken,
      'Canonical opportunity lineage is unavailable'
    );
    const serviceRequest = await one(
      `service_request?select=id,requirements&id=eq.${encodeURIComponent(opportunity.service_request_id)}`,
      accessToken,
      'Canonical service request lineage is unavailable'
    );

    const recipientEmail = String(serviceRequest.requirements?.customer?.email || '').trim().toLowerCase();
    if (!recipientEmail) return res.status(422).json({ error: 'This saved lead does not have a customer email address' });

    const customerText = String(qv.commercial_snapshot?.customerFacingText || '').trim();
    if (!customerText) return res.status(409).json({ error: 'The canonical saved quote does not contain customer-facing quote text' });

    if (!process.env.GOOGLE_EMAIL || !process.env.GOOGLE_APP_PASSWORD) {
      return res.status(503).json({ error: 'Have Us Clean email delivery is not configured' });
    }

    const decisionToken = crypto.randomBytes(32).toString('base64url');
    const decisionTokenHash = crypto.createHash('sha256').update(decisionToken).digest('hex');
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const decisionUrl = `${publicOrigin(req)}/api/quote-decision?token=${encodeURIComponent(decisionToken)}`;

    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: process.env.GOOGLE_EMAIL, pass: process.env.GOOGLE_APP_PASSWORD },
    });

    const info = await transporter.sendMail({
      from: `Have Us Clean <${process.env.GOOGLE_EMAIL}>`,
      to: recipientEmail,
      subject: `Your Have Us Clean Quote${qv.title ? ` — ${qv.title}` : ''}`,
      text: `${customerText}\n\nReview your quote and respond here: ${decisionUrl}\n\nThank you,\nHave Us Clean`,
      html: `<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Arial,sans-serif;color:#17202a"><div style="max-width:640px;margin:0 auto;padding:28px"><div style="background:#102a26;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:24px">Have Us Clean</h1><p style="margin:6px 0 0;color:#bfe9df">Your cleaning quote</p></div><div style="background:#fff;padding:24px;border:1px solid #dce5e7;border-top:0;border-radius:0 0 12px 12px"><div style="white-space:pre-wrap;line-height:1.6;font-size:15px">${escapeHtml(customerText)}</div><p style="margin:26px 0 10px"><a href="${escapeHtml(decisionUrl)}" style="display:inline-block;background:#00a985;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:8px">Review & Respond to Quote</a></p><p style="font-size:12px;color:#68777d;line-height:1.5">This secure response link expires in 14 days. If you need a different service scope or price point, choose Request Changes and tell us what you would like adjusted.</p></div></div></body></html>`,
    });

    const accepted = Array.isArray(info.accepted) ? info.accepted.map((v) => String(v).toLowerCase()) : [];
    if (!accepted.includes(recipientEmail)) {
      throw new Error('Email provider did not accept the customer address');
    }
    const providerMessageId = String(info.messageId || '').trim();
    if (!providerMessageId) throw new Error('Email provider did not return a message ID');

    const deliveryResponse = await supabaseFetch('rpc/record_quote_email_delivery', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        p_quote_version_id: qv.id,
        p_recipient_email: recipientEmail,
        p_provider: 'gmail_smtp',
        p_provider_message_id: providerMessageId,
        p_decision_token_hash: decisionTokenHash,
        p_decision_expires_at: expiresAt,
        p_metadata: { source: 'serviceos_native_quote_email', smtp_response: info.response || null },
      }),
    });
    const delivery = await jsonOrError(deliveryResponse, 'Email was accepted by the provider but ServiceOS could not record delivery evidence');

    return res.status(200).json({ success: true, alreadySent: false, quoteVersionId: qv.id, delivery });
  } catch (error) {
    console.error('Quote email API error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Unable to send quote email' });
  }
}
