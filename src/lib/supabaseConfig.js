const SUPABASE_HOST = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i;
export const PRODUCTION_SUPABASE_PROJECT_REF = "opazwghrohmfykzxxsjk";
export const ACCEPTANCE_SUPABASE_PROJECT_REF = "hqeamecwdsrjfjybrsox";

function deploymentKind(env) {
  return String(env.VITE_SERVICEOS_ENVIRONMENT || env.VERCEL_ENV || env.MODE || "development").toLowerCase();
}

/** Resolve only explicit Supabase configuration. There is deliberately no URL/key fallback. */
export function getSupabaseConfig(env = {}) {
  const url = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const anon = String(env.VITE_SUPABASE_ANON || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON || env.SUPABASE_ANON_KEY || "").trim();
  const match = url.match(SUPABASE_HOST);
  const environment = deploymentKind(env);
  if (!url && !anon) return { url: "", anon: "", projectRef: null, environment, headers: {}, isConfigured: false, isAcceptance: false };
  if (!url || !anon) throw new Error("Supabase URL and anonymous key must both be configured");
  if (!match) throw new Error("Supabase URL must be an HTTPS project URL");
  const projectRef = match[1].toLowerCase();
  const productionApproved = environment === "production" && String(env.VITE_SERVICEOS_PRODUCTION_APPROVED).toLowerCase() === "true";
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF && !productionApproved) throw new Error("Production Supabase is forbidden outside an explicitly approved production deployment");
  if (environment === "acceptance" && projectRef !== ACCEPTANCE_SUPABASE_PROJECT_REF) throw new Error("Acceptance must target the approved acceptance project");
  return {
    url, anon, projectRef, environment,
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    isConfigured: true,
    isAcceptance: projectRef === ACCEPTANCE_SUPABASE_PROJECT_REF,
  };
}

export function getCloudStatusLabel(isConnected, dbStatus) {
  if (dbStatus === "saving") return "Syncing";
  if (dbStatus === "error") return "Sync issue";
  if (isConnected) return "Connected";
  return "Local only";
}
