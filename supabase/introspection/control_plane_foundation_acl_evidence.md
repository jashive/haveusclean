# Control-plane foundation ACL evidence

Read-only pg_catalog extraction from the production-like ServiceOS database. No business rows copied. This is historical ACL evidence and must be reconciled with current least-privilege hardening before becoming the fresh-environment target.

## Table ACL pattern

Most foundation tables historically expose full table privileges to `authenticated` and `service_role`, relying on RLS as the row boundary:

`postgres=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres`

The following lifecycle tables historically have the narrower authenticated ACL `arwdm` (no TRUNCATE/REFERENCES/TRIGGER) while service_role remains full:

- conversion_record
- estimate
- job_handoff
- opportunity
- pricing_snapshot
- quote
- quote_response
- quote_version
- service_request

Their historical ACL pattern is:

`postgres=arwdDxtm/postgres, authenticated=arwdm/postgres, service_role=arwdDxtm/postgres`

All other 26-foundation relations observed the broader authenticated pattern above.

## Function ACL evidence

Membership/security helpers:

- `current_app_user_id()` -> postgres EXECUTE, authenticated EXECUTE, service_role EXECUTE; no PUBLIC/anon grant observed.
- `is_org_member(uuid)` -> postgres/authenticated/service_role EXECUTE; no PUBLIC/anon grant observed.
- `is_business_unit_member(uuid)` -> postgres/authenticated/service_role EXECUTE; no PUBLIC/anon grant observed.
- `has_org_role(uuid,text[])` -> postgres/authenticated/service_role EXECUTE; no PUBLIC/anon grant observed.
- `has_bu_role(uuid,uuid,text[])` -> postgres/authenticated/service_role EXECUTE; no PUBLIC/anon grant observed.

Historical internal trigger/guard functions below exposed EXECUTE to PUBLIC, anon, authenticated, postgres, and service_role:

- `wave2_org_bu_guard()`
- `pricing_snapshot_scope_guard()`
- `pricing_snapshot_immutable_guard()`
- `quote_version_guard()`
- `quote_response_guard()`
- `quote_response_immutable_guard()`
- `conversion_record_guard()`
- `job_handoff_guard()`

Historical ACL string for those functions:

`{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`

## Canonical security reconciliation

Do **not** preserve direct PUBLIC/anon/authenticated EXECUTE on internal trigger functions in the fresh baseline. The later migration `20260818040000_serviceos_role_workflow_hardening.sql` explicitly hardens internal execution boundaries. Treat the broad historical trigger-function ACL as historical drift requiring least-privilege reconciliation, not desired target semantics.

The membership/security helpers may remain callable by authenticated sessions as required by RLS, with SECURITY DEFINER and explicit search_path as separately evidenced.
