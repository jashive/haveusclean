import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/lib/governedResidentialConfig.js", "utf8");

test("live governed config lookup uses refresh-aware ServiceOS transport", () => {
  assert.match(source, /import \{ authenticatedRestFetchWithRefresh \} from "\.\/serviceosAuthClient\.js"/);
  assert.match(source, /fetcher = null/);
  assert.match(source, /fetcher\s*\? await fetcher\(path, accessToken\)\s*:\s*await authenticatedRestFetchWithRefresh\(path\)/s);
  assert.doesNotMatch(source, /fetcher = authenticatedRestFetch/);
});

test("injected governed-config fetcher remains token-aware for deterministic tests", () => {
  assert.match(source, /await fetcher\(path, accessToken\)/);
  assert.match(source, /if \(!accessToken\) throw new Error\("Governed residential config lookup failed: accessToken required"\)/);
});
