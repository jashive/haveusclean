import { supabaseRestFetch } from "./supabaseRestClient";

const RESIDENTIAL_LEADS_TABLE = "huc_leads_res";

export async function deleteResidentialLeadById(leadId) {
  const lid = String(leadId || "").trim();
  if (!lid) return false;

  try {
    const response = await supabaseRestFetch(`${RESIDENTIAL_LEADS_TABLE}?id=eq.${encodeURIComponent(lid)}`, {
      method: "DELETE",
    });
    return Boolean(response && response.ok);
  } catch {
    return false;
  }
}