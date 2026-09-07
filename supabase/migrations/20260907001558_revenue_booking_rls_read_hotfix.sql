-- Allow Revenue staff to read the immutable booking projection used by the
-- lead review drawer. Writes remain server-only through the governed intake
-- function; anonymous clients retain no table privileges.

begin;

alter table public.booking enable row level security;
alter table public.booking force row level security;

revoke all on table public.booking from public, anon;
grant select on table public.booking to authenticated;

drop policy if exists booking_revenue_staff_select on public.booking;
create policy booking_revenue_staff_select
  on public.booking
  for select
  to authenticated
  using (
    public.has_bu_role(
      organization_id,
      business_unit_id,
      array['owner_admin', 'office_ops']::text[]
    )
  );

comment on policy booking_revenue_staff_select on public.booking is
  'Territory-scoped Revenue booking projection access for Owner/Admin and Office Operations. No browser write access.';

commit;
