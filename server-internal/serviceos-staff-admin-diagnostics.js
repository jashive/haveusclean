import { AsyncLocalStorage } from "node:async_hooks";

const diagnosticStorage = new AsyncLocalStorage();
const FETCH_PATCH_MARK = Symbol.for("serviceos.staffAdminDiagnosticFetchPatch");

function normalizeErrorBody(body) {
  if (!body || typeof body !== "object") {
    return {
      message: typeof body === "string" ? body : null,
      details: null,
      hint: null,
      code: null,
    };
  }

  return {
    message: body.message || body.msg || body.error_description || body.error || null,
    details: body.details ?? null,
    hint: body.hint ?? null,
    code: body.code ?? null,
  };
}

function installDiagnosticFetchPatch() {
  if (globalThis[FETCH_PATCH_MARK]) return;

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return;

  globalThis.fetch = async function serviceosDiagnosticFetch(input, init) {
    const response = await originalFetch.call(this, input, init);
    const store = diagnosticStorage.getStore();

    if (!store || response.ok) return response;

    const url = typeof input === "string" ? input : input?.url || "";
    if (!String(url).includes("/rest/v1/")) return response;

    try {
      const clone = response.clone();
      const text = await clone.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text || null;
      }

      const path = new URL(url).pathname.replace(/^\/rest\/v1\//, "");
      const table = path.split("?")[0].split("/")[0] || null;

      store.lastSupabaseFailure = {
        table,
        status: response.status,
        statusText: response.statusText || null,
        error: normalizeErrorBody(body),
      };
    } catch {
      // Diagnostic capture must never alter the application request path.
    }

    return response;
  };

  globalThis[FETCH_PATCH_MARK] = true;
}

installDiagnosticFetchPatch();

export async function runWithStaffAdminDiagnostics(req, res, operation) {
  const store = { lastSupabaseFailure: null };
  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    if (payload?.code === "STAFF_ADMIN_DATA_LOOKUP_FAILED" && store.lastSupabaseFailure) {
      const failure = store.lastSupabaseFailure;

      console.error("SERVICEOS_STAFF_ADMIN_SUPABASE_DIAGNOSTIC", {
        table: failure.table,
        status: failure.status,
        statusText: failure.statusText,
        message: failure.error?.message ?? null,
        details: failure.error?.details ?? null,
        hint: failure.error?.hint ?? null,
        code: failure.error?.code ?? null,
      });
    }

    return originalJson(payload);
  };

  return diagnosticStorage.run(store, operation);
}
