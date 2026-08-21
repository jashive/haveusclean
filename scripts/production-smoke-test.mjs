#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = String(process.env.PRODUCTION_BASE_URL || "https://haveusclean.com").replace(/\/$/, "");
const NAVIGATION_TIMEOUT_MS = Number(process.env.PRODUCTION_SMOKE_TIMEOUT_MS || 45000);
const SETTLE_MS = Number(process.env.PRODUCTION_SMOKE_SETTLE_MS || 2500);

function formatConsoleMessage(message) {
  const location = message.location();
  const suffix = location?.url
    ? ` (${location.url}${location.lineNumber ? `:${location.lineNumber}` : ""}${location.columnNumber ? `:${location.columnNumber}` : ""})`
    : "";
  return `${message.text()}${suffix}`;
}

function attachRuntimeErrorCapture(page, label, runtimeErrors) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push({ type: "console", page: label, message: formatConsoleMessage(message) });
    }
  });

  page.on("pageerror", (error) => {
    runtimeErrors.push({ type: "pageerror", page: label, message: error?.stack || error?.message || String(error) });
  });

  page.on("crash", () => {
    runtimeErrors.push({ type: "crash", page: label, message: "Browser page crashed" });
  });
}

async function navigate(page, url) {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  assert(response, `No HTTP response received for ${url}`);

  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);

  return {
    requestedUrl: url,
    finalUrl: page.url(),
    status: response.status(),
  };
}

async function navigateAndRequire200(page, url) {
  const navigation = await navigate(page, url);
  assert.equal(navigation.status, 200, `Expected HTTP 200 for ${url}; received ${navigation.status}`);
  return navigation;
}

async function assertDarkModeHome(page) {
  const forbiddenSelectors = [
    "#sos-email",
    "#sos-password",
    '[data-testid="serviceos-diagnostics-workspace"]',
    'a[href^="/serviceos"]',
    'a[href*="/serviceos-"]',
  ];

  for (const selector of forbiddenSelectors) {
    const count = await page.locator(selector).count();
    assert.equal(count, 0, `Dark mode exposed ServiceOS selector ${selector} (${count} match(es))`);
  }

  const body = await page.locator("body").innerText();
  const forbiddenText = [
    /HaveUsClean\s*[—-]\s*Sign In/i,
    /ServiceOS Auth Pilot/i,
    /ServiceOS diagnostics/i,
    /Choose a diagnostic surface/i,
  ];

  for (const pattern of forbiddenText) {
    assert(!pattern.test(body), `Dark mode exposed ServiceOS UI text matching ${pattern}`);
  }
}

async function assertDiagnosticsHiddenOrFailClosed(context) {
  const page = await context.newPage();

  try {
    const navigation = await navigate(page, `${BASE_URL}/serviceos-diagnostics`);

    if (navigation.status === 404) {
      return { ...navigation, result: "hidden-404" };
    }

    assert.equal(
      navigation.status,
      200,
      `Expected ServiceOS diagnostics route to be hidden with 404 or fail closed with 200; received ${navigation.status}`,
    );

    assert.equal(
      await page.locator('[data-testid="serviceos-diagnostics-workspace"]').count(),
      0,
      "Dark mode exposed the ServiceOS diagnostics workspace",
    );
    assert.equal(await page.locator("#sos-email, #sos-password").count(), 0, "Dark mode exposed ServiceOS authentication controls");

    const body = await page.locator("body").innerText();
    assert(/Diagnostics unavailable/i.test(body), "Direct ServiceOS diagnostics route did not fail closed");
    assert(!/Choose a diagnostic surface/i.test(body), "Direct ServiceOS diagnostics route exposed an owner diagnostics surface");

    return { ...navigation, result: "fail-closed-200" };
  } finally {
    await page.close();
  }
}

async function run() {
  const parsedBaseUrl = new URL(BASE_URL);
  assert.equal(parsedBaseUrl.protocol, "https:", "Production smoke target must use HTTPS");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    serviceWorkers: "block",
  });
  const runtimeErrors = [];

  try {
    const page = await context.newPage();
    attachRuntimeErrorCapture(page, "home", runtimeErrors);

    const home = await navigateAndRequire200(page, BASE_URL);
    await assertDarkModeHome(page);
    await page.close();

    const diagnostics = await assertDiagnosticsHiddenOrFailClosed(context);

    assert.equal(
      runtimeErrors.length,
      0,
      `Runtime browser errors detected:\n${runtimeErrors.map((entry) => `- [${entry.type}] ${entry.page}: ${entry.message}`).join("\n")}`,
    );

    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      mode: "production-dark",
      baseUrl: BASE_URL,
      checks: {
        homeHttp200: home,
        runtimeBrowserErrors: 0,
        serviceosNavigationHidden: true,
        serviceosDiagnostics: diagnostics,
      },
    }, null, 2)}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  process.stderr.write(`Production smoke test failed: ${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
});
