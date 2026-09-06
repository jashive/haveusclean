function text(value) {
  return String(value ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function microsoft365Config() {
  const tenantId = text(process.env.M365_TENANT_ID);
  const clientId = text(process.env.M365_CLIENT_ID);
  const clientSecret = text(process.env.M365_CLIENT_SECRET);
  const senderEmail = text(process.env.M365_SENDER_EMAIL).toLowerCase();
  const operationsEmail = text(process.env.M365_OPERATIONS_EMAIL || senderEmail).toLowerCase();
  if (!tenantId || !clientId || !clientSecret || !senderEmail || !operationsEmail) {
    throw new Error('Have Us Clean Microsoft 365 intake delivery is not configured');
  }
  return { tenantId, clientId, clientSecret, senderEmail, operationsEmail };
}

async function parseResponse(response, fallback) {
  if (response.status === 202 || response.status === 204) return null;
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.error?.message || data?.message || fallback);
  return data;
}

async function graphToken(config) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await parseResponse(response, 'Microsoft 365 authentication failed');
  const token = text(data?.access_token);
  if (!token) throw new Error('Microsoft 365 authentication returned no access token');
  return token;
}

async function graphRequest(path, token, options, fallback) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  return { response, data: await parseResponse(response, fallback) };
}

function money(amount, currencyCode) {
  try {
    return new Intl.NumberFormat(currencyCode === 'CAD' ? 'en-CA' : 'en-US', {
      style: 'currency', currency: currencyCode,
    }).format(Number(amount || 0));
  } catch {
    return `${currencyCode} ${Number(amount || 0).toFixed(2)}`;
  }
}

function shell(content, eyebrow) {
  return `<!doctype html><html><body style="margin:0;background:#f7f9f8;font-family:Arial,sans-serif;color:#14201d"><div style="max-width:640px;margin:0 auto;padding:28px"><div style="background:#123d35;color:#fff;padding:22px 24px;border-radius:16px 16px 0 0"><h1 style="margin:0;font-size:25px">Have Us Clean</h1><p style="margin:6px 0 0;color:#ddf3ed">${escapeHtml(eyebrow)}</p></div><div style="background:#fff;padding:24px;border:1px solid #dee6e3;border-top:0;border-radius:0 0 16px 16px;line-height:1.55">${content}</div></div></body></html>`;
}

function row(label, value) {
  return `<tr><td style="padding:7px 12px 7px 0;color:#697773;vertical-align:top">${escapeHtml(label)}</td><td style="padding:7px 0;font-weight:700;vertical-align:top">${escapeHtml(value || '—')}</td></tr>`;
}

function customerMessage(intake) {
  const residential = intake.kind === 'residential';
  const heading = residential ? 'We received your cleaning request.' : 'We received your walkthrough request.';
  const timing = residential ? intake.requestedDate : intake.walkthroughDate;
  const window = residential ? intake.arrivalWindow : intake.walkthroughTimeWindow;
  const scopeRows = residential
    ? `${row('Service', intake.serviceLabel)}${row('Frequency', intake.frequencyLabel)}${row('Estimated subtotal', money(intake.subtotal, intake.currencyCode))}${row(intake.taxName || 'Tax', money(intake.taxAmount, intake.currencyCode))}${row('Estimated total', money(intake.total, intake.currencyCode))}`
    : `${row('Facility', intake.facilityType)}${row('Estimated size', `${intake.estimatedSquareFeet} sq. ft.`)}${row('Frequency', intake.frequencyLabel)}`;
  const notice = residential
    ? 'This is a requested appointment and governed estimate. Our team will confirm availability before the visit is scheduled.'
    : 'This request does not create an instant price or confirmed appointment. Our estimating team will contact you to confirm the walkthrough.';
  return {
    subject: residential ? 'We received your Have Us Clean booking request' : 'We received your Have Us Clean walkthrough request',
    templateKey: residential ? 'residential_booking_receipt' : 'commercial_walkthrough_receipt',
    html: shell(`<h2 style="margin-top:0">${escapeHtml(heading)}</h2><p>Hi ${escapeHtml(intake.contactName)},</p><p>Thank you for choosing Have Us Clean. Here is the request we received:</p><table style="width:100%;border-collapse:collapse;margin:18px 0">${row('Market', intake.market)}${row('Address', intake.address)}${row('Requested date', timing)}${row('Requested window', window)}${scopeRows}</table><div style="background:#f1faf7;border:1px solid #c8e8df;border-radius:10px;padding:14px">${escapeHtml(notice)}</div><p style="margin-bottom:0">Have Us Clean</p>`, residential ? 'Residential booking request' : 'Commercial walkthrough request'),
  };
}

