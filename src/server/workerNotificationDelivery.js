import crypto from 'node:crypto';

function envConfig() {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(process.env.VITE_SUPABASE_ANON || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON || process.env.SUPABASE_ANON_KEY || '');
  if (!url || !anon) throw new Error('ServiceOS Supabase server configuration is incomplete');
  return { url, anon };
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
  if (!response.ok) {
    const err = new Error(data?.message || data?.error || data?.hint || fallback);
    err.status = response.status;
    err.data = data;
    throw err;
  }
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

function publicOrigin(req) {
  const configured = String(process.env.SERVICEOS_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : 'https://haveusclean.vercel.app';
}

function microsoft365Config() {
  const tenantId = String(process.env.M365_TENANT_ID || '').trim();
  const clientId = String(process.env.M365_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.M365_CLIENT_SECRET || '').trim();
  const senderEmail = String(process.env.M365_SENDER_EMAIL || '').trim().toLowerCase();
  if (!tenantId || !clientId || !clientSecret || !senderEmail) throw new Error('Microsoft 365 worker delivery is not configured');
  return { tenantId, clientId, clientSecret, senderEmail };
}

async function microsoftToken() {
  const { tenantId, clientId, clientSecret } = microsoft365Config();
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const data = await parse(response, 'Microsoft 365 authentication failed');
  if (!data?.access_token) throw new Error('Microsoft 365 authentication returned no access token');
  return data.access_token;
}

async function graph(path, token, options = {}, fallback = 'Microsoft 365 request failed') {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (response.status === 202 || response.status === 204) return { response, data: null };
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.error?.message || data?.message || fallback);
  return { response, data };
}

function twilioConfig() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = String(process.env.TWILIO_FROM_NUMBER || '').trim();
  return accountSid && authToken && from ? { accountSid, authToken, from } : null;
}

async function createAudit(accessToken, payload) {
  try {
    const rows = await parse(await rest('worker_notification_delivery', accessToken, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    }), 'Unable to create worker notification audit');
    return { row: Array.isArray(rows) ? rows[0] : rows, created: true };
  } catch (error) {
    if (error.status !== 409) throw error;
    const rows = await parse(await rest(`worker_notification_delivery?worker_assignment_id=eq.${encodeURIComponent(payload.worker_assignment_id)}&channel=eq.${encodeURIComponent(payload.channel)}&limit=1`, accessToken), 'Unable to resolve prior worker notification');
    return { row: Array.isArray(rows) ? rows[0] : rows, created: false };
  }
}

async function patchAudit(accessToken, id, patch) {
  const rows = await parse(await rest(`worker_notification_delivery?id=eq.${encodeURIComponent(id)}`, accessToken, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  }), 'Unable to update worker notification audit');
  return Array.isArray(rows) ? rows[0] : rows;
}

async function sendEmail({ worker, context, audit, accessToken }) {
  const { senderEmail } = microsoft365Config();
  const token = await microsoftToken();
  const subject = `Have Us Clean Work Order — ${context.serviceTitle}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#17202a;line-height:1.55"><h2>New Have Us Clean Work Order</h2><p>Hi ${escapeHtml(worker.display_name || 'team member')},</p><p>You have been assigned a new work order.</p><p><strong>Service:</strong> ${escapeHtml(context.serviceTitle)}<br><strong>Location:</strong> ${escapeHtml(context.location)}<br><strong>Start:</strong> ${escapeHtml(context.start)}<br><strong>End:</strong> ${escapeHtml(context.end)}</p><p><a href="${escapeHtml(context.workerUrl)}">Open ServiceOS to review and acknowledge</a></p><p>Work order: ${escapeHtml(context.workOrderId)}</p></div>`;
  const { data: draft } = await graph(`/users/${encodeURIComponent(senderEmail)}/messages`, token, {
    method: 'POST',
    body: JSON.stringify({
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: worker.email } }],
      internetMessageHeaders: [
        { name: 'X-HUC-Worker-Assignment', value: context.assignmentId },
        { name: 'X-HUC-Work-Order', value: context.workOrderId },
        { name: 'X-HUC-Idempotency-Key', value: audit.idempotency_key },
      ],
    }),
  }, 'Microsoft 365 could not create the worker notification email');
  const providerMessageId = String(draft?.id || '').trim();
  if (!providerMessageId) throw new Error('Microsoft 365 did not return a worker notification message ID');
  const { response } = await graph(`/users/${encodeURIComponent(senderEmail)}/messages/${encodeURIComponent(providerMessageId)}/send`, token, { method: 'POST' }, 'Microsoft 365 did not accept the worker notification email');
  if (response.status !== 202) throw new Error(`Microsoft 365 worker email send returned HTTP ${response.status}`);
  return patchAudit(accessToken, audit.id, { delivery_status: 'sent', provider_message_id: providerMessageId, sent_at: new Date().toISOString(), metadata: { ...(audit.metadata || {}), provider_acceptance_status: 202, sender_email: senderEmail } });
}

