// api/intake.js — Reads new form leads directly from Google Form Responses sheet
// No storage needed — reads live from the sheet every time
// Sheet must be shared as "Anyone with the link can view"

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST from n8n — just acknowledge, no storage needed
  // n8n writes to Google Sheet directly, app reads from sheet
  if (req.method === 'POST') {
    return res.status(200).json({ success: true, message: 'Received — app reads from sheet directly' });
  }

  // GET — read form responses directly from Google Sheet CSV
  if (req.method === 'GET') {
    const SHEET_ID = process.env.FORM_SHEET_ID || '19qUwxHIkwkjqZA-mUS_PVPX39lm-fPe5-7PJ-KPFNhg';
    const GID      = process.env.FORM_SHEET_GID || '805502474';

    try {
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
      const r = await fetch(url);

      if (!r.ok) {
        return res.status(400).json({
          error: `Sheet read failed: ${r.status}`,
          help: 'Make sure the Form Responses sheet is shared as Anyone with the link can view'
        });
      }

      const csv = await r.text();
      if (!csv || csv.trim() === '') {
        return res.status(200).json({ leads: [], count: 0 });
      }

      // Parse CSV
      const parseCSVLine = (line) => {
        const result = [];
        let current = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
          } else if (ch === ',' && !inQuotes) {
            result.push(current.trim()); current = '';
          } else { current += ch; }
        }
        result.push(current.trim());
        return result;
      };

      const rows = csv.split('\n').filter(r => r.trim());
      if (rows.length < 2) return res.status(200).json({ leads: [], count: 0 });

      const headers = parseCSVLine(rows[0]);

      // Arizona cities for region detection
      const azCities = ["Scottsdale","Phoenix","Tempe","Chandler","Mesa","Gilbert","Glendale"];

      const packageMap = {
        "Refresh Clean — Regular upkeep, surfaces + floors ($140–$300)": "Refresh Clean",
        "Full Home Clean — Every room, top to bottom ($180–$400)": "Full Home Clean",
        "Deep Clean — First-time clean or heavy buildup ($250–$700+)": "Deep Clean",
        "Kitchen & Bathroom Refresh — Just the essentials, great entry price": "Kitchen & Bathroom Refresh",
        "Pre-Sale Clean — Show-ready presentation (quote on request)": "Pre-Sale Clean",
        "Move-In / Move-Out — Empty unit, full scrub ($300–$600+)": "Move-In / Move-Out",
        "Post-Renovation Clean — Construction dust + debris (quote on request)": "Post-Renovation Clean",
        "Office / Commercial — See commercial pricing (quote on request)": "Office / Commercial",
        "Not Sure — Please recommend based on my property": "Refresh Clean",
        "Partial Clean": "Refresh Clean",
      };

      const propMap = {
        "Apartment": "Apartment / Condo", "Condo": "Apartment / Condo",
        "Townhouse": "Semi / Townhouse", "Semi": "Semi / Townhouse",
        "Detached": "Detached House", "Office / Commercial": "Office / Commercial",
      };

      const leads = rows.slice(1).map((row, idx) => {
        const vals = parseCSVLine(row);
        const r = {};
        headers.forEach((h, i) => { r[h.trim()] = vals[i] || ''; });

        const city = r['City'] || '';
        const region = azCities.some(c => city.includes(c)) ? 'AZ' : 'ON';
        const pkg = r['Service Package'] || '';
        const serviceType = packageMap[pkg] || pkg.replace(/\s*[—–-].*$/, '').trim() || 'Refresh Clean';

        const addons = [];
        if (r['Inside Fridge'] === 'Y')           addons.push('fridge');
        if (r['Inside Oven'] === 'Y')             addons.push('oven');
        if (r['Inside Cabinets'] === 'Y')         addons.push('cabinets');
        if (r['Interior Windows'] === 'Y')        addons.push('windows');
        if (r['Baseboards / Detail'] === 'Y')     addons.push('baseboards');
        if (r['Carpet Cleaning'] === 'Y')         addons.push('carpet');
        if (r['Pet Hair / Heavy Detail'] === 'Y') addons.push('pethair');

        const notes = [
          r['Anything specific you\'d like us to focus on?'] || '',
          r['Access / Entry Notes'] ? `Access: ${r['Access / Entry Notes']}` : '',
          r['Parking Notes'] ? `Parking: ${r['Parking Notes']}` : '',
          r['Special Instructions'] ? `Special: ${r['Special Instructions']}` : '',
          r['Condition'] ? `Condition: ${r['Condition']}` : '',
        ].filter(Boolean).join(' | ');

        return {
          id: `form-${idx}-${Date.now()}`,
          name:          r['Customer Name'] || '',
          email:         r['Email'] || '',
          phone:         r['Phone'] || '',
          address:       r['Service Address'] || '',
          city,
          postalCode:    r['Postal Code'] || '',
          region,
          dwellingType:  propMap[r['Property Type']] || 'Apartment / Condo',
          sqft:          parseInt(r['Known Square Footage (Numeric Only)']) || 0,
          beds:          parseInt(r['Bedrooms']) || 0,
          baths:         parseInt(r['Full Bathrooms']) || 1,
          serviceType,
          frequency:     r['Frequency'] || 'One-Time',
          preferredDate: r['Preferred Service Date'] || '',
          preferredTime: r['Preferred Arrival Window'] || '',
          addons,
          notes,
          condition:     r['Condition']?.split('—')[0]?.trim() || 'Average',
          paymentPreference: r['Payment Preference'] || '',
          leadSource:    r['Lead Source - How did you hear about us?'] || '',
          timestamp:     r['Timestamp'] || '',
          status:        'New',
          source:        'Google Form',
          createdAt:     r['Timestamp'] ? new Date(r['Timestamp']).toISOString() : new Date().toISOString(),
          workOrder:     null,
          paymentConfirmed: false,
          quotedDate:    '',
          bookedDate:    '',
        };
      }).filter(l => l.name || l.email);

      return res.status(200).json({
        leads,
        count: leads.length,
        retrieved_at: new Date().toISOString(),
      });

    } catch (err) {
      return res.status(500).json({ error: 'Failed to read form sheet', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
