import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/serviceos-hosted-oat.yml", import.meta.url),
  "utf8",
);

test("Wave 1-6 local-runner workflow targets the acceptance environment", () => {
  assert.match(
    workflow,
    /full-live-oat:\n(?: {2,}.*\n)* {4}environment: acceptance\n/,
  );
});

test("Wave 1-6 local-runner workflow still requests the acceptance Supabase secrets", () => {
  assert.match(workflow, /SERVICEOS_ACCEPTANCE_SUPABASE_ANON_KEY/);
  assert.match(workflow, /SERVICEOS_ACCEPTANCE_SUPABASE_SERVICE_ROLE_KEY/);
});
