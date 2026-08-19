const SUPABASE_HOST = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i;
export const PRODUCTION_SUPABASE_PROJECT_REF = "opazwghrohmfykzxxsjk";
export const ACCEPTANCE_SUPABASE_PROJECT_REF = "hqeamecwdsrjfjybrsox";

function serviceEnvironment(env) {
  return String(env.VITE_SERVICEOS_ENVIRONMENT || env.MODE || "development").toLowerCase();
}

function providerDeploymentKind(env) {
  // Vercel exposes VITE_VERCEL_ENV to Vite projects and VERCEL_ENV to server/build code.
  // Provider-reported deployment kind is intentionally independent of ServiceOS client flags.
  return String(env.VITE_VERCEL_ENV || env.VERCEL_ENV || "").trim().toLowerCase();
}

/** Resolve only explicit Supabase configuration. There is deliberately no URL/key fallback. */
export function getSupabaseConfig(env = {}) {
  const url = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const anon = String(env.VITE_SUPABASE_ANON || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON || env.SUPABASE_ANON_KEY || "").trim();
  const match = url.match(SUPABASE_HOST);
  const environment = serviceEnvironment(env);
  const providerEnvironment = providerDeploymentKind(env);
  if (!url && !anon) return { url: "", anon: "", projectRef: null, environment, providerEnvironment, headers: {}, isConfigured: false, isAcceptance: false };
  if (!url || !anon) throw new Error("Supabase URL and anonymous key must both be configured");
  if (!match) throw new Error("Supabase URL must be an HTTPS project URL");
  const projectRef = match[1].toLowerCase();

  if (providerEnvironment === "preview" && environment === "production") {
    throw new Error("Production ServiceOS configuration is forbidden in a provider-reported Preview deployment");
  }
  if (environment === "acceptance" && providerEnvironment && providerEnvironment !== "preview") {
    throw new Error("Acceptance ServiceOS configuration is allowed only in a provider-reported Preview deployment");
  }

  const productionApproved =
    environment === "production" &&
    providerEnvironment === "production" &&
    String(env.VITE_SERVICEOS_PRODUCTION_APPROVED).toLowerCase() === "true";
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF && !productionApproved) {
    throw new Error("Production Supabase is forbidden outside an explicitly approved provider-reported production deployment");
  }
  if (environment === "acceptance" && projectRef !== ACCEPTANCE_SUPABASE_PROJECT_REF) {
    throw new Error("Acceptance must target the approved acceptance project");
  }
  return {
    url, anon, projectRef, environment, providerEnvironment,
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
