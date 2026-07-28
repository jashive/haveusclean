import { supabaseRestFetch } from "./supabaseRestClient";

const COLD_LEADS_TABLE = "huc_leads_cold";

export async function fetchColdLeadRows() {
  try {
    const response = await supabaseRestFetch(`${COLD_LEADS_TABLE}?select=*`);
    if (!response || !response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function fetchColdLeadIndexRows() {
  try {
    const response = await supabaseRestFetch(`${COLD_LEADS_TABLE}?select=lead_id,data,updated_at`);
    if (!response || !response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function upsertColdLeadRows(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  try {
    const response = await supabaseRestFetch(`${COLD_LEADS_TABLE}?on_conflict=lead_id`, {
      method: "POST",
      body: JSON.stringify(rows),
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
    return Boolean(response && response.ok);
  } catch {
    return false;
  }
}

export async function patchColdLeadByLeadId(leadId, payload = {}) {
  const lid = String(leadId || "").trim();
  if (!lid) return false;
  try {
    const response = await supabaseRestFetch(`${COLD_LEADS_TABLE}?lead_id=eq.${encodeURIComponent(lid)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
    return Boolean(response && response.ok);
  } catch {
    return false;
  }
}

export async function deleteColdLeadByLeadId(leadId) {
  const lid = String(leadId || "").trim();
  if (!lid) return false;
  try {
    const response = await supabaseRestFetch(`${COLD_LEADS_TABLE}?lead_id=eq.${encodeURIComponent(lid)}`, { method: "DELETE" });
    return Boolean(response && response.ok);
  } catch {
    return false;
  }
}

export async function deleteColdLeadById(leadId) {
  const lid = String(leadId || "").trim();
  if (!lid) return false;
  try {
    const response = await supabaseRestFetch(`${COLD_LEADS_TABLE}?id=eq.${encodeURIComponent(lid)}`, { method: "DELETE" });
    return Boolean(response && response.ok);
  } catch {
    return false;
  }
}

export async function deleteColdLeadEverywhere(leadId) {
  const [byLeadIdOk, byIdOk] = await Promise.all([
    deleteColdLeadByLeadId(leadId),
    deleteColdLeadById(leadId),
  ]);
  return byLeadIdOk || byIdOk;
}
