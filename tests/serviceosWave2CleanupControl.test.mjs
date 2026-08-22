import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/lib/serviceosRevenueClient.js", import.meta.url), "utf8");

test("Wave 2 pilot cleanup requests deleted row representation", () => {
  assert.match(
    source,
    /method:\s*"DELETE"[\s\S]*?headers:\s*\{\s*Prefer:\s*"return=representation"\s*\}/,
    "DELETE must request return=representation so a zero-row RLS delete cannot look successful"
  );
});

test("Wave 2 pilot cleanup fails closed when the exact row was not deleted", () => {
  assert.match(source, /exactMatch\s*=\s*deleted\.some\(\(row\)\s*=>\s*row\?\.id\s*===\s*id\)/);
  assert.match(source, /if\s*\(!exactMatch\)[\s\S]*?Revenue delete verification failed/);
  assert.match(source, /possible RLS block/);
});

test("Wave 2 cleanup keeps CRM children before customer and revenue children before parents", () => {
  const orderMatch = source.match(/const order = \[([\s\S]*?)\];/);
  assert.ok(orderMatch, "cleanup order must exist");
  const order = [...orderMatch[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);

  assert.ok(order.indexOf("service_location") < order.indexOf("customer"));
  assert.ok(order.indexOf("contact") < order.indexOf("customer"));
  assert.ok(order.indexOf("job_handoff") < order.indexOf("conversion_record"));
  assert.ok(order.indexOf("quote_response") < order.indexOf("quote_version"));
  assert.ok(order.indexOf("quote_version") < order.indexOf("pricing_snapshot"));
});
