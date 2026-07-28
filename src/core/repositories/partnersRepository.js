import { supabaseRestFetch } from "./supabaseRestClient";

const PARTNERS_TABLE = "huc_partners";
const PARTNERS_FALLBACK_TABLE = "partners";

export async function patchPartnerPin(partner, newPin) {
  if (!partner?.id || !newPin) return false;

  const pid = encodeURIComponent(String(partner.id));

  try {
    const primary = await supabaseRestFetch(`${PARTNERS_TABLE}?id=eq.${pid}`, {
      method: "PATCH",
      body: JSON.stringify({
        data: { ...partner, pin: newPin },
        updated_at: new Date().toISOString(),
      }),
    });
    if (primary && primary.ok) return true;
  } catch {}

  try {
    const fallback = await supabaseRestFetch(`${PARTNERS_FALLBACK_TABLE}?id=eq.${pid}`, {
      method: "PATCH",
      body: JSON.stringify({ pin: newPin }),
    });
    return Boolean(fallback && fallback.ok);
  } catch {
    return false;
  }
}