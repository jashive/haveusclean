import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(
  new URL("../.github/workflows/serviceos-hosted-oat.yml", import.meta.url),
  "utf8",
);

test("Wave 1-6 local-runner workflow targets the acceptance environment", () => {
  const jobStart = workflow.indexOf("  full-live-oat:\n");
  const stepsStart = workflow.indexOf("\n    steps:\n", jobStart);

  assert.notEqual(jobStart, -1);
  assert.notEqual(stepsStart, -1);

  const jobHeader = workflow.slice(jobStart, stepsStart);

  assert.ok(
    jobHeader.includes("    environment: acceptance\n"),
  );
});

test("Wave 1-6 local-runner workflow still requests the acceptance Supabase secrets", () => {
  assert.match(workflow, /SERVICEOS_ACCEPTANCE_SUPABASE_ANON_KEY/);
  assert.match(workflow, /SERVICEOS_ACCEPTANCE_SUPABASE_SERVICE_ROLE_KEY/);
});
