import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ACCEPTANCE_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  redactHostedOatError,
  validateHostedOatEnvironment,
} from "../scripts/serviceos-hosted-oat.mjs";

const source = fs.readFileSync("scripts/serviceos-hosted-oat.mjs", "utf8");
const complete = {
  BASE_URL: "https://preview-base.vercel.app",
  SERVICEOS_OAT_OWNER_EMAIL: "owner@example.test", SERVICEOS_OAT_OWNER_PASSWORD: "secret",
  SERVICEOS_OAT_OFFICE_EMAIL: "office@example.test", SERVICEOS_OAT_OFFICE_PASSWORD: "secret",
  SERVICEOS_OAT_WORKER_EMAIL: "worker@example.test", SERVICEOS_OAT_WORKER_PASSWORD: "secret",
  SERVICEOS_OAT_QA_EMAIL: "qa@example.test", SERVICEOS_OAT_QA_PASSWORD: "secret",
};

test("hosted OAT runner fails closed when required environment variables are absent", () => {
  assert.throws(() => validateHostedOatEnvironment({}), /missing required environment variables/);
  assert.throws(() => validateHostedOatEnvironment({ ...complete, SERVICEOS_OAT_QA_PASSWORD: "" }), /SERVICEOS_OAT_QA_PASSWORD/);
});

test("hosted OAT runner rejects non-HTTPS and production targets", () => {
  assert.throws(() => validateHostedOatEnvironment({ ...complete, BASE_URL: "http://preview.example.test" }), /HTTPS/);
  assert.throws(() => validateHostedOatEnvironment({ ...complete, BASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }), /production/);
});

test("protected Preview access URL is optional, HTTPS-only, and accepts Vercel alias pairs", () => {
  assert.equal(validateHostedOatEnvironment(complete).previewAccessUrl, "");
  const sameHost = validateHostedOatEnvironment({ ...complete, SERVICEOS_OAT_PREVIEW_ACCESS_URL: "https://preview-base.vercel.app/?_vercel_share=temporary" });
  assert.match(sameHost.previewAccessUrl, /_vercel_share=temporary/);
  const aliasPair = validateHostedOatEnvironment({ ...complete, SERVICEOS_OAT_PREVIEW_ACCESS_URL: "https://preview-protected.vercel.app/?_vercel_share=temporary" });
  assert.equal(aliasPair.baseUrl, "https://preview-protected.vercel.app");
  assert.throws(() => validateHostedOatEnvironment({ ...complete, SERVICEOS_OAT_PREVIEW_ACCESS_URL: "http://preview-base.vercel.app/?x=1" }), /HTTPS/);
});

test("protected Preview access URL still rejects unrelated non-Vercel hosts", () => {
  assert.throws(() => validateHostedOatEnvironment({
    ...complete,
    BASE_URL: "https://preview.example.test",
    SERVICEOS_OAT_PREVIEW_ACCESS_URL: "https://other.example.test/?x=1",
  }), /same host or another Vercel Preview alias/);
});

test("HTTPS certificate errors remain strict unless explicitly opted in", () => {
  assert.equal(validateHostedOatEnvironment(complete).ignoreHTTPSErrors, false);
  assert.equal(validateHostedOatEnvironment({ ...complete, SERVICEOS_OAT_IGNORE_HTTPS_ERRORS: "true" }).ignoreHTTPSErrors, true);
});

test("hosted OAT runner pins acceptance network traffic and never logs secrets", () => {
  assert.match(source, new RegExp(ACCEPTANCE_PROJECT_REF));
  assert.match(source, /supabase\.co/);
  assert.match(source, /route\.abort\("blockedbyclient"\)/);
  assert.match(source, /production Supabase traffic detected/);
  assert.doesNotMatch(source, /console\.log\(.*password|JSON\.stringify\(config/i);
});

test("hosted OAT runner establishes Preview access before canonical sign-in", () => {
  assert.match(source, /establishPreviewAccess/);
  assert.match(source, /SERVICEOS_OAT_PREVIEW_ACCESS_URL/);
  assert.match(source, /await establishPreviewAccess\(page, config\)/);
});

test("hosted OAT runner covers invalid login, four isolated roles, logout, and diagnostics denial", () => {
  assert.match(source, /runInvalidLogin/);
  assert.match(source, /const roles = \["owner", "office", "worker", "qa"\]/);
  assert.match(source, /for \(const role of roles\) results\.push\(await runRoleSmoke/);
  assert.match(source, /Sign Out/);
  assert.match(source, /Diagnostics unavailable/);
  assert.match(source, /legacy PIN security model is visible/);
});

test("failure evidence clears all credential inputs before screenshot", () => {
  assert.match(source, /evaluateAll\(\(nodes\)/);
  assert.match(source, /node\.value = ""/);
  assert.match(source, /await page\.screenshot/);
  assert.ok(source.indexOf("node.value = \"\"") < source.indexOf("await page.screenshot"));
});

test("hosted OAT redacts Preview access URLs, query credentials, and role credentials from errors", () => {
  const rawPreviewUrl = "https://preview-protected.vercel.app/path?_vercel_share=temporary-share-token&token=query-secret";
  const raw = `goto ${rawPreviewUrl} failed for owner@example.test using secret`;
  const redacted = redactHostedOatError(raw, [rawPreviewUrl, "owner@example.test", "secret"]);

  assert.doesNotMatch(redacted, /temporary-share-token/);
  assert.doesNotMatch(redacted, /query-secret/);
  assert.doesNotMatch(redacted, /owner@example\.test/);
  assert.doesNotMatch(redacted, /using secret/);
  assert.match(redacted, /\[REDACTED\]/);

  const queryOnly = redactHostedOatError("request failed: https://preview-protected.vercel.app/path?token=query-secret");
  assert.doesNotMatch(queryOnly, /query-secret/);
  assert.match(queryOnly, /https:\/\/preview-protected\.vercel\.app\/path\?\[REDACTED\]/);
});

test("role failures are collected across all four roles before hosted OAT fails", () => {
  assert.match(source, /reason: redactHostedOatError\(error, credentialValuesFromConfig\(config\)\)/);
  assert.match(source, /const failed = results\.filter/);
  assert.match(source, /failed\.map\(\(result\) => result\.role\)/);
});

test("terminal hosted OAT failures are sanitized before stderr output", () => {
  assert.match(source, /const reason = redactHostedOatError\(error, credentialValuesFromEnv\(process\.env\)\)/);
  assert.match(source, /ServiceOS hosted OAT failed: \$\{reason\}/);
});

test("hosted OAT detects explicit authentication rejection before workspace timeout", () => {
  assert.match(source, /waitForRoleOutcome/);
  assert.match(source, /auth-error/);
  assert.match(source, /authentication rejected/);
});
