begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p1 uuid:=gen_random_uuid();
  c1 uuid:=gen_random_uuid();
  e1 uuid:=gen_random_uuid();
  ce1 uuid;
  qr1 jsonb;
  hc1 uuid;
  pre1 jsonb;
  src1 uuid:=gen_random_uuid();
  cu1 uuid:=gen_random_uuid();
  cu2 uuid:=gen_random_uuid();
  ct1 uuid:=gen_random_uuid();
  ct2 uuid:=gen_random_uuid();
  plan0 jsonb;
  plan1 jsonb;
  plan2 jsonb;
  plan_block jsonb;
  v_before_customer bigint;
  v_before_contact bigint;
  v_before_loc bigint;
  v_before_sr bigint;
  v_before_opp bigint;
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
  if plan0->>'status'<>'BLOCKED' or not (plan0->'blocking_reasons' ? 'canonical_marketing_source_missing') then
    raise exception 'G4 plan OAT: missing canonical marketing source did not block %',plan0;
  end if;

  insert into public.marketing_source(id,organization_id,code,name,source_type,status,metadata)
  values(src1,v_org,'g4_oat_synthetic','G4 OAT Synthetic','synthetic','active',jsonb_build_object('growth_source_lane','synthetic_oat','synthetic',true));

  insert into public.customer(id,organization_id,business_unit_id,customer_type,display_name,status,metadata)
  values
    (cu1,v_org,v_bu,'business','Ambiguous One','lead',jsonb_build_object('synthetic',true)),
    (cu2,v_org,v_bu,'business','Ambiguous Two','lead',jsonb_build_object('synthetic',true));

  insert into public.contact(id,customer_id,email,is_primary,metadata)
  values
    (ct1,cu1,'g4-plan-one@example.invalid',true,jsonb_build_object('synthetic',true)),
    (ct2,cu2,'g4-plan-one@example.invalid',true,jsonb_build_object('synthetic',true));

  plan_block:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan_block->>'status'<>'BLOCKED' or not (plan_block->'blocking_reasons' ? 'canonical_customer_identity_ambiguous') then
    raise exception 'G4 plan OAT: canonical identity ambiguity did not block %',plan_block;
  end if;

  delete from public.contact where id in (ct1,ct2);
  delete from public.customer where id in (cu1,cu2);

  insert into public.idempotency_key(organization_id,scope,key,request_hash)
  values(v_org,'growth_g4_serviceos_handoff','handoff_candidate:'||hc1::text,repeat('a',64));

  plan_block:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan_block->>'status'<>'BLOCKED' or not (plan_block->'blocking_reasons' ? 'canonical_idempotency_conflict') then
    raise exception 'G4 plan OAT: canonical idempotency collision did not block %',plan_block;
  end if;

  delete from public.idempotency_key where scope='growth_g4_serviceos_handoff' and key='handoff_candidate:'||hc1::text;

  plan1:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan1->>'status'<>'READY_EXCEPT_HANDOFF_AUTHORIZATION' then raise exception 'G4 plan OAT: expected READY_EXCEPT_HANDOFF_AUTHORIZATION got %',plan1; end if;
  if coalesce((plan1->>'serviceos_mutation_authorized')::boolean,true) then raise exception 'G4 plan OAT: mutation authority leaked'; end if;
  if length(plan1->>'object_plan_hash')<>64 then raise exception 'G4 plan OAT: object plan hash invalid'; end if;
  if plan1->>'identity_resolution'<>'create_new_identity' then raise exception 'G4 plan OAT: unexpected identity resolution %',plan1; end if;
  if plan1->'object_plan'->>'serviceos_mutation_authorized'<>'false' then raise exception 'G4 plan OAT: object plan mutation authority leaked'; end if;

  plan2:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan2->>'status'<>'READY_EXCEPT_HANDOFF_AUTHORIZATION' or coalesce((plan2->>'idempotent_replay')::boolean,false) is not true then raise exception 'G4 plan OAT: replay failed %',plan2; end if;
  if plan2->>'plan_id'<>plan1->>'plan_id' or plan2->>'object_plan_hash'<>plan1->>'object_plan_hash' then raise exception 'G4 plan OAT: replay changed plan identity'; end if;

  begin
    update growth.serviceos_handoff_plan set metadata=jsonb_build_object('tampered',true) where id=(plan1->>'plan_id')::uuid;
    raise exception 'G4 plan OAT: immutable plan update unexpectedly succeeded';
  exception when others then
    if sqlerrm='G4 plan OAT: immutable plan update unexpectedly succeeded' then raise; end if;
  end;

  insert into growth.suppression(organization_id,jurisdiction_id,prospect_id,channel,identity_type,identity_value_normalized,reason,source,active,metadata)
  values(v_org,v_jur,p1,'email','email','g4-plan-one@example.invalid','opt_out','synthetic_oat',true,jsonb_build_object('synthetic',true));

  plan_block:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan_block->>'status'<>'BLOCKED' or not (plan_block->'blocking_reasons' ? 'active_suppression') then
    raise exception 'G4 plan OAT: active suppression did not block %',plan_block;
  end if;

  if (select count(*) from public.customer)<>v_before_customer or (select count(*) from public.contact)<>v_before_contact or (select count(*) from public.service_location)<>v_before_loc or (select count(*) from public.service_request)<>v_before_sr or (select count(*) from public.opportunity)<>v_before_opp then
    raise exception 'G4 plan OAT: canonical ServiceOS mutation occurred during dry run';
  end if;
end $$;

rollback;

select
  (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate,
  (select count(*) from growth.serviceos_handoff_plan where prospect_id in (select id from growth.prospect where external_prospect_key='G4-OAT-PLAN-1')) as persisted_plans,
  (select count(*) from growth.serviceos_handoff_reservation where prospect_id in (select id from growth.prospect where external_prospect_key='G4-OAT-PLAN-1')) as persisted_reservations,
  (select count(*) from growth.prospect where external_prospect_key='G4-OAT-PLAN-1') as persisted_synthetic_prospects,
  (select count(*) from public.marketing_source where code='g4_oat_synthetic') as persisted_synthetic_sources;
