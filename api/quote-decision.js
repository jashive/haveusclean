function envConfig() {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(process.env.VITE_SUPABASE_ANON || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON || process.env.SUPABASE_ANON_KEY || '');
  if (!url || !anon) throw new Error('Quote response service is not configured');
  return { url, anon };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function rpc(name, payload) {
  const { url, anon } = envConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.error || 'Unable to process quote response');
  return data;
}

function page(content, status = 200) {
  return { status, html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Have Us Clean Quote</title></head><body style="margin:0;background:#f4f7f8;font-family:Arial,sans-serif;color:#17202a"><main style="max-width:680px;margin:0 auto;padding:24px"><header style="background:#102a26;color:white;padding:22px 24px;border-radius:12px 12px 0 0"><h1 style="margin:0;font-size:26px">Have Us Clean</h1><p style="margin:6px 0 0;color:#bfe9df">Quote Review</p></header><section style="background:white;border:1px solid #dce5e7;border-top:0;border-radius:0 0 12px 12px;padding:24px">${content}</section></main></body></html>` };
}

function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const params = new URLSearchParams(String(req.body || ''));
  return Object.fromEntries(params.entries());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const token = String(req.query?.token || '').trim();
      if (!token) {
        const result = page('<h2>Invalid quote link</h2><p>This link is missing its secure quote token.</p>', 400);
        return res.status(result.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(result.html);
      }
      const context = await rpc('get_public_quote_decision_context', { p_token: token });
      const quoteText = escapeHtml(context?.customer_facing_text || 'Your saved Have Us Clean quote is ready for review.');
      const existing = context?.decision;
      const existingMessage = existing === 'accepted'
        ? '<div style="background:#e9f8f4;border:1px solid #8bd7c5;padding:14px;border-radius:8px;margin:18px 0"><strong>Thank you — you accepted this quote.</strong><br>Have Us Clean will confirm the next scheduling step.</div>'
        : existing === 'requested_changes'
          ? '<div style="background:#fff7df;border:1px solid #e4bd5c;padding:14px;border-radius:8px;margin:18px 0"><strong>Your request for changes has been received.</strong><br>Have Us Clean will review it and send a revised quote if needed.</div>'
          : '';
      const actions = existing ? '' : `<form method="POST" action="/api/quote-decision" style="margin-top:22px"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" name="decision" value="accepted" style="border:0;border-radius:8px;background:#00a985;color:white;font-weight:700;padding:13px 18px;font-size:15px;cursor:pointer">Accept Quote</button><div style="margin-top:24px;border-top:1px solid #e3e8ea;padding-top:18px"><label for="notes" style="display:block;font-weight:700;margin-bottom:7px">Need a different scope or price point?</label><textarea id="notes" name="notes" rows="4" placeholder="Tell us what you would like changed, including your target budget if helpful." style="box-sizing:border-box;width:100%;padding:11px;border:1px solid #b7c2c7;border-radius:8px;font:inherit"></textarea><button type="submit" name="decision" value="requested_changes" style="margin-top:10px;border:1px solid #167a66;border-radius:8px;background:white;color:#126553;font-weight:700;padding:11px 16px;font-size:14px;cursor:pointer">Request Changes</button></div></form>`;
      const result = page(`<h2 style="margin-top:0">${escapeHtml(context?.title || 'Your cleaning quote')}</h2><div style="white-space:pre-wrap;line-height:1.65;background:#f8fafb;border:1px solid #e1e7e9;border-radius:8px;padding:16px">${quoteText}</div>${existingMessage}${actions}<p style="font-size:12px;color:#68777d;margin-top:24px">Your response applies only to this exact quote version. Requesting changes does not accept the quote or schedule a job.</p>`);
      return res.status(result.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(result.html);
    }

    if (req.method === 'POST') {
      const body = getBody(req);
      const token = String(body.token || '').trim();
      const decision = String(body.decision || '').trim();
      const notes = String(body.notes || '').trim().slice(0, 2000) || null;
      if (!token || !['accepted', 'requested_changes'].includes(decision)) {
        const result = page('<h2>Unable to record response</h2><p>The quote response was incomplete or invalid.</p>', 400);
        return res.status(result.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(result.html);
      }
      const recorded = await rpc('record_public_quote_decision', { p_token: token, p_decision: decision, p_notes: notes });
      const message = decision === 'accepted'
        ? '<h2>Quote accepted</h2><p>Thank you. Your decision has been securely recorded. Have Us Clean will confirm scheduling and next steps.</p>'
        : '<h2>Changes requested</h2><p>Thank you. Your request has been securely recorded. Have Us Clean will review your request and follow up with a revised quote when appropriate.</p>';
      const result = page(`${message}<p style="font-size:12px;color:#68777d">Reference: ${escapeHtml(recorded?.quote_version_id || '')}</p>`);
      return res.status(result.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(result.html);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Quote decision API error:', error);
    const result = page(`<h2>Unable to open this quote</h2><p>${escapeHtml(error.message || 'This quote link is invalid or expired.')}</p><p>Please contact Have Us Clean for assistance.</p>`, 400);
    return res.status(result.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(result.html);
  }
}
