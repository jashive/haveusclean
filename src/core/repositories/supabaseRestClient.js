import { getSupabaseConfig } from "../../lib/supabaseConfig";

const SUPABASE_CONFIG = getSupabaseConfig(typeof import.meta !== "undefined" ? import.meta.env : {});

const BASE_HEADERS = {
  apikey: SUPABASE_CONFIG.anon,
  Authorization: `Bearer ${SUPABASE_CONFIG.anon}`,
  "Content-Type": "application/json",
};

export async function supabaseRestFetch(path, opts = {}) {
  try {
    const method = String(opts.method || "GET").toUpperCase();
    const isWrite = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
    const { headers: optsHeaders, ...restOpts } = opts;

    const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${path}`, {
      ...restOpts,
      headers: {
        ...BASE_HEADERS,
        ...(isWrite ? { Prefer: "resolution=merge-duplicates,return=minimal" } : {}),
        ...(optsHeaders || {}),
      },
    });

    return response;
  } catch {
    return null;
  }
}
