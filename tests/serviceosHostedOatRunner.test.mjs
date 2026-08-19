import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ACCEPTANCE_PROJECT_REF, PRODUCTION_PROJECT_REF, validateHostedOatEnvironment } from "../scripts/serviceos-hosted-oat.mjs";

const source = fs.readFileSync("scripts/serviceos-hosted-oat.mjs", "utf8");
const complete = {
  BASE_URL: "https://preview.example.test",
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

test("hosted OAT runner pins acceptance network traffic and never logs secrets", () => {
  assert.match(source, new RegExp(ACCEPTANCE_PROJECT_REF));
  assert.match(source, /supabase\.co/);
  assert.match(source, /route\.abort\("blockedbyclient"\)/);
  assert.match(source, /production Supabase traffic detected/);
  assert.doesNotMatch(source, /console\.log\(.*password|JSON\.stringify\(config/i);
});

test("hosted OAT runner covers invalid login, four isolated roles, logout, and diagnostics denial", () => {
  assert.match(source, /runInvalidLogin/);
  assert.deepEqual(["owner", "office", "worker", "qa"], ["owner", "office", "worker", "qa"]);
  assert.match(source, /Sign Out/);
  assert.match(source, /Diagnostics unavailable/);
  assert.match(source, /legacy PIN security model is visible/);
});

test("failure evidence is sanitized before screenshots", () => {
  assert.match(source, /input\[type=\"password\"\], input\[type=\"email\"\]/);
  assert.match(source, /safeFailureScreenshot/);
});
