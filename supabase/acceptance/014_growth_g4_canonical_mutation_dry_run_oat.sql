begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p1 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); e1 uuid:=gen_random_uuid(); ce1 uuid; qr1 jsonb; hc1 uuid; pre1 jsonb; plan0 jsonb; plan1 jsonb; plan2 jsonb;
  v_before_customer bigint; v_before_contact bigint; v_before_loc bigint; v_before_sr bigint; v_before_opp bigint;
begin
  select count(*) into v_before_customer from public.customer;
  select count(*) into v_before_contact from public.contact;
  select count(*) into v_before_loc from public.service_location;
  select count(*) into v_before_sr from public.service_request;
  select count(*) into v_before_opp from public.opportunity;

  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,address_line1,postal_code,facility_type,service_need_summary,verification_status,risk_flags,missing_fields,metadata)
  values(p1,v_org,v_bu,v_jur,'G4-OAT-PLAN-1','engaged','synthetic_oat','Toronto','CA','ON','G4 Plan Synthetic One','office','100 Test Plan Ave','M5V1A1','office','Recurring commercial cleaning inquiry','verified','[]','[]',jsonb_build_object('synthetic',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,email,phone,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c1,p1,v_org,v_bu,v_jur,'Test','Buyer','g4-plan-one@example.invalid','4165550199','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
  values(e1,v_org,v_bu,v_jur,p1,c1,'email','reply',now(),jsonb_build_object('synthetic',true,'reply_text','Yes, we need recurring office cleaning.'));
  ce1:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e1,'positive_interest','deterministic','g4-plan-oat-2026-08-25',0.99,jsonb_build_object('synthetic',true));
  qr1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_reviewer,'Synthetic G4 plan qualification','G4-OAT-PLAN-QUAL-1',jsonb_build_object('synthetic',true));
  hc1:=(qr1->>'handoff_candidate_id')::uuid;
  if hc1 is null then raise exception 'G4 plan OAT: handoff candidate missing'; end if;

  update growth.prospect set lifecycle_status='handoff_ready' where id=p1;
  pre1:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc1);
  if pre1->>'status'<>'READY_EXCEPT_HANDOFF_GATE' then raise exception 'G4 plan OAT: reservation not ready %',pre1; end if;

  plan0:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan0->>'status'<>'BLOCKED' or not (plan0->'blocking_reasons' ? 'canonical_service_category_missing') then raise exception 'G4 plan OAT: missing canonical service category did not block %',plan0; end if;

  update growth.handoff_candidate set handoff_payload=handoff_payload||jsonb_build_object('service_category','commercial','requirements',jsonb_build_object('scope','office cleaning')) where id=hc1;

  plan1:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan1->>'status'<>'READY_EXCEPT_HANDOFF_AUTHORIZATION' then raise exception 'G4 plan OAT: expected READY_EXCEPT_HANDOFF_AUTHORIZATION got %',plan1; end if;
  if coalesce((plan1->>'serviceos_mutation_authorized')::boolean,true) then raise exception 'G4 plan OAT: mutation authority leaked'; end if;
  if length(plan1->>'object_plan_hash')<>64 then raise exception 'G4 plan OAT: object plan hash invalid'; end if;
  if plan1->>'identity_resolution'<>'create_new_identity' then raise exception 'G4 plan OAT: unexpected identity resolution %',plan1; end if;
  if plan1->'object_plan'->'service_request'->'payload'->>'service_category'<>'commercial' then raise exception 'G4 plan OAT: service category mapping incorrect'; end if;
  if plan1->'object_plan'->'service_request'->>'action'<>'create' or plan1->'object_plan'->'opportunity'->>'action'<>'create' then raise exception 'G4 plan OAT: canonical object actions invalid'; end if;
  if coalesce((plan1->'object_plan'->>'canonical_mutation_performed')::boolean,true) then raise exception 'G4 plan OAT: plan says mutation occurred'; end if;

  plan2:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan2->>'status'<>'READY_EXCEPT_HANDOFF_AUTHORIZATION' or coalesce((plan2->>'idempotent_replay')::boolean,false) is not true then raise exception 'G4 plan OAT: replay failed %',plan2; end if;
  if plan2->>'plan_id'<>plan1->>'plan_id' or plan2->>'object_plan_hash'<>plan1->>'object_plan_hash' then raise exception 'G4 plan OAT: replay changed plan identity'; end if;

  begin
    update growth.serviceos_handoff_plan set metadata=jsonb_build_object('tampered',true) where id=(plan1->>'plan_id')::uuid;
    raise exception 'G4 plan OAT: immutable plan update unexpectedly succeeded';
  exception when others then
    if sqlerrm='G4 plan OAT: immutable plan update unexpectedly succeeded' then raise; end if;
  end;

  if (select count(*) from public.customer)<>v_before_customer or (select count(*) from public.contact)<>v_before_contact or (select count(*) from public.service_location)<>v_before_loc or (select count(*) from public.service_request)<>v_before_sr or (select count(*) from public.opportunity)<>v_before_opp then
    raise exception 'G4 plan OAT: canonical ServiceOS mutation occurred during dry run';
  end if;

  update growth.prospect set service_need_summary='Changed after plan' where id=p1;
  plan2:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan2->>'status'<>'BLOCKED' or not (plan2->'blocking_reasons' ? 'canonical_plan_drift') then raise exception 'G4 plan OAT: post-plan content drift not blocked %',plan2; end if;
end $$;

rollback;

select
 (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate,
 (select count(*) from growth.serviceos_handoff_plan where object_plan->>'plan_version'='g4-canonical-plan-2026-08-25') as persisted_plans,
 (select count(*) from growth.prospect where external_prospect_key='G4-OAT-PLAN-1') as persisted_prospects,
 (select count(*) from public.idempotency_key where scope='growth_g4_serviceos_handoff' and key like 'handoff_candidate:%') as persisted_canonical_idempotency,
 (select count(*) from public.external_reference where system_name='growth_layer_1_0' and external_id like 'handoff_candidate:%') as persisted_external_refs;
