# Workforce W1-W10 Production Deployment Runbook

## Authority and boundaries

HEMS/HR owns recruiting, applicant intake, classification, restricted evidence, training, compliance, approval and workforce lifecycle governance. ServiceOS becomes the operational system of record only after the controlled worker activation bridge succeeds. Direct browser access to `hems_hr` is prohibited. Worker creation remains service-role-only. Initial activated-worker availability is `not_available` until a separate Operations action changes it.

## Canonical environments

- Acceptance Supabase: `hqeamecwdsrjfjybrsox`
- Production Supabase: `opazwghrohmfykzxxsjk`
- Production business units: literal `HUC-ON` and `HUC-AZ`
- Server target validation must use `requireServiceosServerTarget` and require Production approval when `SERVICEOS_ENVIRONMENT=production`.

## Accepted migration recovery

The historical `codex/w10-governance-lock` branch was not present when Production promotion was authorized. The exact database DDL was recovered from the persistently installed Acceptance migration history (`supabase_migrations.schema_migrations.statements`) rather than recreated from prose. The following accepted sequence was applied to Production in dependency order:

1. W1 HR runtime boundary
2. W1 phone E.164 constraint fix
3. W1 ServiceOS activation boundary
4. W1 primary-BU activation fix
5. W1 advisor/index hardening
6. W2/W3 intake, classification and requirements
7. W3 legacy Partner reconciliation boundary
8. W2/W3 readiness and activation bridge
9. W2/W3 advisor hardening
10. W4 compliance evidence audit
11. W4 review-context reset hardening
12. W4 advisor hardening
13. W5 lifecycle deactivation/offboarding
14. W5 archival/offboarding gates
15. W6 recruitment/applicant intake pipeline
16. W7 training/standards engine
17. W6 restricted applicant-upload Storage boundary
18. W8 tenant training/SOP boundary
19. W9 operational compliance dashboard
20. W10 workforce governance lock
21. W10 Workforce FK advisor hardening
22. Production parity hardening: remove the stale authenticated `worker_staff_insert` policy so W10's no-direct-worker-create invariant is true in the destination.

Acceptance hosted closeout aliases retained for traceability:

- W8: `20260903162123`
- W9: `20260903165438`
- W10 governance lock: `20260903173457`
- W10 FK advisor hardening: `20260903173842`

## Required Production checks

Run `supabase/acceptance/034_w8_end_to_end_multitenant_oat.sql`, `035_w9_operational_compliance_dashboard_oat.sql`, and `036_w10_final_governance_multitenant_oat.sql`, followed by `select hems_hr.production_readiness_audit();`.

A GO requires all of the following:

- `hems_hr` exists and every private HEMS table has enabled + forced RLS.
- Anonymous/authenticated roles have zero table grants and zero routine EXECUTE grants in `hems_hr`.
- Authenticated users have no direct INSERT/DELETE privilege or policy path on `public.worker`.
- HEMS-linked workers without successful activation = 0.
- Successful activations without worker/business-unit authorization = 0.
- Authorization and assignment tenant/business-unit mismatches = 0.
- Active assignments without an active+available authorization = 0.
- Restricted operational HR/payroll columns = 0.
- All Workforce foreign keys have a valid covering index.
- Literal HUC-ON/ON and HUC-AZ/AZ workforce configurations are active.
- HUC cleaning/microfiber modules are not platform-scoped.
- W9 pipeline output is sanitized and exposes only the six approved pipeline stages.

## Runtime activation

Workforce public intake and authenticated dashboard traffic are consolidated through the existing `api/serviceos-staff-admin.js` Vercel function to remain within the 12-function deployment ceiling:

- `/api/workforce/apply` rewrites to `/api/serviceos-staff-admin?workforce=apply`
- `/api/workforce/dashboard` rewrites to `/api/serviceos-staff-admin?workforce=dashboard`

The public apply boundary may call only the service-role `workforce_submit_application` RPC. The dashboard requires a valid ServiceOS session plus exact canonical `owner_admin` membership and then rechecks organization and literal HUC business-unit scope server-side.

`VITE_WORKFORCE_DASHBOARD_ENABLED=true` enables the compiled dashboard. `/admin/workforce` remains behind `ServiceOSAuthGate`; the Staff Management admin surface exposes the Workforce navigation link only when the flag is enabled.

## Applicant program hold

W6 program definitions are configuration, not migration defaults. Production promotion does not invent role codes, required document codes, or privacy/background-consent version strings. `hems_hr.applicant_intake_program` must remain unconfigured/disabled until those HEMS policy values are explicitly approved. This does not affect the W9 owner/admin compliance dashboard or the W1-W10 database governance cutover.
