import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const revenueClient = fs.readFileSync("src/lib/serviceosRevenueClient.js", "utf8");

test("quote sent transition lets database own sent_at", () => {
  assert.match(revenueClient, /updateQuoteVersionStatus\(quoteVersionId, newStatus, accessToken\)/);
  assert.match(revenueClient, /updateById\("quote_version", quoteVersionId, \{ lifecycle_status: newStatus \}, accessToken\)/);
  assert.doesNotMatch(revenueClient, /patch\.sent_at\s*=\s*new Date\(\)\.toISOString\(\)/);
});

test("legacy revenue pipeline also lets database stamp sent_at", () => {
  assert.match(revenueClient, /quoteVersion\.id,\s*\{ lifecycle_status: "sent" \},\s*accessToken/);
  assert.doesNotMatch(revenueClient, /\{ lifecycle_status: "sent", sent_at:/);
});
