// Canonical server-side ServiceOS environment / project isolation.
// Server-only. Never import this module into browser code.

export const ACCEPTANCE_SUPABASE_PROJECT_REF = "hqeamecwdsrjfjybrsox";
export const PRODUCTION_SUPABASE_PROJECT_REF = "opazwghrohmfykzxxsjk";

const KNOWN_ENVIRONMENTS = new Set(["preview", "test", "production"]);

export class ServiceosServerTargetError extends Error {
  constructor(message, { code = "SERVICEOS_SERVER_TARGET_INVALID", status = 403 } = {}) {
    super(message);
    this.name = "ServiceosServerTargetError";
    this.code = code;
    this.status = status;
  }
}

export function parseSupabaseProjectRef(rawUrl) {
  const value = String(rawUrl || "").trim();
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec(value);
  if (!match) return null;
  return match[1].toLowerCase();
}

export function requireServiceosServerTarget(env = process.env, options = {}) {
  const {
    allowProduction = true,
    allowNonProduction = true,
    requireProductionApproval = true,
  } = options;

  const environment = String(env.SERVICEOS_ENVIRONMENT || "").trim().toLowerCase();
  if (!KNOWN_ENVIRONMENTS.has(environment)) {
    throw new ServiceosServerTargetError(
      "SERVICEOS_ENVIRONMENT must be explicitly set to preview, test, or production.",
      { code: "SERVICEOS_ENVIRONMENT_INVALID", status: 503 }
    );
  }

  const supabaseUrl = String(env.SUPABASE_URL || "").trim();
  const projectRef = parseSupabaseProjectRef(supabaseUrl);
  if (!projectRef) {
    throw new ServiceosServerTargetError(
      "SUPABASE_URL must be an explicit canonical hosted Supabase project URL.",
      { code: "SERVICEOS_SUPABASE_URL_INVALID", status: 503 }
    );
  }

  const providerEnvironment = String(env.VERCEL_ENV || "").trim().toLowerCase() || null;
  const isProduction = environment === "production";

  if (isProduction) {
    if (!allowProduction) {
      throw new ServiceosServerTargetError("Production execution is prohibited for this ServiceOS endpoint.", {
        code: "SERVICEOS_PRODUCTION_PROHIBITED",
        status: 403,
      });
    }
    if (projectRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
      throw new ServiceosServerTargetError("Production ServiceOS may only target the canonical Production Supabase project.", {
        code: "SERVICEOS_PRODUCTION_PROJECT_MISMATCH",
        status: 403,
      });
    }
    if (providerEnvironment && providerEnvironment !== "production") {
      throw new ServiceosServerTargetError("A non-production Vercel deployment may not claim the ServiceOS production environment.", {
        code: "SERVICEOS_PROVIDER_ENVIRONMENT_MISMATCH",
        status: 403,
      });
    }
    if (requireProductionApproval && env.SERVICEOS_PRODUCTION_APPROVED !== "true") {
      throw new ServiceosServerTargetError("SERVICEOS_PRODUCTION_APPROVED=true is required for server-side Production ServiceOS execution.", {
        code: "SERVICEOS_PRODUCTION_APPROVAL_REQUIRED",
        status: 403,
      });
    }
  } else {
    if (!allowNonProduction) {
      throw new ServiceosServerTargetError("Preview/test execution is prohibited for this ServiceOS endpoint.", {
        code: "SERVICEOS_NONPRODUCTION_PROHIBITED",
        status: 403,
      });
    }
    if (projectRef !== ACCEPTANCE_SUPABASE_PROJECT_REF) {
      throw new ServiceosServerTargetError("Preview/test ServiceOS may only target the canonical Acceptance Supabase project.", {
        code: "SERVICEOS_ACCEPTANCE_PROJECT_MISMATCH",
        status: 403,
      });
    }
    if (providerEnvironment === "production") {
      throw new ServiceosServerTargetError("A Vercel Production deployment may not target the ServiceOS Acceptance project.", {
        code: "SERVICEOS_PROVIDER_ENVIRONMENT_MISMATCH",
        status: 403,
      });
    }
  }

  return Object.freeze({ environment, projectRef, supabaseUrl, providerEnvironment, isProduction });
}
