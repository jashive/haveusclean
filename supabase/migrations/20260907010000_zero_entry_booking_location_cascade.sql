begin;

create or replace function public.sync_public_booking_location_details()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.intake_channel = 'public_booking' and new.service_location_id is not null then
    update public.service_location
       set address_line2 = case when new.requirements->'location' ? 'address_line2'
              then nullif(btrim(coalesce(new.requirements->'location'->>'address_line2', '')), '') else address_line2 end,
           access_notes = case when new.requirements->'location' ? 'access_notes'
              then nullif(btrim(coalesce(new.requirements->'location'->>'access_notes', '')), '') else access_notes end
     where id = new.service_location_id and customer_id = new.customer_id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_public_booking_location_details() from public, anon, authenticated;
grant execute on function public.sync_public_booking_location_details() to service_role;

drop trigger if exists trg_sync_public_booking_location_details on public.service_request;
create trigger trg_sync_public_booking_location_details
after insert or update of requirements on public.service_request
for each row execute function public.sync_public_booking_location_details();

comment on function public.sync_public_booking_location_details() is
  'Copies public-booking Unit/Apt and access notes from canonical intake requirements into service_location within the intake transaction.';

commit;
