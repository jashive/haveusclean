import { supabaseRestFetch } from "./supabaseRestClient";

const PARTNER_PROGRESS_TABLE = "partner_progress";

export async function completePartnerModule(partnerId, moduleId, completedAt = new Date().toISOString()) {
  if (!partnerId || !moduleId) return false;

  try {
    const response = await supabaseRestFetch(`${PARTNER_PROGRESS_TABLE}?on_conflict=partner_id,module_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        partner_id: String(partnerId),
        module_id: String(moduleId),
        completed_at: completedAt,
      }),
    });
    return Boolean(response && response.ok);
  } catch {
    return false;
  }
}