import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const main = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const portal = fs.readFileSync(new URL("../src/features/workforce/PublicApplicantPortal.jsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server-internal/workforce-compliance-dashboard-impl.js", import.meta.url), "utf8");
const dashboard = fs.readFileSync(new URL("../src/features/workforce/WorkforceComplianceDashboard.jsx", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260904050000_public_applicant_portal_upload_boundary.sql", import.meta.url), "utf8");
const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

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
