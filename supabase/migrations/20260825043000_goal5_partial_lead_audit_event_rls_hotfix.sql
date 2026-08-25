create policy audit_lead_intake_insert
on public.audit_event
for insert
to authenticated
with check (
  organization_id is not null
  and business_unit_id is not null
  and actor_user_id = public.current_app_user_id()
  and event_type = 'lead_intake_captured'
  and entity_type = 'service_request'
  and source_system = 'serviceos_revenue'
  and public.has_bu_role(
    organization_id,
    business_unit_id,
    array['owner_admin','office_ops']
  )
);
