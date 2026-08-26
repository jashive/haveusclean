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

async function rest(path, token, options = {}) {
  const { url, anon } = envConfig();
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

async function parse(response, fallback) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.error || data?.hint || fallback);
  return data;
}

async function one(path, token, fallback) {
  const rows = await parse(await rest(path, token), fallback);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(fallback);
  return rows[0];
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function origin(req) {
  const configured = String(process.env.SERVICEOS_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) throw new Error('Unable to determine ServiceOS public URL');
  return `${proto}://${host}`;
}

async function publicRpc(name, payload) {
  const { anon } = envConfig();
  return parse(await rest(`rpc/${name}`, anon, { method: 'POST', body: JSON.stringify(payload) }), 'Unable to process quote response');
}

function htmlPage(content) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Have Us Clean Quote</title></head><body style="margin:0;background:#f4f7f8;font-family:Arial,sans-serif;color:#17202a"><main style="max-width:680px;margin:0 auto;padding:24px"><header style="background:#102a26;color:white;padding:22px 24px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:26px">Have Us Clean</h1><p style="margin:6px 0 0;color:#bfe9df">Quote Review</p></header><section style="background:white;border:1px solid #dce5e7;border-top:0;border-radius:0 0 12px 12px;padding:24px">${content}</section></main></body></html>`;
}

function bodyObject(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return Object.fromEntries(new URLSearchParams(String(req.body || '')).entries());
}

async function handleQuoteDecision(req, res) {
  if (req.method === 'GET') {
    const token = String(req.query?.token || '').trim();
    if (!token) return res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(htmlPage('<h2>Invalid quote link</h2><p>This link is missing its secure quote token.</p>'));
    const context = await publicRpc('get_public_quote_decision_context', { p_token: token });
    const existing = context?.decision;
    const existingMessage = existing === 'accepted'
      ? '<div style="background:#e9f8f4;border:1px solid #8bd7c5;padding:14px;border-radius:8px;margin:18px 0"><strong>Thank you — you accepted this quote.</strong><br>Have Us Clean will confirm the next scheduling step.</div>'
      : existing === 'requested_changes'
        ? '<div style="background:#fff7df;border:1px solid #e4bd5c;padding:14px;border-radius:8px;margin:18px 0"><strong>Your request for changes has been received.</strong><br>Have Us Clean will review it and send a revised quote if needed.</div>'
        : '';
    const actionUrl = '/api/notifications?action=quote-decision';
    const actions = existing ? '' : `<form method="POST" action="${actionUrl}" style="margin-top:22px"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" name="decision" value="accepted" style="border:0;border-radius:8px;background:#00a985;color:white;font-weight:700;padding:13px 18px;font-size:15px;cursor:pointer">Accept Quote</button><div style="margin-top:24px;border-top:1px solid #e3e8ea;padding-top:18px"><label for="notes" style="display:block;font-weight:700;margin-bottom:7px">Need a different scope or price point?</label><textarea id="notes" name="notes" rows="4" placeholder="Tell us what you would like changed, including your target budget if helpful." style="box-sizing:border-box;width:100%;padding:11px;border:1px solid #b7c2c7;border-radius:8px;font:inherit"></textarea><button type="submit" name="decision" value="requested_changes" style="margin-top:10px;border:1px solid #167a66;border-radius:8px;background:white;color:#126553;font-weight:700;padding:11px 16px;font-size:14px;cursor:pointer">Request Changes</button></div></form>`;
    return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(htmlPage(`<h2 style="margin-top:0">${escapeHtml(context?.title || 'Your cleaning quote')}</h2><div style="white-space:pre-wrap;line-height:1.65;background:#f8fafb;border:1px solid #e1e7e9;border-radius:8px;padding:16px">${escapeHtml(context?.customer_facing_text || '')}</div>${existingMessage}${actions}<p style="font-size:12px;color:#68777d;margin-top:24px">Your response applies only to this exact quote version. Requesting changes does not accept the quote or schedule a job.</p>`));
  }
  if (req.method === 'POST') {
    const body = bodyObject(req);
    const token = String(body.token || '').trim();
    const decision = String(body.decision || '').trim();
    const notes = String(body.notes || '').trim().slice(0, 2000) || null;
    if (!token || !['accepted', 'requested_changes'].includes(decision)) return res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(htmlPage('<h2>Unable to record response</h2><p>The quote response was incomplete or invalid.</p>'));
    const recorded = await publicRpc('record_public_quote_decision', { p_token: token, p_decision: decision, p_notes: notes });
    const message = decision === 'accepted'
      ? '<h2>Quote accepted</h2><p>Thank you. Your decision has been securely recorded. Have Us Clean will confirm scheduling and next steps.</p>'
      : '<h2>Changes requested</h2><p>Thank you. Your request has been securely recorded. Have Us Clean will review your request and follow up with a revised quote when appropriate.</p>';
    return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(htmlPage(`${message}<p style="font-size:12px;color:#68777d">Reference: ${escapeHtml(recorded?.quote_version_id || '')}</p>`));
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleQuoteEmail(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const accessToken = bearer(req);
  if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
  const quoteVersionId = String(req.body?.quoteVersionId || '').trim();
  if (!quoteVersionId) return res.status(400).json({ error: 'quoteVersionId is required' });

  const qv = await one(`quote_version?select=id,organization_id,business_unit_id,quote_id,lifecycle_status,title,line_items_snapshot,commercial_snapshot&id=eq.${encodeURIComponent(quoteVersionId)}`, accessToken, 'Quote version not found or not authorized');
  if (!['draft', 'sent'].includes(qv.lifecycle_status)) return res.status(409).json({ error: 'Only a draft or sent quote can be emailed' });
  const prior = await parse(await rest(`quote_delivery?select=id,recipient_email,provider,provider_message_id,provider_accepted_at,decision_expires_at&quote_version_id=eq.${encodeURIComponent(qv.id)}&channel=eq.email&order=created_at.desc&limit=1`, accessToken), 'Unable to check prior quote delivery');
  if (Array.isArray(prior) && prior.length) return res.status(200).json({ success: true, alreadySent: true, delivery: prior[0], quoteVersionId: qv.id });

  const quote = await one(`quote?select=id,opportunity_id&id=eq.${encodeURIComponent(qv.quote_id)}`, accessToken, 'Canonical quote lineage is unavailable');
  const opportunity = await one(`opportunity?select=id,service_request_id&id=eq.${encodeURIComponent(quote.opportunity_id)}`, accessToken, 'Canonical opportunity lineage is unavailable');
  const serviceRequest = await one(`service_request?select=id,requirements&id=eq.${encodeURIComponent(opportunity.service_request_id)}`, accessToken, 'Canonical service request lineage is unavailable');
  const recipientEmail = String(serviceRequest.requirements?.customer?.email || '').trim().toLowerCase();
  const customerText = String(qv.commercial_snapshot?.customerFacingText || '').trim();
  if (!recipientEmail) return res.status(422).json({ error: 'This saved lead does not have a customer email address' });
  if (!customerText) return res.status(409).json({ error: 'The canonical saved quote does not contain customer-facing quote text' });
  if (!process.env.GOOGLE_EMAIL || !process.env.GOOGLE_APP_PASSWORD) return res.status(503).json({ error: 'Have Us Clean email delivery is not configured' });

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const decisionUrl = `${origin(req)}/api/notifications?action=quote-decision&token=${encodeURIComponent(token)}`;
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: process.env.GOOGLE_EMAIL, pass: process.env.GOOGLE_APP_PASSWORD } });
  const info = await transporter.sendMail({
    from: `Have Us Clean <${process.env.GOOGLE_EMAIL}>`, to: recipientEmail,
    subject: `Your Have Us Clean Quote${qv.title ? ` — ${qv.title}` : ''}`,
    text: `${customerText}\n\nReview your quote and respond here: ${decisionUrl}\n\nThank you,\nHave Us Clean`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Arial,sans-serif;color:#17202a"><div style="max-width:640px;margin:0 auto;padding:28px"><div style="background:#102a26;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:24px">Have Us Clean</h1><p style="margin:6px 0 0;color:#bfe9df">Your cleaning quote</p></div><div style="background:#fff;padding:24px;border:1px solid #dce5e7;border-top:0;border-radius:0 0 12px 12px"><div style="white-space:pre-wrap;line-height:1.6;font-size:15px">${escapeHtml(customerText)}</div><p style="margin:26px 0 10px"><a href="${escapeHtml(decisionUrl)}" style="display:inline-block;background:#00a985;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:8px">Review & Respond to Quote</a></p><p style="font-size:12px;color:#68777d;line-height:1.5">This secure response link expires in 14 days. If you need a different service scope or price point, choose Request Changes and tell us what you would like adjusted.</p></div></div></body></html>`,
  });
  const accepted = Array.isArray(info.accepted) ? info.accepted.map((v) => String(v).toLowerCase()) : [];
  if (!accepted.includes(recipientEmail)) throw new Error('Email provider did not accept the customer address');
  const providerMessageId = String(info.messageId || '').trim();
  if (!providerMessageId) throw new Error('Email provider did not return a message ID');
  const delivery = await parse(await rest('rpc/record_quote_email_delivery', accessToken, { method: 'POST', body: JSON.stringify({ p_quote_version_id: qv.id, p_recipient_email: recipientEmail, p_provider: 'gmail_smtp', p_provider_message_id: providerMessageId, p_decision_token_hash: tokenHash, p_decision_expires_at: expiresAt, p_metadata: { source: 'serviceos_native_quote_email', smtp_response: info.response || null } }) }), 'Email was accepted by the provider but ServiceOS could not record delivery evidence');
  return res.status(200).json({ success: true, alreadySent: false, quoteVersionId: qv.id, delivery });
}

