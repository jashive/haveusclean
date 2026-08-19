# ServiceOS acceptance environment contract

Required client variables: `VITE_SERVICEOS_ENVIRONMENT=acceptance`, `VITE_SUPABASE_URL` (must
identify the approved acceptance project), and secret `VITE_SUPABASE_ANON`. Server acceptance
handlers use `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and, only where documented, the server-only
`SUPABASE_SERVICE_ROLE_KEY`. Mutation runners additionally require
`SERVICEOS_ACCEPTANCE_MUTATIONS_APPROVED=true`.

Enable the lifecycle only in the isolated preview with:
`VITE_SERVICEOS_ENABLED`, `VITE_SERVICEOS_AUTH_ENABLED`, `VITE_SERVICEOS_REVENUE_ENABLED`,
`VITE_SERVICEOS_REVENUE_PILOT_UI`, `VITE_SERVICEOS_OPERATIONS_ENABLED`,
`VITE_SERVICEOS_OPERATIONS_PILOT_UI`, `VITE_SERVICEOS_WAVE4_PILOT_UI`,
`VITE_SERVICEOS_FINANCE_ENABLED`, and `VITE_SERVICEOS_WAVE5_PILOT_UI` set to `true`.

Run `npm run oat:preflight` before reads and `npm run oat:preflight:mutation` before any seed,
migration, golden-path, rework, finance, concurrency, or cleanup operation. The latter command
requires both the exact acceptance project and explicit mutation approval. Credentials must be
provisioned through protected environment variables and must never be printed.

The canonical clean-environment migration manifest and synthetic seed are checked into the
repository. Supabase Auth identities must be externally created from protected per-role email and
password variables; the seed then binds their UUIDs to four synthetic app users and exactly one
worker link without embedding passwords or copying production identities.

## Hosted authentication and workspace smoke runner

Install the bundled Chromium once with `npx playwright install chromium`, then run
`npm run oat:hosted` with these protected runtime variables:

- `BASE_URL`
- `SERVICEOS_OAT_OWNER_EMAIL`, `SERVICEOS_OAT_OWNER_PASSWORD`
- `SERVICEOS_OAT_OFFICE_EMAIL`, `SERVICEOS_OAT_OFFICE_PASSWORD`
- `SERVICEOS_OAT_WORKER_EMAIL`, `SERVICEOS_OAT_WORKER_PASSWORD`
- `SERVICEOS_OAT_QA_EMAIL`, `SERVICEOS_OAT_QA_PASSWORD`

Optional controls are `SERVICEOS_OAT_HEADED=true` and
`SERVICEOS_OAT_EVIDENCE_DIR=<path>`. The runner does not print credentials, clears credential
fields before failure screenshots, blocks any browser request containing the production project
reference, and requires browser traffic to the approved acceptance project. It covers canonical
sign-in, invalid-login rejection, per-role workspace resolution, logout isolation, and owner-only
diagnostics. Run it only after the acceptance database and four synthetic identities are ready.
