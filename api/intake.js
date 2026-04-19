// api/intake.js — Receives leads from Google Form via n8n
// Uses /tmp file storage to persist between serverless function calls
// For production scale, upgrade to Vercel KV or Supabase

import { readFileSync, writeFileSync, existsSync } from 'fs';

const LEADS_FILE = '/tmp/huc_pending_leads.json';

function readLeads() {
  try {
    if (existsSync(LEADS_FILE)) {
      return JSON.parse(readFileSync(LEADS_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

function writeLeads(leads) {
  try {
    writeFileSync(LEADS_FILE, JSON.stringify(leads), 'utf8');
  } catch (err) {
    console.error('Failed to write leads:', err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — receive new lead from n8n
  if (req.method === 'POST') {
    try {
      const lead = req.body;
      if (!lead || (!lead.name && !lead.email)) {
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

      const existing = readLeads();
      existing.push(newLead);
      writeLeads(existing);

      console.log(`✅ Lead saved: ${newLead.name} (${newLead.email}) — ${newLead.serviceType}`);

      return res.status(200).json({
        success: true,
        leadId: newLead.id,
        message: `Lead saved for ${newLead.name}`,
        pending_count: existing.length,
      });

    } catch (err) {
      return res.status(500).json({ error: 'Failed to save lead', detail: err.message });
    }
  }

  // GET — retrieve and clear pending leads (called by app every 5 min)
  if (req.method === 'GET') {
    try {
      const leads = readLeads();
      writeLeads([]); // clear after retrieval
      return res.status(200).json({
        leads,
        count: leads.length,
        retrieved_at: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read leads', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
