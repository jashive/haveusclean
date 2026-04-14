// api/sheet.js — Vercel serverless route to read n8n leads from Google Sheet
// Uses a simple API key — sheet must be shared as "Anyone with the link can view"
// Add GOOGLE_SHEETS_API_KEY to Vercel environment variables

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SHEET_ID  = '1OwEbttCZsLhwV7wTMiF5LqnypiUshQ9r6tw1vhQPFiM';
  const SHEET_TAB = 'Leads';
  const API_KEY   = process.env.GOOGLE_SHEETS_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: 'GOOGLE_SHEETS_API_KEY not configured',
      help: 'Add GOOGLE_SHEETS_API_KEY to Vercel → Settings → Environment Variables. Also make sure your Google Sheet is shared as Anyone with the link can view.'
    });
  }

  try {
    const range = encodeURIComponent(`${SHEET_TAB}!A1:Z2000`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY}`;

    const sheetRes = await fetch(url);
    const sheetData = await sheetRes.json();

    if (sheetData.error) {
      return res.status(400).json({
        error: sheetData.error.message,
        help: 'Make sure the sheet is shared as "Anyone with the link can view" and the Google Sheets API is enabled in your Google Cloud project.'
      });
    }

    if (!sheetData.values || sheetData.values.length < 2) {
      return res.status(200).json({ leads: [], count: 0, synced_at: new Date().toISOString() });
    }

    // Row 1 = headers, rows 2+ = data
    const [headers, ...rows] = sheetData.values;

    // Columns to exclude from the app (raw n8n pipeline data)
    const EXCLUDE_COLS = ['output'];

    const leads = rows
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => {
          const key = h.trim();
          if (EXCLUDE_COLS.includes(key)) return; // skip raw output column
          obj[key] = row[i] || '';
        });

        // Normalize types
        if (obj.priority_score) obj.priority_score = parseInt(obj.priority_score) || 3;

        // Strip placeholder text from outreach fields — marks them as needing upgrade
        const PLACEHOLDERS = ['[City]', '[Your Name]', '[Name]', '[your name]'];
        const hasPlaceholder = (str) => PLACEHOLDERS.some(p => str.includes(p));

        if (hasPlaceholder(obj.cold_email || '')) {
          obj.cold_email_raw = obj.cold_email; // keep original
          obj.cold_email = '';                  // clear so upgrade prompt shows
          obj.needs_upgrade = true;
        }
        if (hasPlaceholder(obj.follow_up_email || '')) {
          obj.follow_up_email = '';
          obj.needs_upgrade = true;
        }
        if (hasPlaceholder(obj.linkedin_note || '')) {
          obj.linkedin_note = '';
          obj.needs_upgrade = true;
        }
        if (hasPlaceholder(obj.call_opener || '')) {
          obj.call_opener = '';
          obj.needs_upgrade = true;
        }

        // Default status if empty
        if (!obj.status) obj.status = 'New';
        if (!obj.owner)  obj.owner  = 'Jason';

        return obj;
      })
      .filter(l => l.lead_id && l.lead_id.trim() !== ''); // skip empty rows

    return res.status(200).json({
      leads,
      count: leads.length,
      synced_at: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ error: 'Sheet read failed', detail: err.message });
  }
}
