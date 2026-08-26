begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p1 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); e1 uuid:=gen_random_uuid(); ce1 uuid; qr1 jsonb; hc1 uuid; pre1 jsonb; pre2 jsonb;
  p2 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); ce2 uuid; qr2 jsonb; hc2 uuid; pre3 jsonb;
  v_before_customer bigint; v_before_sr bigint; v_before_opp bigint;
begin
  select count(*) into v_before_customer from public.customer;
  select count(*) into v_before_sr from public.service_request;
  select count(*) into v_before_opp from public.opportunity;

  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(p1,v_org,v_bu,v_jur,'G4-OAT-PREFLIGHT-1','engaged','synthetic_oat','Toronto','CA','ON','G4 Synthetic One','office','verified','[]','[]',jsonb_build_object('synthetic',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c1,p1,v_org,v_bu,v_jur,'g4-one@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
  values(e1,v_org,v_bu,v_jur,p1,c1,'email','reply',now(),jsonb_build_object('synthetic',true,'reply_text','Yes, please send pricing.'));
  ce1:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e1,'positive_interest','deterministic','g4-oat-2026-08-25',0.99,jsonb_build_object('synthetic',true));
  qr1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_reviewer,'Synthetic G4 qualification','G4-OAT-QUAL-1',jsonb_build_object('synthetic',true));
  hc1:=(qr1->>'handoff_candidate_id')::uuid;
  if hc1 is null then raise exception 'G4 OAT: handoff candidate missing'; end if;

  pre1:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc1);
  if pre1->>'status'<>'READY_EXCEPT_HANDOFF_GATE' then raise exception 'G4 OAT: expected READY_EXCEPT_HANDOFF_GATE got %',pre1; end if;
  if coalesce((pre1->>'serviceos_mutation_authorized')::boolean,true) then raise exception 'G4 OAT: mutation authority leaked'; end if;
  if coalesce((pre1->>'handoff_gate_enabled')::boolean,true) then raise exception 'G4 OAT: handoff gate unexpectedly enabled'; end if;
  if length(pre1->>'request_hash')<>64 then raise exception 'G4 OAT: request hash invalid'; end if;

  pre2:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc1);
  if pre2->>'status'<>'READY_EXCEPT_HANDOFF_GATE' or coalesce((pre2->>'idempotent_replay')::boolean,false) is not true then raise exception 'G4 OAT: idempotent replay failed %',pre2; end if;
  if pre2->>'reservation_id'<>pre1->>'reservation_id' then raise exception 'G4 OAT: reservation replay changed id'; end if;

  begin
    update growth.serviceos_handoff_reservation set metadata=jsonb_build_object('tampered',true) where id=(pre1->>'reservation_id')::uuid;
    raise exception 'G4 OAT: reservation update unexpectedly succeeded';
  exception when others then
    if sqlerrm='G4 OAT: reservation update unexpectedly succeeded' then raise; end if;
  end;

  if (select count(*) from public.customer)<>v_before_customer or (select count(*) from public.service_request)<>v_before_sr or (select count(*) from public.opportunity)<>v_before_opp then
    raise exception 'G4 OAT: canonical ServiceOS mutation occurred during preflight';
  end if;

  insert into public.idempotency_key(organization_id,scope,key,request_hash,response_code,response_body,expires_at)
  values(v_org,pre1->>'planned_idempotency_scope',pre1->>'planned_idempotency_key','synthetic-conflict',200,'{}'::jsonb,now()+interval '1 hour');
  if (public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc1)->>'status')<>'BLOCKED' then raise exception 'G4 OAT: canonical idempotency conflict not blocked'; end if;
  delete from public.idempotency_key where scope=pre1->>'planned_idempotency_scope' and key=pre1->>'planned_idempotency_key';

  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(p2,v_org,v_bu,v_jur,'G4-OAT-PREFLIGHT-2','engaged','synthetic_oat','Toronto','CA','ON','G4 Synthetic Two','office','verified','[]','[]',jsonb_build_object('synthetic',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c2,p2,v_org,v_bu,v_jur,'g4-two@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
  values(e2,v_org,v_bu,v_jur,p2,c2,'email','reply',now(),jsonb_build_object('synthetic',true,'reply_text','Interested.'));
  ce2:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p2,c2,e2,'positive_interest','deterministic','g4-oat-2026-08-25',0.99,jsonb_build_object('synthetic',true));
  qr2:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p2,c2,e2,ce2,'qualified',true,true,true,v_reviewer,'Synthetic G4 qualification 2','G4-OAT-QUAL-2',jsonb_build_object('synthetic',true));
  hc2:=(qr2->>'handoff_candidate_id')::uuid;
  insert into growth.suppression(organization_id,jurisdiction_id,prospect_id,channel,identity_type,identity_value_normalized,reason,source,active,metadata)
  values(v_org,v_jur,p2,'email','email','g4-two@example.invalid','opt_out','g4_oat',true,jsonb_build_object('synthetic',true));
  pre3:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc2);
  if pre3->>'status'<>'BLOCKED' or not (pre3->'blocking_reasons' ? 'active_suppression') then raise exception 'G4 OAT: active suppression not blocked %',pre3; end if;

  if (public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,gen_random_uuid())->>'status')<>'BLOCKED' then raise exception 'G4 OAT: missing candidate not blocked'; end if;
end $$;

rollback;

select
 (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate,
 (select count(*) from growth.serviceos_handoff_reservation where snapshot->>'snapshot_version'='g4-serviceos-handoff-reservation-2026-08-25') as persisted_reservations,
 (select count(*) from growth.prospect where external_prospect_key in ('G4-OAT-PREFLIGHT-1','G4-OAT-PREFLIGHT-2')) as persisted_prospects,
 (select count(*) from public.idempotency_key where scope='growth_g4_serviceos_handoff' and key like 'handoff_candidate:%') as persisted_canonical_idempotency,
 (select count(*) from public.external_reference where system_name='growth_layer_1_0' and external_id like 'handoff_candidate:%') as persisted_external_refs;
