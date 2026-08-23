-- Growth Layer 1.0 read-only canonical scope diagnostic.
-- This query creates nothing and repairs nothing. It is safe to run in acceptance.
-- Expected G1 pilot prerequisites:
--   exactly one active business unit on CA / ON / CAD jurisdiction
--   exactly one active business unit on US / AZ / USD jurisdiction
--   both scopes under the same canonical organization
--   distinct business units and distinct jurisdictions
-- Canonical currency is stored on public.jurisdiction.

select
  b.organization_id,
  b.id as business_unit_id,
  b.status as business_unit_status,
  j.id as jurisdiction_id,
  j.code as jurisdiction_code,
  j.country_code,
  j.subdivision_code,
  j.currency_code,
  case
    when b.status = 'active'
      and j.country_code = 'CA'
      and j.subdivision_code = 'ON'
      and j.currency_code = 'CAD' then 'ON_CANDIDATE'
    when b.status = 'active'
      and j.country_code = 'US'
      and j.subdivision_code = 'AZ'
      and j.currency_code = 'USD' then 'AZ_CANDIDATE'
    else 'NOT_G1_CANONICAL_SCOPE'
  end as growth_scope_candidate
from public.business_unit b
join public.jurisdiction j on j.id = b.jurisdiction_id
order by b.organization_id, growth_scope_candidate, b.id;
