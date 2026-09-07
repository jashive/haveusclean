function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function config() {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(process.env.VITE_SUPABASE_ANON || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON || process.env.SUPABASE_ANON_KEY || '');
  const tenantId = String(process.env.M365_TENANT_ID || '').trim();
  const clientId = String(process.env.M365_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.M365_CLIENT_SECRET || '').trim();
  const senderEmail = String(process.env.M365_SENDER_EMAIL || '').trim().toLowerCase();
  const operationsEmail = String(process.env.M365_OPERATIONS_EMAIL || senderEmail).trim().toLowerCase();
  if (!url || !anon || !tenantId || !clientId || !clientSecret || !senderEmail) throw new Error('Customer completion delivery is not configured');
  return { url, anon, tenantId, clientId, clientSecret, senderEmail, operationsEmail };
}

async function parse(response, fallback) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.error || fallback);
  return data;
}

async function rpc(name, bearer, body) {
  const { url, anon } = config();
  return parse(await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), `Unable to ${name.replaceAll('_', ' ')}`);
}

async function graphToken() {
  const cfg = config();
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const data = await parse(response, 'Microsoft 365 authentication failed');
  if (!data?.access_token) throw new Error('Microsoft 365 authentication returned no access token');
  return data.access_token;
}

async function graph(path, token, options, fallback) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (response.status === 202 || response.status === 204) return null;
  return parse(response, fallback);
}

export async function deliverCustomerCompletionReceipt(workOrderId, bearer) {
  const context = await rpc('reserve_customer_completion_receipt', bearer, { p_work_order_id: workOrderId });
  if (context.delivery_status === 'sent') return { success: true, alreadySent: true, workOrderId };
  const cfg = config();
  try {
    const token = await graphToken();
    const subject = `Your Have Us Clean service is complete — ${context.service_title}`;
    const html = `<div style="font-family:Arial,sans-serif;color:#14201d;line-height:1.6"><h2>Service complete</h2><p>Hi ${escapeHtml(context.customer_name)},</p><p>Your Have Us Clean service has been completed.</p><p><strong>Service:</strong> ${escapeHtml(context.service_title)}<br><strong>Location:</strong> ${escapeHtml(context.address)}<br><strong>Completed:</strong> ${escapeHtml(context.completed_at)}</p><p>Thank you for choosing Have Us Clean.</p></div>`;
    const draft = await graph(`/users/${encodeURIComponent(cfg.senderEmail)}/messages`, token, { method: 'POST', body: JSON.stringify({
      subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: context.recipient_email } }],
      internetMessageHeaders: [{ name: 'X-HUC-Work-Order', value: workOrderId }, { name: 'X-HUC-Idempotency-Key', value: context.idempotency_key }],
    }) }, 'Microsoft 365 could not create the completion receipt');
    if (!draft?.id) throw new Error('Microsoft 365 returned no completion message ID');
    await graph(`/users/${encodeURIComponent(cfg.senderEmail)}/messages/${encodeURIComponent(draft.id)}/send`, token, { method: 'POST' }, 'Microsoft 365 did not accept the completion receipt');
    await rpc('record_customer_completion_receipt_result', bearer, { p_delivery_id: context.delivery_id, p_status: 'sent', p_provider_message_id: draft.id, p_failure_reason: null });
    return { success: true, alreadySent: false, workOrderId };
  } catch (error) {
    await rpc('record_customer_completion_receipt_result', bearer, { p_delivery_id: context.delivery_id, p_status: 'failed', p_provider_message_id: null, p_failure_reason: String(error.message || error) }).catch(() => null);
    throw error;
  }
}

export async function deliverOperationsCompletionAlert(workOrderId, bearer) {
  const context = await rpc('reserve_operations_completion_alert', bearer, { p_work_order_id: workOrderId });
  if (context.delivery_status === 'sent') return { success: true, alreadySent: true, workOrderId };
  const cfg = config();
  try {
    const token = await graphToken();
    const subject = `Job submitted for QA — ${context.service_title} · ${context.territory}`;
    const html = `<div style="font-family:Arial,sans-serif;color:#14201d;line-height:1.6"><h2>Cleaner completion submitted</h2><p>A cleaner has submitted a completed job for governed QA review.</p><p><strong>Customer:</strong> ${escapeHtml(context.customer_name)}<br><strong>Service:</strong> ${escapeHtml(context.service_title)}<br><strong>Territory:</strong> ${escapeHtml(context.territory)}<br><strong>Location:</strong> ${escapeHtml(context.address)}<br><strong>Completed:</strong> ${escapeHtml(context.completed_at)}<br><strong>Completion photos:</strong> ${escapeHtml(context.photo_count)}</p><p>Open the ServiceOS QA workspace to review, pass, fail, or waive the inspection.</p></div>`;
    const draft = await graph(`/users/${encodeURIComponent(cfg.senderEmail)}/messages`, token, { method: 'POST', body: JSON.stringify({
      subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: cfg.operationsEmail } }],
      internetMessageHeaders: [{ name: 'X-HUC-Work-Order', value: workOrderId }, { name: 'X-HUC-Idempotency-Key', value: context.idempotency_key }, { name: 'X-HUC-Notification', value: 'operations-job-completion' }],
    }) }, 'Microsoft 365 could not create the operations completion alert');
    if (!draft?.id) throw new Error('Microsoft 365 returned no operations completion message ID');
    await graph(`/users/${encodeURIComponent(cfg.senderEmail)}/messages/${encodeURIComponent(draft.id)}/send`, token, { method: 'POST' }, 'Microsoft 365 did not accept the operations completion alert');
    await rpc('record_operations_completion_alert_result', bearer, { p_delivery_id: context.delivery_id, p_status: 'sent', p_provider_message_id: draft.id, p_failure_reason: null });
    return { success: true, alreadySent: false, workOrderId };
  } catch (error) {
    await rpc('record_operations_completion_alert_result', bearer, { p_delivery_id: context.delivery_id, p_status: 'failed', p_provider_message_id: null, p_failure_reason: String(error.message || error) }).catch(() => null);
    throw error;
  }
}

export async function handleCustomerCompletionReceipt(req, res, bearer) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!bearer) return res.status(401).json({ error: 'Authentication required' });
  const workOrderId = String(req.body?.workOrderId || '').trim();
  if (!workOrderId) return res.status(400).json({ error: 'workOrderId is required' });
  return res.status(200).json(await deliverCustomerCompletionReceipt(workOrderId, bearer));
}