async function handleReminder(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { job, channel = 'email', kind = 'scheduled' } = req.body || {};
  const message = `${kind} reminder for ${job?.client || 'client'} - ${job?.type || 'service'}`;
  if (process.env.GOOGLE_EMAIL && process.env.GOOGLE_APP_PASSWORD && job?.email) {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: process.env.GOOGLE_EMAIL, pass: process.env.GOOGLE_APP_PASSWORD } });
    await transporter.sendMail({ from: process.env.GOOGLE_EMAIL, to: job.email, subject: `Have Us Clean ${kind === 'followup' ? 'follow-up' : 'reminder'}`, html: `<p>Hi ${job.client || 'there'},</p><p>${message}</p><p>Thanks,<br/>Have Us Clean</p>` });
  }
  return res.status(200).json({ success: true, message, channel });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const action = String(req.query?.action || req.body?.action || '').trim();
    if (action === 'quote-email') return await handleQuoteEmail(req, res);
    if (action === 'quote-decision') return await handleQuoteDecision(req, res);
    return await handleReminder(req, res);
  } catch (error) {
    console.error('Notification API Error:', error);
    if (String(req.query?.action || '') === 'quote-decision') return res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(htmlPage(`<h2>Unable to open this quote</h2><p>${escapeHtml(error.message || 'This quote link is invalid or expired.')}</p><p>Please contact Have Us Clean for assistance.</p>`));
    return res.status(500).json({ success: false, error: error.message || 'Unable to process notification request' });
  }
}
