#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export const ACCEPTANCE_PROJECT_REF = "hqeamecwdsrjfjybrsox";
export const PRODUCTION_PROJECT_REF = "opazwghrohmfykzxxsjk";
const roles = ["owner", "office", "worker", "qa"];

function isVercelHost(hostname) {
  return hostname.toLowerCase().endsWith(".vercel.app");
}

export function validateHostedOatEnvironment(env = process.env) {
  const credentialKey = (role, field) => `SERVICEOS_OAT_${role.toUpperCase()}_${field}`;
  const missing = ["BASE_URL", ...roles.flatMap((role) => [credentialKey(role, "EMAIL"), credentialKey(role, "PASSWORD")])]
    .filter((key) => !String(env[key] || "").trim());
  if (missing.length) throw new Error(`missing required environment variables: ${missing.join(", ")}`);

  const baseUrl = new URL(env.BASE_URL);
  const localAllowed = env.SERVICEOS_OAT_ALLOW_LOCALHOST === "true" && ["localhost", "127.0.0.1"].includes(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !localAllowed) throw new Error("BASE_URL must use HTTPS");
  if (baseUrl.href.includes(PRODUCTION_PROJECT_REF)) throw new Error("production Supabase target is prohibited");

  let previewAccessUrl = "";
  let appBaseUrl = baseUrl.href.replace(/\/$/, "");
  if (String(env.SERVICEOS_OAT_PREVIEW_ACCESS_URL || "").trim()) {
    const access = new URL(String(env.SERVICEOS_OAT_PREVIEW_ACCESS_URL).trim());
    if (access.protocol !== "https:") throw new Error("SERVICEOS_OAT_PREVIEW_ACCESS_URL must use HTTPS");
    const sameHost = access.hostname === baseUrl.hostname;
    const vercelAliasPair = isVercelHost(access.hostname) && isVercelHost(baseUrl.hostname);
    if (!sameHost && !vercelAliasPair) throw new Error("preview access URL must target the same host or another Vercel Preview alias");
    previewAccessUrl = access.href;
    appBaseUrl = access.origin;
  }

  return {
    baseUrl: appBaseUrl,
    previewAccessUrl,
    evidenceDir: String(env.SERVICEOS_OAT_EVIDENCE_DIR || "artifacts/serviceos-hosted-oat"),
    headless: env.SERVICEOS_OAT_HEADED !== "true",
    ignoreHTTPSErrors: env.SERVICEOS_OAT_IGNORE_HTTPS_ERRORS === "true",
    credentials: Object.fromEntries(roles.map((role) => [role, {
      email: String(env[credentialKey(role, "EMAIL")]),
      password: String(env[credentialKey(role, "PASSWORD")]),
    }])),
  };
}

function createNetworkGuard(page) {
  const state = { acceptanceObserved: false, productionObserved: false };
  void page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes(PRODUCTION_PROJECT_REF)) {
      state.productionObserved = true;
      await route.abort("blockedbyclient");
      return;
    }
    if (url.includes(`${ACCEPTANCE_PROJECT_REF}.supabase.co`)) state.acceptanceObserved = true;
    await route.continue();
  });
  return state;
}

async function establishPreviewAccess(page, config) {
  if (config.previewAccessUrl) await page.goto(config.previewAccessUrl, { waitUntil: "networkidle" });
  await page.goto(config.baseUrl, { waitUntil: "networkidle" });
}

