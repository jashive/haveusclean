#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ACCEPTANCE_PROJECT_REF = "hqeamecwdsrjfjybrsox";
const PRODUCTION_PROJECT_REF = "opazwghrohmfykzxxsjk";
const DEFAULT_TIMEOUT_MS = Number(process.env.WAVE2_SMOKE_TIMEOUT_MS || 45000);
const BASE_URL = String(process.env.BASE_URL || process.env.WAVE2_BASE_URL || "").replace(/\/$/, "");
const PREVIEW_ACCESS_URL = String(process.env.SERVICEOS_OAT_PREVIEW_ACCESS_URL || "").trim();

const credentials = {
  owner_admin: {
    email: String(process.env.SERVICEOS_OAT_OWNER_EMAIL || ""),
    password: String(process.env.SERVICEOS_OAT_OWNER_PASSWORD || ""),
  },
  office_ops: {
    email: String(process.env.SERVICEOS_OAT_OFFICE_EMAIL || ""),
    password: String(process.env.SERVICEOS_OAT_OFFICE_PASSWORD || ""),
  },
  worker: {
    email: String(process.env.SERVICEOS_OAT_WORKER_EMAIL || ""),
    password: String(process.env.SERVICEOS_OAT_WORKER_PASSWORD || ""),
  },
  qa: {
    email: String(process.env.SERVICEOS_OAT_QA_EMAIL || ""),
    password: String(process.env.SERVICEOS_OAT_QA_PASSWORD || ""),
  },
};

function redact(value) {
  let message = value instanceof Error ? value.stack || value.message : String(value ?? "");
  for (const credential of Object.values(credentials)) {
    for (const secret of [credential.email, credential.password]) {
      if (secret) message = message.split(secret).join("[REDACTED]");
    }
  }
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|access_token|refresh_token|apikey|api_key|key|password|secret)=)[^&#\s"'<>]*/gi, "$1[REDACTED]");
}

function validateEnvironment() {
  assert(BASE_URL, "BASE_URL or WAVE2_BASE_URL is required");
  const target = new URL(BASE_URL);
  assert.equal(target.protocol, "https:", "Wave 2 smoke target must use HTTPS");
  assert.notEqual(target.hostname, "haveusclean.com", "Synthetic Wave 2 mutations are prohibited on Production haveusclean.com");
  assert.notEqual(target.hostname, "www.haveusclean.com", "Synthetic Wave 2 mutations are prohibited on Production www.haveusclean.com");
  assert.equal(
    process.env.SERVICEOS_ACCEPTANCE_MUTATIONS_APPROVED,
    "true",
    "SERVICEOS_ACCEPTANCE_MUTATIONS_APPROVED=true is required for synthetic lifecycle mutations",
  );

  const missing = [];
  for (const [role, credential] of Object.entries(credentials)) {
    if (!credential.email) missing.push(`${role} email`);
    if (!credential.password) missing.push(`${role} password`);
  }
  assert.equal(missing.length, 0, `Missing protected test credentials: ${missing.join(", ")}`);
}

function attachObservability(page, label, evidence) {
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push({ label, message: redact(message.text()) });
  });
  page.on("pageerror", (error) => {
    evidence.pageErrors.push({ label, message: redact(error) });
  });
  page.on("response", (response) => {
    if (response.status() === 404) evidence.network404s.push({ label, url: redact(response.url()) });
  });
}

function attachNetworkGuard(page, evidence) {
  void page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes(PRODUCTION_PROJECT_REF)) {
      evidence.productionTraffic.push(redact(url));
      await route.abort("blockedbyclient");
      return;
    }
    if (url.includes(`${ACCEPTANCE_PROJECT_REF}.supabase.co`)) evidence.acceptanceTraffic = true;
    await route.continue();
  });
}

async function establishAccess(page) {
  if (PREVIEW_ACCESS_URL) {
    await page.goto(PREVIEW_ACCESS_URL, { waitUntil: "networkidle", timeout: DEFAULT_TIMEOUT_MS });
  }
  const response = await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
  assert(response, "No response from Wave 2 smoke target");
  assert.equal(response.status(), 200, `Expected HTTP 200 from ${BASE_URL}; received ${response.status()}`);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

async function login(page, credential, expectedRole) {
  await page.locator("#sos-email").waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });
  await page.locator("#sos-email").fill(credential.email);
  await page.locator("#sos-password").fill(credential.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.locator(`[data-revenue-authorized]`).waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });
  await page.getByText(expectedRole, { exact: true }).waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });
}

async function logout(page) {
  const button = page.getByRole("button", { name: /log out of serviceos/i });
  await button.click();
  await page.locator("#sos-email").waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });
}

