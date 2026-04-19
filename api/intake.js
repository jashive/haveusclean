// api/intake.js — Receives new leads from Google Form via n8n
// Called by n8n HTTP Request node after mapping form fields
// Stores lead in a simple in-memory log (upgradeable to Supabase later)

// Simple in-memory store — persists within the same Vercel function instance
// For production persistence, upgrade to Supabase or KV store
let pendingLeads = [];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — receive new lead from n8n
  if (req.method === 'POST') {
    try {
      const lead = req.body;

      if (!lead.name && !lead.email) {
        return res.status(400).json({ error: 'Missing required fields: name or email' });
      }

      const newLead = {
        ...lead,
        id: Date.now(),
        status: lead.status || 'New',
        source: lead.source || 'Google Form',
        createdAt: lead.createdAt || new Date().toISOString(),
        workOrder: null,
        paymentConfirmed: false,
        quotedDate: '',
        bookedDate: '',
      };

      pendingLeads.push(newLead);

      console.log(`✅ New lead received: ${newLead.name} (${newLead.email}) — ${newLead.serviceType} in ${newLead.city}`);

      return res.status(200).json({
        success: true,
        leadId: newLead.id,
        message: `Lead created for ${newLead.name}`,
        lead: newLead,
      });

    } catch (err) {
      return res.status(500).json({ error: 'Failed to process lead', detail: err.message });
    }
  }

  // GET — retrieve pending leads (called by app on sync)
  if (req.method === 'GET') {
    const leads = [...pendingLeads];
    pendingLeads = []; // clear after retrieval
    return res.status(200).json({
      leads,
      count: leads.length,
      retrieved_at: new Date().toISOString(),
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
