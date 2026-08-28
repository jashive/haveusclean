begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
  obs record;
  snap jsonb;
begin
  insert into growth.prospect(
    id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,
    source_lane,city,country_code,subdivision_code,company_name,segment,facility_type,
    service_need_summary,verification_status,risk_flags,missing_fields,metadata,captured_at
  ) values
  (p1,v_org,v_bu,v_jur,'G5-OAT-023-A','discovered','synthetic_g5_feedback','Toronto','CA','ON','G5 Feedback A','office','office','Feedback proof','verified','[]','[]',jsonb_build_object('synthetic',true,'oat','023'),'2026-08-10T12:00:00Z'),
  (p2,v_org,v_bu,v_jur,'G5-OAT-023-B','discovered','synthetic_g5_feedback','Toronto','CA','ON','G5 Feedback B','office','office','Feedback proof','verified','[]','[]',jsonb_build_object('synthetic',true,'oat','023'),'2026-08-11T12:00:00Z');

  select * into obs
  from public.growth_g5_optimization_observations(v_org,v_bu,v_jur,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z',20,5,3,0.20)
  where source_lane='synthetic_g5_feedback';

  if obs.prospects<>2 or obs.sample_status<>'insufficient_sample' or obs.recommended_action<>'collect_more_data' then
    raise exception 'OAT023 sample gating wrong: %',row_to_json(obs);
  end if;

  snap := public.growth_g5_dashboard_snapshot_v2(v_org,v_bu,v_jur,'2026-08-01T00:00:00Z','2026-09-01T00:00:00Z');
  if snap->>'schema_version'<>'g5-dashboard-v2' then raise exception 'OAT023 dashboard version wrong: %',snap; end if;
  if snap->>'optimization_policy'<>'recommendation_only_sample_gated' then raise exception 'OAT023 optimization policy wrong: %',snap; end if;
  if jsonb_array_length(snap->'optimization')<>1 then raise exception 'OAT023 expected one optimization row: %',snap; end if;
  if (snap->'optimization'->0->>'recommended_action')<>'collect_more_data' then raise exception 'OAT023 dashboard recommendation wrong: %',snap; end if;
  if jsonb_array_length(snap->'campaign_outcomes')<>0 then raise exception 'OAT023 campaign outcomes should be empty without canonical campaign lineage: %',snap; end if;
  if jsonb_array_length(snap->'unit_economics')<>0 then raise exception 'OAT023 unit economics should be empty without cost evidence: %',snap; end if;

  if exists(
    select 1 from growth.feature_gate
    where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled')
      and enabled
  ) then raise exception 'OAT023 execution gate unexpectedly enabled'; end if;
end $$;

rollback;

select
  (select count(*) from growth.prospect where external_prospect_key in ('G5-OAT-023-A','G5-OAT-023-B')) as persisted_prospects,
  (select count(*) from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') and enabled) as enabled_execution_gates;
