import { validateLead } from '../../src/lib/leadValidation.js';

function parseCsvLine(line = '') {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current.trim());
  return result;
}

function normalizeLead(row = {}, headers = [], index = 0, start = 0) {
  const normalized = {};
  headers.forEach((header, headerIndex) => {
    const key = String(header || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) return;
    normalized[key] = row[headerIndex] || '';
  });

  const fallbackId = `lead-${start + index + 2}`;
  const leadId = String(normalized.lead_id || normalized.id || '').trim() || fallbackId;
  const id = String(normalized.id || normalized.lead_id || '').trim() || fallbackId;

  if (normalized.priority_score) {
    normalized.priority_score = Number.parseInt(normalized.priority_score, 10) || 3;
  }

  if (!normalized.status) normalized.status = 'New';
  if (!normalized.owner) normalized.owner = 'Jason';

  const placeholders = ['[City]', '[Your Name]', '[Name]', '[your name]', '[city]'];
  const hasPlaceholder = (value = '') => placeholders.some((placeholder) => String(value || '').includes(placeholder));

  if (hasPlaceholder(normalized.cold_email) || hasPlaceholder(normalized.follow_up_email) || hasPlaceholder(normalized.linkedin_note) || hasPlaceholder(normalized.call_opener)) {
    normalized.needs_upgrade = true;
    if (hasPlaceholder(normalized.cold_email)) normalized.cold_email = '';
    if (hasPlaceholder(normalized.follow_up_email)) normalized.follow_up_email = '';
    if (hasPlaceholder(normalized.linkedin_note)) normalized.linkedin_note = '';
    if (hasPlaceholder(normalized.call_opener)) normalized.call_opener = '';
  }

  return {
    ...normalized,
    lead_id: leadId,
    id,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sheetId = process.env.GOOGLE_SHEET_ID || process.env.SHEET_ID || '';
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_API_KEY || '';
  const start = Number.parseInt(req.query?.start || '0', 10) || 0;
  const limit = Number.parseInt(req.query?.limit || '2500', 10) || 2500;

  if (!sheetId || !apiKey) {
    return res.status(200).json({
      leads: [],
      count: 0,
      raw_count: 0,
      total_count: 0,
      invalid_count: 0,
      started_at: start,
      limit,
      has_more: false,
      synced_at: new Date().toISOString(),
      fallback: 'missing_env',
      message: 'Google Sheets API credentials are not configured yet.',
    });
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1?key=${encodeURIComponent(apiKey)}`;
    const sheetRes = await fetch(url);

    if (!sheetRes.ok) {
      const detail = await sheetRes.text().catch(() => '');
      return res.status(502).json({
        error: 'Google Sheets request failed',
        detail,
        help: 'Check your Google Sheets API key and sheet ID in Vercel environment variables.',
      });
    }

    const data = await sheetRes.json();
    const rows = Array.isArray(data?.values) ? data.values : [];

    if (!rows.length) {
      return res.status(200).json({
        leads: [],
        count: 0,
        raw_count: 0,
        total_count: 0,
        invalid_count: 0,
        started_at: start,
        limit,
        has_more: false,
        synced_at: new Date().toISOString(),
      });
    }

    const headers = rows[0].map((item) => String(item || '').trim());
    const rawRows = rows.slice(1);
    const totalRows = rawRows.length;
    const pageRows = rawRows.slice(start, start + limit);

    const leads = [];
    let invalidCount = 0;

    pageRows.forEach((row, rowIndex) => {
      const lead = normalizeLead(row, headers, rowIndex, start);
      const validation = validateLead(lead);
      if (!validation.valid) {
        invalidCount += 1;
        return;
      }
      leads.push(lead);
    });

    return res.status(200).json({
      leads,
      count: leads.length,
      raw_count: totalRows,
      total_count: totalRows,
      invalid_count: invalidCount,
      started_at: start,
      limit,
      has_more: start + limit < totalRows,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Sheet sync failed',
      detail: error.message,
      help: 'The server-side proxy could not reach Google Sheets. The client will fall back to cached leads.',
    });
  }
}
