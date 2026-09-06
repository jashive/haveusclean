import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const portal = fs.readFileSync(new URL("../src/features/workforce/PublicApplicantPortal.jsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server-internal/workforce-compliance-dashboard-impl.js", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../src/features/workforce/WorkforceComplianceDashboard.jsx", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260904050000_public_applicant_portal_upload_boundary.sql", import.meta.url), "utf8");
const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const delivery = fs.readFileSync(new URL("../server-internal/intake-notification-delivery.js", import.meta.url), "utf8");

test("/apply is public and bypasses the ServiceOS authentication gate", () => {
  assert.match(main, /isPublicApplicantRequest/);
  assert.match(main, /path === "\/apply" \|\| path\.startsWith\("\/apply\/"\)/);
  assert.ok(main.indexOf("if (isPublicApplicantRequest())") < main.indexOf("return <ServiceOSAuthGate>"));
  assert.match(main, /<ApplyPage \/>/);
});

test("portal binds Ontario and Arizona to the seeded intake program codes", () => {
  assert.match(portal, /HUC_ON_RESIDENTIAL_CLEANER/);
  assert.match(portal, /HUC_AZ_RESIDENTIAL_CLEANER/);
  assert.match(portal, /WHMIS/);
  assert.match(portal, /1099 compliance/);
  for (const field of ["legalName", "email", "phone", "address", "experience", "availability"]) assert.match(portal, new RegExp(`name="${field}"`));
  assert.match(portal, /Privacy Notice v1\.0/);
  assert.match(portal, /Background Check Consent v1\.0/);
});

test("uploads use a signed private-storage flow and never expose Supabase secrets", () => {
  assert.match(portal, /action: "sign_upload"/);
  assert.match(portal, /method: "PUT"/);
  assert.match(portal, /action: "finalize_upload"/);
  assert.doesNotMatch(portal, /SERVICE_ROLE|SECRET_KEY|SUPABASE_URL|\.from\(/);
  assert.match(server, /object\/upload\/sign/);
  assert.match(server, /APPLICANT_BUCKET = "hems-hr-applicant-evidence"/);
  assert.match(server, /detectedMime/);
  assert.match(server, /createHash\("sha256"\)/);
});

test("Phase B presents a guided, accessible candidate journey with governed upload states", () => {
  for (const section of ["Application Intake", "Document Quarantine Vault", "Video Training Player", "Compliance Status"]) assert.match(portal, new RegExp(section, "i"));
  assert.match(portal, /onDragEnter/);
  assert.match(portal, /onDrop/);
  assert.match(portal, /Browse files/);
  for (const state of ["Empty", "Uploading", "Quarantined & verified", "Error \/ retry"]) assert.match(portal, new RegExp(state, "i"));
  assert.match(portal, /className="visually-hidden"[\s\S]+type="file"/);
});

test("early documents are quarantined and cannot bypass screening or activation", () => {
  assert.match(migration, /'quarantined'/);
  assert.match(migration, /Uploading does not advance screening/);
  assert.doesNotMatch(migration, /insert into public\.worker/i);
  assert.doesNotMatch(migration, /update hems_hr\.applicant_submission set current_stage/i);
  assert.match(dashboard, /Screening, training, and compliance approval are required first/);
});

test("Owner Admin applicant viewer receives sanitized metadata and two-minute signed reads", () => {
  assert.match(migration, /get_applicant_intake_inspector/);
  assert.match(migration, /dashboard_actor_can_view/);
  assert.match(migration, /revoke all on function %s from public,anon,authenticated/);
  assert.doesNotMatch(migration, /'access_token_hash'/);
  assert.doesNotMatch(migration, /'secure_file_reference'/);
  assert.match(server, /expiresIn: 120/);
  assert.match(dashboard, /Open restricted document \(2 min\)/);
});

test("Workforce routes stay consolidated under the existing staff-admin function", () => {
  const apiFiles = fs.readdirSync(new URL("../api", import.meta.url), { recursive: true })
    .filter((name) => String(name).endsWith(".js"));
  assert.equal(apiFiles.length, 12);
  assert.match(JSON.stringify(vercel.rewrites), /serviceos-staff-admin\?workforce=apply/);
  assert.match(JSON.stringify(vercel.rewrites), /serviceos-staff-admin\?workforce=dashboard/);
});

test("candidate sessions survive refresh and expose a private cross-device resume link", () => {
  assert.match(portal, /huc_applicant_session_v1/);
  assert.match(portal, /window\.localStorage\.setItem/);
  assert.match(portal, /window\.location\.hash/);
  assert.match(portal, /url\.hash = new URLSearchParams/);
  assert.match(portal, /Resume Onboarding/);
  assert.match(portal, /Private reference code/);
  assert.doesNotMatch(portal, /sessionStorage\.setItem/);
});

test("existing workforce handler sends the applicant resume link through Microsoft 365", () => {
  assert.match(server, /dispatchApplicantResumeEmail/);
  assert.match(server, /resumeEmailStatus/);
  assert.match(delivery, /export async function dispatchApplicantResumeEmail/);
  assert.match(delivery, /SERVICEOS_PUBLIC_URL/);
  assert.match(delivery, /url\.hash = new URLSearchParams/);
  assert.match(delivery, /applicant-resume-link/);
  assert.match(delivery, /Keep this link private/);
});

test("applicant resume delivery creates and sends a fragment-token link", async () => {
  const priorFetch = globalThis.fetch;
  const priorEnv = Object.fromEntries(["M365_TENANT_ID", "M365_CLIENT_ID", "M365_CLIENT_SECRET", "M365_SENDER_EMAIL", "SERVICEOS_PUBLIC_URL"].map((key) => [key, process.env[key]]));
  const requests = [];
  process.env.M365_TENANT_ID = "tenant";
  process.env.M365_CLIENT_ID = "client";
  process.env.M365_CLIENT_SECRET = "secret";
  process.env.M365_SENDER_EMAIL = "operations@haveusclean.example";
  process.env.SERVICEOS_PUBLIC_URL = "https://haveusclean.example";
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "graph-token" }), { status: 200 });
    if (String(url).endsWith("/messages")) return new Response(JSON.stringify({ id: "message-1" }), { status: 201 });
    return new Response(null, { status: 202 });
  };
  try {
    const { dispatchApplicantResumeEmail } = await import("../server-internal/intake-notification-delivery.js");
    const result = await dispatchApplicantResumeEmail({
      applicant: { applicantReference: "APP-AMEERA-TEST", applicantAccessToken: "private-token-12345678901234567890" },
      recipientEmail: "ameera.test@example.com",
      legalName: "Ameera Shivers",
      req: { headers: {} },
    });
    assert.equal(result.status, "sent");
    const payload = JSON.parse(requests.find((item) => item.url.endsWith("/messages")).options.body);
    assert.equal(payload.toRecipients[0].emailAddress.address, "ameera.test@example.com");
    assert.match(payload.body.content, /https:\/\/haveusclean\.example\/apply#ref=APP-AMEERA-TEST&amp;token=private-token/);
    assert.doesNotMatch(payload.body.content, /\/apply\?ref=/);
    assert.ok(requests.some((item) => item.url.endsWith("/messages/message-1/send")));
  } finally {
    globalThis.fetch = priorFetch;
    for (const [key, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
