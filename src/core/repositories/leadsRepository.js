import { supabaseRestFetch } from "./supabaseRestClient";

const LEADS_TABLE = "leads";

export async function patchLeadStatusByLeadId(leadId, payload = {}) {
  const lid = String(leadId || "").trim();
  if (!lid) return false;

  const patchOpts = {
    method: "PATCH",
    body: JSON.stringify(payload),
    headers: { Prefer: "return=minimal" },
  };

  try {
    const byLeadId = await supabaseRestFetch(`${LEADS_TABLE}?lead_id=eq.${encodeURIComponent(lid)}`, patchOpts);
    if (byLeadId && byLeadId.ok) return true;

    const byId = await supabaseRestFetch(`${LEADS_TABLE}?id=eq.${encodeURIComponent(lid)}`, patchOpts);
    return Boolean(byId && byId.ok);
  } catch {
    return false;
  }
}