async function sendSms({ worker, context, audit, accessToken }) {
  const cfg = twilioConfig();
  if (!cfg) throw new Error('SMS provider is not configured');
  const body = `Have Us Clean work order: ${context.serviceTitle}. ${context.start} at ${context.location}. Open ServiceOS to review and acknowledge: ${context.workerUrl}`;
  const form = new URLSearchParams({ To: worker.phone, From: cfg.from, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const data = await parse(response, 'SMS provider could not accept the worker notification');
  return patchAudit(accessToken, audit.id, { delivery_status: 'sent', provider_message_id: data?.sid || null, sent_at: new Date().toISOString(), metadata: { ...(audit.metadata || {}), provider_status: data?.status || 'accepted' } });
}

export async function handleWorkerDispatchNotification(req, res, accessToken) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!accessToken) return res.status(401).json({ error: 'Authentication required' });
  const assignmentId = String(req.body?.assignmentId || '').trim();
  const workOrderId = String(req.body?.workOrderId || '').trim();
  if (!assignmentId || !workOrderId) return res.status(400).json({ error: 'assignmentId and workOrderId are required' });

  const assignment = await one(`worker_assignment?select=id,organization_id,business_unit_id,operational_job_id,schedule_window_id,worker_id,assignment_status&id=eq.${encodeURIComponent(assignmentId)}`, accessToken, 'Worker assignment not found or not authorized');
  const workOrder = await one(`work_order?select=id,operational_job_id,work_order_status&id=eq.${encodeURIComponent(workOrderId)}`, accessToken, 'Work order not found or not authorized');
  if (workOrder.operational_job_id !== assignment.operational_job_id) return res.status(409).json({ error: 'Work order does not belong to the selected worker assignment' });
  if (!['assigned','acknowledged'].includes(assignment.assignment_status)) return res.status(409).json({ error: 'Worker assignment must be assigned before notification' });
  if (!['published','in_progress','service_complete','qa_complete','closed'].includes(workOrder.work_order_status)) return res.status(409).json({ error: 'Work order must be published before notification' });

  const [worker, job, schedule] = await Promise.all([
    one(`worker?select=id,display_name,email,phone,status&id=eq.${encodeURIComponent(assignment.worker_id)}`, accessToken, 'Assigned worker is unavailable'),
    one(`operational_job?select=id,quote_version_id,service_location_id&id=eq.${encodeURIComponent(assignment.operational_job_id)}`, accessToken, 'Operational job is unavailable'),
    one(`schedule_window?select=id,scheduled_start,scheduled_end,timezone&id=eq.${encodeURIComponent(assignment.schedule_window_id)}`, accessToken, 'Schedule window is unavailable'),
  ]);
  if (worker.status !== 'active') return res.status(409).json({ error: 'Assigned worker is not active' });
  const [quoteVersion, location] = await Promise.all([
    one(`quote_version?select=id,title&id=eq.${encodeURIComponent(job.quote_version_id)}`, accessToken, 'Quote version is unavailable'),
    one(`service_location?select=id,address_line1,city,subdivision&id=eq.${encodeURIComponent(job.service_location_id)}`, accessToken, 'Service location is unavailable'),
  ]);
  const context = {
    assignmentId: assignment.id,
    workOrderId: workOrder.id,
    serviceTitle: quoteVersion.title || 'Cleaning service',
    location: [location.address_line1, location.city, location.subdivision].filter(Boolean).join(', '),
    start: `${schedule.scheduled_start} (${schedule.timezone})`,
    end: `${schedule.scheduled_end} (${schedule.timezone})`,
    workerUrl: `${publicOrigin(req)}/`,
  };

  const channels = [];
  if (worker.email) channels.push({ channel: 'email', recipient: worker.email, provider: 'microsoft_graph' });
  if (worker.phone && twilioConfig()) channels.push({ channel: 'sms', recipient: worker.phone, provider: 'twilio' });
  if (!channels.length) return res.status(422).json({ error: 'Assigned worker has no configured deliverable email/SMS channel' });

  const results = [];
  for (const channel of channels) {
    const idempotencyKey = crypto.createHash('sha256').update(`worker-dispatch:${assignment.id}:${workOrder.id}:${channel.channel}`).digest('hex');
    const { row: audit, created } = await createAudit(accessToken, {
      organization_id: assignment.organization_id,
      business_unit_id: assignment.business_unit_id,
      operational_job_id: assignment.operational_job_id,
      worker_assignment_id: assignment.id,
      work_order_id: workOrder.id,
      worker_id: worker.id,
      channel: channel.channel,
      recipient: channel.recipient,
      provider: channel.provider,
      delivery_status: 'requested',
      idempotency_key: idempotencyKey,
      metadata: { source: 'wave3_schedule_dispatch', work_order_status: workOrder.work_order_status },
    });
    if (!created || ['sent','delivered','acknowledged'].includes(audit.delivery_status)) {
      results.push({ channel: channel.channel, alreadyRequested: true, delivery: audit });
      continue;
    }
    try {
      const delivery = channel.channel === 'email'
        ? await sendEmail({ worker, context, audit, accessToken })
        : await sendSms({ worker, context, audit, accessToken });
      results.push({ channel: channel.channel, alreadyRequested: false, delivery });
    } catch (error) {
      const failed = await patchAudit(accessToken, audit.id, { delivery_status: 'failed', failed_at: new Date().toISOString(), failure_reason: String(error.message || error).slice(0, 1000) });
      results.push({ channel: channel.channel, alreadyRequested: false, delivery: failed, error: error.message || String(error) });
    }
  }
  const failed = results.filter((item) => item.delivery?.delivery_status === 'failed');
  return res.status(failed.length === results.length ? 502 : 200).json({ success: failed.length < results.length, assignmentId, workOrderId, results });
}