export async function safeFailureScreenshot(page, path) {
  const fields = page.locator('input[type="password"], input[type="email"]');
  await fields.evaluateAll((nodes) => {
    for (const node of nodes) {
      node.value = "";
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }).catch(() => {});
  await page.screenshot({ path, fullPage: true });
}

async function expectCanonicalSignIn(page) {
  await page.locator("#sos-email").waitFor({ state: "visible" });
  await page.locator("#sos-password").waitFor({ state: "visible" });
  const body = await page.locator("body").innerText();
  if (/Select Portal|Admin PIN|Sales PIN|Partner PIN/.test(body)) throw new Error("legacy PIN security model is visible");
  if (/Dashboard|Operations Manager|My Schedule/.test(body)) throw new Error("workspace visible before authentication resolved");
}

async function login(page, credential) {
  await page.locator("#sos-email").fill(credential.email);
  await page.locator("#sos-password").fill(credential.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
}

async function runInvalidLogin(page, ownerCredential) {
  await login(page, { email: ownerCredential.email, password: `invalid-${crypto.randomUUID()}` });
  await page.locator("p").filter({ hasText: /invalid|failed|credentials/i }).waitFor({ state: "visible" });
  await expectCanonicalSignIn(page);
}

const roleExpectations = {
  owner: { label: "owner admin", diagnostics: true },
  office: { label: "office ops", diagnostics: false },
  worker: { label: "worker", diagnostics: false },
  qa: { label: "qa", diagnostics: false },
};

async function waitForRoleOutcome(page, role) {
  const workspace = page.getByText(roleExpectations[role].label, { exact: true });
  const authError = page.locator("p").filter({ hasText: /invalid|failed|credentials|password|sign-in/i });
  const outcome = await Promise.race([
    workspace.waitFor({ state: "visible", timeout: 15000 }).then(() => "workspace"),
    authError.waitFor({ state: "visible", timeout: 15000 }).then(() => "auth-error"),
  ]);
  if (outcome === "auth-error") throw new Error("authentication rejected");
}

async function runRoleSmoke(browser, config, role) {
  const context = await browser.newContext({ ignoreHTTPSErrors: config.ignoreHTTPSErrors });
  const page = await context.newPage();
  const network = createNetworkGuard(page);
  const evidencePath = `${config.evidenceDir}/${role}-failure.png`;
  try {
    await establishPreviewAccess(page, config);
    await expectCanonicalSignIn(page);
    await login(page, config.credentials[role]);
    await waitForRoleOutcome(page, role);
    if (network.productionObserved) throw new Error("production Supabase traffic detected");
    if (!network.acceptanceObserved) throw new Error("acceptance Supabase traffic was not observed");

    const diagnosticsLink = page.getByRole("link", { name: "Diagnostics", exact: true });
    if ((await diagnosticsLink.count()) !== (roleExpectations[role].diagnostics ? 1 : 0)) throw new Error(`diagnostics navigation mismatch for ${role}`);
    await page.goto(`${config.baseUrl}/serviceos-diagnostics`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    if (roleExpectations[role].diagnostics ? !body.includes("Choose a diagnostic surface") : !body.includes("Diagnostics unavailable")) {
      throw new Error(`diagnostics authorization mismatch for ${role}`);
    }
    await page.getByRole("button", { name: "Sign Out", exact: true }).click();
    await expectCanonicalSignIn(page);
    return { role, status: "PASS" };
  } catch (error) {
    await safeFailureScreenshot(page, evidencePath);
    return { role, status: "FAIL", reason: error.message, evidencePath };
  } finally {
    await context.close();
  }
}

export async function runHostedOat(env = process.env) {
  const config = validateHostedOatEnvironment(env);
  await mkdir(config.evidenceDir, { recursive: true });
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const invalidContext = await browser.newContext({ ignoreHTTPSErrors: config.ignoreHTTPSErrors });
    const invalidPage = await invalidContext.newPage();
    const invalidNetwork = createNetworkGuard(invalidPage);
    await establishPreviewAccess(invalidPage, config);
    await expectCanonicalSignIn(invalidPage);
    await runInvalidLogin(invalidPage, config.credentials.owner);
    if (invalidNetwork.productionObserved || !invalidNetwork.acceptanceObserved) throw new Error("invalid-login target verification failed");
    await invalidContext.close();

    const results = [];
    for (const role of roles) results.push(await runRoleSmoke(browser, config, role));
    const failed = results.filter((result) => result.status !== "PASS");
    const payload = { status: failed.length ? "FAIL" : "PASS", acceptanceProjectRef: ACCEPTANCE_PROJECT_REF, invalidLogin: "PASS", roles: results };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (failed.length) throw new Error(`hosted role acceptance failed for: ${failed.map((result) => result.role).join(", ")}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHostedOat().catch((error) => {
    process.stderr.write(`ServiceOS hosted OAT failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
