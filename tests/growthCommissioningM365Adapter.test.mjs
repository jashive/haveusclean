import test from "node:test";
import assert from "node:assert/strict";
import handler, { secretMatches } from "../server-internal/growth-instantly-webhook.js";

const SECRET = "0123456789abcdef0123456789abcdef";

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("webhook secrets require at least 256 bits and compare safely", () => {
  assert.equal(secretMatches(SECRET, SECRET), true);
  assert.equal(secretMatches(`${SECRET}x`, SECRET), false);
  assert.equal(secretMatches("short", "short"), false);
});

test("handler fails closed outside Acceptance", async () => {
  process.env.GROWTH_ENVIRONMENT = "production";
  const res = response();
  await handler({ method: "POST", headers: { "x-growth-webhook-secret": SECRET }, body: {} }, res);
  assert.equal(res.statusCode, 403);
});

test("handler rejects an invalid secret before persistence", async () => {
  process.env.GROWTH_ENVIRONMENT = "acceptance";
  process.env.GROWTH_WEBHOOK_SECRET = SECRET;
  const res = response();
  await handler({ method: "POST", headers: { "x-growth-webhook-secret": "wrong" }, body: {} }, res);
  assert.equal(res.statusCode, 401);
});

test("handler delegates atomic Instantly deduplication to the governed RPC", async () => {
  process.env.GROWTH_ENVIRONMENT = "acceptance";
  process.env.GROWTH_WEBHOOK_SECRET = SECRET;
  process.env.SUPABASE_URL = "https://acceptance.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-secret";
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return new Response(JSON.stringify("event-uuid"), { status: 200 }); };
  const body = { event_type: "email_sent", event_id: "evt-1", email_id: "msg-1", timestamp: "2026-09-09T00:00:00Z",
    growth_context: { organization_id: "org", business_unit_id: "bu", jurisdiction_id: "jur", outreach_attempt_id: "attempt" } };
  const res = response();
  try { await handler({ method: "POST", headers: { "x-growth-webhook-secret": SECRET }, body }, res); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(res.statusCode, 200);
  assert.match(request.url, /growth_g2_ingest_delivery_event$/);
  const rpc = JSON.parse(request.options.body);
  assert.equal(rpc.p_provider, "instantly");
  assert.equal(rpc.p_provider_event_id, "evt-1");
  assert.equal(rpc.p_event_type, "submitted");
});

test("rewrite reuses the existing Acceptance harness function", async () => {
  const config = JSON.stringify((await import("../vercel.json", { with: { type: "json" } })).default);
  assert.match(config, /api\/growth\/instantly-webhook/);
  assert.match(config, /api\/wave4-rls-acceptance-harness\?growth=instantly-webhook/);
});
