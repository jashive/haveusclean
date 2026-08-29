import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const client = fs.readFileSync("src/lib/serviceosRevenueClient.js", "utf8");

test("quote sent lifecycle transition lets database own sent_at", () => {
  const helperStart = client.indexOf("export async function updateQuoteVersionStatus");
  const helperEnd = client.indexOf("// ── Quote Response", helperStart);
  const helper = client.slice(helperStart, helperEnd);
  assert.match(helper, /\{ lifecycle_status: newStatus \}/);
  assert.doesNotMatch(helper, /sent_at/);
});

test("legacy revenue pipeline also lets database own sent_at", () => {
  const pipelineStart = client.indexOf("export async function runRevenuePipeline");
  const pipelineEnd = client.indexOf("// ── Pilot cleanup", pipelineStart);
  const pipeline = client.slice(pipelineStart, pipelineEnd);
  assert.match(pipeline, /\{ lifecycle_status: "sent" \}/);
  assert.doesNotMatch(pipeline, /sent_at/);
});
