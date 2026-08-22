// Supabase opaque secret-key compatibility for server-only requests.
// Modern sb_secret_* keys belong in the `apikey` header and are not JWTs.
// The legacy service_role JWT remains valid as Authorization: Bearer <jwt>.
//
// This shim is intentionally narrow: it only removes Authorization when the
// request also carries the exact same modern sb_secret_* value as `apikey`.
// User JWT bearer headers and legacy service_role JWT calls are untouched.

const FETCH_COMPAT_MARK = Symbol.for("serviceos.supabaseSecretKeyFetchCompat");

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) || "";
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => String(key).toLowerCase() === name.toLowerCase());
    return match ? String(match[1] || "") : "";
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return String(value || "");
  }
  return "";
}

function withoutAuthorization(headers) {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const next = new Headers(headers);
    next.delete("authorization");
    return next;
  }
  if (Array.isArray(headers)) {
    return headers.filter(([key]) => String(key).toLowerCase() !== "authorization");
  }
  const next = { ...(headers || {}) };
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "authorization") delete next[key];
  }
  return next;
}

export function preferModernSupabaseSecret(env = process.env) {
  const modern = String(env.SUPABASE_SECRET_KEY || "").trim();
  if (!modern) return false;

  // Staff Admin's older env reader checks SUPABASE_SERVICE_ROLE_KEY first.
  // Promote the modern secret into that compatibility slot so a stale legacy
  // service-role JWT can never override an explicitly configured secret key.
  env.SUPABASE_SERVICE_ROLE_KEY = modern;
  return true;
}

export function normalizeSupabaseSecretKeyHeaders(init = {}) {
  const apikey = headerValue(init.headers, "apikey").trim();
  const authorization = headerValue(init.headers, "authorization").trim();
  const isOpaqueSecret = apikey.startsWith("sb_secret_");
  const duplicatesSecretAsBearer = authorization === `Bearer ${apikey}`;

  if (!isOpaqueSecret || !duplicatesSecretAsBearer) return init;
  return { ...init, headers: withoutAuthorization(init.headers) };
}

export function installSupabaseSecretKeyFetchCompat() {
  preferModernSupabaseSecret();
  if (globalThis[FETCH_COMPAT_MARK]) return;
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return;

  globalThis.fetch = function serviceosSupabaseCompatibleFetch(input, init) {
    return originalFetch.call(this, input, normalizeSupabaseSecretKeyHeaders(init || {}));
  };
  globalThis[FETCH_COMPAT_MARK] = true;
}

installSupabaseSecretKeyFetchCompat();
