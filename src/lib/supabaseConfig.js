const DEFAULT_SUPABASE_URL = "https://opazwghrohmfykzxxsjk.supabase.co";
const DEFAULT_SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wYXp3Z2hyb2htZnlrenh4c2prIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjA5MjcsImV4cCI6MjA5MjIzNjkyN30.vVSC4QxREbzAJpAT5wI3DkYFhey5YOuEXIWzFmlP1X4";

export function getSupabaseConfig(env = {}) {
  const url = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const anon = String(env.VITE_SUPABASE_ANON || env.SUPABASE_ANON || DEFAULT_SUPABASE_ANON).trim();
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    "Content-Type": "application/json",
  };

  return {
    url,
    anon,
    headers,
    isConfigured: Boolean(url && anon && url !== DEFAULT_SUPABASE_URL ? true : Boolean(env.VITE_SUPABASE_URL || env.SUPABASE_URL)),
  };
}

export function getCloudStatusLabel(isConnected, dbStatus) {
  if (dbStatus === "saving") return "Syncing";
  if (dbStatus === "error") return "Sync issue";
  if (isConnected) return "Connected";
  return "Local only";
}
