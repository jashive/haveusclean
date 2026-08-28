begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_on_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_on_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_az_bu uuid := '1cf7abdc-957b-4601-b26a-82c1fec7bcd0';
  v_az_jur uuid := '7288ca65-5d0f-4e21-a200-1d47cf527e29';
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
  snap jsonb;
begin
  insert into growth.prospect(
    id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,
    source_lane,city,country_code,subdivision_code,company_name,segment,facility_type,
    service_need_summary,verification_status,risk_flags,missing_fields,metadata,captured_at
  ) values
  (p1,v_org,v_on_bu,v_on_jur,'G5-OAT-021-ON','discovered','synthetic_g5_dashboard','Toronto','CA','ON','G5 Dashboard ON','office','office','Dashboard contract proof','verified','[]','[]',jsonb_build_object('synthetic',true,'oat','021'),'2026-08-10T12:00:00Z'),
  (p2,v_org,v_az_bu,v_az_jur,'G5-OAT-021-AZ','discovered','synthetic_g5_dashboard','Phoenix','US','AZ','G5 Dashboard AZ','office','office','Dashboard contract proof','verified','[]','[]',jsonb_build_object('synthetic',true,'oat','021'),'2026-08-11T12:00:00Z');

  snap := public.growth_g5_dashboard_snapshot(v_org,null,null,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z');

  if snap->>'schema_version' <> 'g5-dashboard-v1' then raise exception 'OAT021 dashboard schema version wrong: %',snap; end if;
  if snap->>'cohort_anchor' <> 'growth.prospect.captured_at' then raise exception 'OAT021 cohort anchor wrong: %',snap; end if;
  if snap->>'currency_policy' <> 'separate_by_invoice_currency' then raise exception 'OAT021 currency policy wrong: %',snap; end if;
  if jsonb_array_length(snap->'funnel') <> 2 then raise exception 'OAT021 expected two funnel cohort rows: %',snap; end if;
  if jsonb_array_length(snap->'latency') <> 2 then raise exception 'OAT021 expected two latency cohort rows: %',snap; end if;
  if jsonb_array_length(snap->'financial') <> 0 then raise exception 'OAT021 finance should be empty without invoices: %',snap; end if;

  if not exists(
    select 1 from jsonb_array_elements(snap->'funnel') x
    where x->>'country_code'='CA' and x->>'subdivision_code'='ON' and x->>'source_lane'='synthetic_g5_dashboard'
  ) then raise exception 'OAT021 ON cohort missing'; end if;

  if not exists(
    select 1 from jsonb_array_elements(snap->'funnel') x
    where x->>'country_code'='US' and x->>'subdivision_code'='AZ' and x->>'source_lane'='synthetic_g5_dashboard'
  ) then raise exception 'OAT021 AZ cohort missing'; end if;

  if exists(
    select 1 from growth.feature_gate
    where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled')
      and enabled
  ) then raise exception 'OAT021 execution gate unexpectedly enabled'; end if;
end $$;

rollback;

select
  (select count(*) from growth.prospect where external_prospect_key in ('G5-OAT-021-ON','G5-OAT-021-AZ')) as persisted_prospects,
  (select count(*) from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') and enabled) as enabled_execution_gates;