function operationsMessage(intake) {
  const residential = intake.kind === 'residential';
  const heading = residential ? 'New residential booking follow-up' : 'New commercial walkthrough follow-up';
  const timing = residential ? intake.requestedDate : intake.walkthroughDate;
  const window = residential ? intake.arrivalWindow : intake.walkthroughTimeWindow;
  const scope = residential
    ? `${intake.serviceLabel}; ${intake.frequencyLabel}; ${money(intake.total, intake.currencyCode)} estimated total`
    : `${intake.facilityType}; ${intake.estimatedSquareFeet} sq. ft.; ${intake.frequencyLabel}`;
  return {
    subject: `[${intake.market}] ${heading} — ${intake.contactName}`,
    templateKey: residential ? 'residential_dispatch_alert' : 'commercial_dispatch_alert',
    html: shell(`<h2 style="margin-top:0">${escapeHtml(heading)}</h2><table style="width:100%;border-collapse:collapse;margin:18px 0">${row('Market', intake.market)}${row('Customer', intake.contactName)}${row('Email', intake.customerEmail)}${row('Phone', intake.phone)}${row('Address', intake.address)}${row('Requested date', timing)}${row('Requested window', window)}${row('Scope', scope)}${row('Notes', intake.notes)}</table><div style="background:#fff3d6;border:1px solid #ebcf8a;border-radius:10px;padding:14px"><strong>Next action:</strong> Open Revenue → Recent Saved Leads, contact the customer, and confirm the requested slot.</div>`, 'ServiceOS intake alert'),
  };
}

async function deliverOne({ intake, audience, recipientEmail, message, config, tokenPromise, callRpc }) {
  const idempotencyKey = `${intake.submissionKey}:${audience}:${message.templateKey}:v1`;
  let reservation = null;
  try {
    reservation = await callRpc('reserve_intake_notification_delivery', {
      p_service_request_id: intake.serviceRequestId,
      p_audience: audience,
      p_recipient_email: recipientEmail,
      p_template_key: message.templateKey,
      p_template_version: '1.0',
      p_idempotency_key: idempotencyKey,
    });
    if (reservation?.should_send === false) {
      return { audience, status: reservation.delivery_status || 'sent', alreadySent: true };
    }

    const graphAccessToken = await tokenPromise;
    const mailboxPath = `/users/${encodeURIComponent(config.senderEmail)}`;
    const draftPayload = {
      subject: message.subject,
      body: { contentType: 'HTML', content: message.html },
      toRecipients: [{ emailAddress: { address: recipientEmail } }],
      internetMessageHeaders: [
        { name: 'X-HUC-Intake-Kind', value: intake.kind },
        { name: 'X-HUC-Intake-Audience', value: audience },
      ],
    };
    const { data: draft } = await graphRequest(`${mailboxPath}/messages`, graphAccessToken, {
      method: 'POST', body: JSON.stringify(draftPayload),
    }, 'Microsoft 365 could not create the intake email');
    const providerMessageId = text(draft?.id);
    if (!providerMessageId) throw new Error('Microsoft 365 returned no intake message ID');
    const { response } = await graphRequest(`${mailboxPath}/messages/${encodeURIComponent(providerMessageId)}/send`, graphAccessToken, {
      method: 'POST',
    }, 'Microsoft 365 did not accept the intake email');
    if (response.status !== 202) throw new Error(`Microsoft 365 did not accept the intake email (HTTP ${response.status})`);

    await callRpc('complete_intake_notification_delivery', {
      p_delivery_id: reservation.delivery_id,
      p_delivery_status: 'sent',
      p_provider: 'microsoft_graph',
      p_provider_message_id: providerMessageId,
      p_failure_reason: null,
      p_metadata: { graph_send_status: response.status },
    });
    return { audience, status: 'sent', alreadySent: false };
  } catch (error) {
    if (reservation?.delivery_id) {
      await callRpc('complete_intake_notification_delivery', {
        p_delivery_id: reservation.delivery_id,
        p_delivery_status: 'failed',
        p_provider: 'microsoft_graph',
        p_provider_message_id: null,
        p_failure_reason: text(error?.message).slice(0, 1000) || 'Email delivery failed',
        p_metadata: {},
      }).catch(() => null);
    }
    console.error('Intake notification delivery failed', { audience, message: text(error?.message) });
    return { audience, status: 'failed', alreadySent: false };
  }
}

export async function dispatchIntakeNotifications({ intake, callRpc }) {
  let config;
  try { config = microsoft365Config(); }
  catch (error) {
    console.error('Intake notification configuration failed', { message: text(error?.message) });
    return { customer: 'failed', operations: 'failed' };
  }
  const tokenPromise = graphToken(config);
  const deliveries = await Promise.all([
    deliverOne({ intake, audience: 'customer', recipientEmail: intake.customerEmail, message: customerMessage(intake), config, tokenPromise, callRpc }),
    deliverOne({ intake, audience: 'operations', recipientEmail: config.operationsEmail, message: operationsMessage(intake), config, tokenPromise, callRpc }),
  ]);
  return Object.fromEntries(deliveries.map((item) => [item.audience, item.status]));
}