async function runRoleVisibility(browser, role, expectedRoleCode, shouldSeeRevenue, evidence) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  attachObservability(page, role, evidence);
  attachNetworkGuard(page, evidence);
  try {
    await establishAccess(page);
    await login(page, credentials[role], expectedRoleCode);
    const revenuePanel = page.locator('[data-testid="wave2-revenue-pilot"]');
    assert.equal(await revenuePanel.count(), shouldSeeRevenue ? 1 : 0, `${role} Revenue visibility mismatch`);
    const runButton = page.locator('[data-testid="wave2-run-pilot"]');
    assert.equal(await runButton.count(), shouldSeeRevenue ? 1 : 0, `${role} Revenue management control mismatch`);
    if (!shouldSeeRevenue) {
      assert.equal(await page.locator('[data-revenue-authorized="true"]').count(), 0, `${role} was marked Revenue-authorized`);
    }
    await logout(page);
    return { role, status: "PASS", revenueVisible: shouldSeeRevenue };
  } finally {
    await context.close();
  }
}

async function runOwnerLifecycle(browser, evidence) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  attachObservability(page, "owner-lifecycle", evidence);
  attachNetworkGuard(page, evidence);
  let cleanupAttempted = false;

  try {
    await establishAccess(page);
    await login(page, credentials.owner_admin, "owner_admin");
    const panel = page.locator('[data-testid="wave2-revenue-pilot"]');
    await panel.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });

    const runButton = page.locator('[data-testid="wave2-run-pilot"]');
    assert.equal(await runButton.isEnabled(), true, "Owner Revenue pilot Run button is disabled");
    await runButton.click();

    await page.getByText("Pipeline complete — conversion_record created, Wave 3 job_handoff boundary set", { exact: true })
      .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });

    const summary = await page.locator('[data-testid="wave2-created-summary"]').innerText();
    assert.match(summary, /service request/i, "Synthetic lifecycle did not create a service request");
    assert.match(summary, /quote/i, "Synthetic lifecycle did not create a quote");
    assert.match(summary, /job handoff/i, "Synthetic lifecycle did not reach job handoff");

    const cleanup = page.locator('[data-testid="wave2-cleanup-pilot"]');
    assert.equal(await cleanup.isEnabled(), true, "Cleanup control did not enable after lifecycle completion");
    cleanupAttempted = true;
    await cleanup.click();
    await page.getByText("Pilot records cleaned up", { exact: true }).waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });
    assert.equal(await page.locator('[data-testid="wave2-created-summary"]').count(), 0, "Synthetic records remained in UI after cleanup");

    await logout(page);
    return {
      role: "owner_admin",
      status: "PASS",
      serviceRequestToQuoteToJobHandoff: "PASS",
      cleanup: "PASS",
    };
  } catch (error) {
    if (!cleanupAttempted) {
      const cleanup = page.locator('[data-testid="wave2-cleanup-pilot"]');
      if ((await cleanup.count()) === 1 && (await cleanup.isEnabled().catch(() => false))) {
        cleanupAttempted = true;
        await cleanup.click().catch(() => {});
        await page.getByText("Pilot records cleaned up", { exact: true }).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
      }
    }
    throw error;
  } finally {
    await context.close();
  }
}

async function run() {
  validateEnvironment();
  const evidence = {
    consoleErrors: [],
    pageErrors: [],
    network404s: [],
    productionTraffic: [],
    acceptanceTraffic: false,
  };
  const browser = await chromium.launch({ headless: true });

  try {
    const roleChecks = [];
    roleChecks.push(await runRoleVisibility(browser, "office_ops", "office_ops", true, evidence));
    roleChecks.push(await runRoleVisibility(browser, "worker", "worker", false, evidence));
    roleChecks.push(await runRoleVisibility(browser, "qa", "qa", false, evidence));
    const ownerLifecycle = await runOwnerLifecycle(browser, evidence);

    assert.equal(evidence.productionTraffic.length, 0, "Production Supabase traffic was attempted");
    assert.equal(evidence.acceptanceTraffic, true, "Acceptance Supabase traffic was not observed");
    assert.equal(
      evidence.consoleErrors.length,
      0,
      `Console errors detected:\n${evidence.consoleErrors.map((item) => `- ${item.label}: ${item.message}`).join("\n")}`,
    );
    assert.equal(
      evidence.pageErrors.length,
      0,
      `Page errors detected:\n${evidence.pageErrors.map((item) => `- ${item.label}: ${item.message}`).join("\n")}`,
    );
    assert.equal(
      evidence.network404s.length,
      0,
      `Network 404s detected:\n${evidence.network404s.map((item) => `- ${item.label}: ${item.url}`).join("\n")}`,
    );

    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      mode: "wave2-acceptance-automated",
      baseUrl: new URL(BASE_URL).origin,
      checks: {
        ownerRevenueVisible: true,
        officeOpsRevenueVisible: true,
        workerRevenueBlocked: true,
        qaRevenueBlocked: true,
        consoleErrors: 0,
        pageErrors: 0,
        network404s: 0,
        productionSupabaseTraffic: 0,
        acceptanceSupabaseObserved: true,
        syntheticLifecycle: ownerLifecycle.serviceRequestToQuoteToJobHandoff,
        cleanup: ownerLifecycle.cleanup,
      },
      roles: roleChecks,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  process.stderr.write(`Wave 2 Revenue smoke failed: ${redact(error)}\n`);
  process.exitCode = 1;
});
