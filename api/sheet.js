// api/sheet.js — Reads Google Sheet using public CSV export
// NO API KEY NEEDED — just requires sheet to be shared "Anyone with the link can view"
// This uses Google's built-in CSV export which works on any public sheet

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SHEET_ID  = '1OwEbttCZsLhwV7wTMiF5LqnypiUshQ9r6tw1vhQPFiM';
  const SHEET_GID = '0'; // gid=0 is the first tab (Leads)

  try {
    // Use Google Sheets public CSV export — no API key, no OAuth, just works
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
    
    const sheetRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HaveUsClean/1.0)',
      }
    });

    if (!sheetRes.ok) {
      return res.status(400).json({
        error: `Sheet export failed: ${sheetRes.status} ${sheetRes.statusText}`,
        help: 'Make sure your Google Sheet is shared as "Anyone with the link can view". Open the sheet → Share → Change to Anyone with the link → Viewer → Done.'
      });
    }

    const csv = await sheetRes.text();
    
    if (!csv || csv.trim() === '') {
      return res.status(200).json({ leads: [], count: 0, synced_at: new Date().toISOString() });
    }

    // Parse CSV manually (handles quoted fields with commas inside)
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    };

    const rows = csv.split('\n').filter(r => r.trim());
    if (rows.length < 2) {
      return res.status(200).json({ leads: [], count: 0, synced_at: new Date().toISOString() });
    }

    const headers = parseCSVLine(rows[0]);
    const EXCLUDE = ['output']; // skip raw n8n pipeline column

    const leads = rows.slice(1).map(row => {
      const values = parseCSVLine(row);
      const obj = {};
      headers.forEach((h, i) => {
        const key = h.trim().toLowerCase().replace(/\s+/g, '_');
        if (EXCLUDE.includes(key)) return;
        obj[key] = values[i] || '';
      });

      // Normalize priority_score to number
      if (obj.priority_score) obj.priority_score = parseInt(obj.priority_score) || 3;

      // Detect and flag placeholder content from n8n generic templates
      const PLACEHOLDERS = ['[City]', '[Your Name]', '[Name]', '[your name]', '[city]'];
      const hasPlaceholder = (s) => PLACEHOLDERS.some(p => (s || '').includes(p));

      if (hasPlaceholder(obj.cold_email) || hasPlaceholder(obj.follow_up_email) ||
          hasPlaceholder(obj.linkedin_note) || hasPlaceholder(obj.call_opener)) {
        obj.needs_upgrade = true;
        if (hasPlaceholder(obj.cold_email))      obj.cold_email      = '';
        if (hasPlaceholder(obj.follow_up_email)) obj.follow_up_email = '';
        if (hasPlaceholder(obj.linkedin_note))   obj.linkedin_note   = '';
        if (hasPlaceholder(obj.call_opener))     obj.call_opener     = '';
      }

      // Defaults
      if (!obj.status) obj.status = 'New';
      if (!obj.owner)  obj.owner  = 'Jason';

      return obj;
    }).filter(l => l.lead_id && l.lead_id.trim() !== '');

    return res.status(200).json({
      leads,
      count: leads.length,
      synced_at: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ 
      error: 'Sheet read failed', 
      detail: err.message,
      help: 'Make sure the Google Sheet is shared as "Anyone with the link can view"'
    });
  }
}
