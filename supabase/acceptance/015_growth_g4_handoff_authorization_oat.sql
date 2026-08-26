begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p1 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); e1 uuid:=gen_random_uuid(); ce1 uuid; qr1 jsonb; hc1 uuid; pre1 jsonb; src1 uuid:=gen_random_uuid(); plan1 jsonb; auth1 jsonb; auth2 jsonb; auth_eval jsonb; revoke1 jsonb; blocked jsonb;
  v_before_customer bigint; v_before_contact bigint; v_before_loc bigint; v_before_sr bigint; v_before_opp bigint;
begin
  select count(*) into v_before_customer from public.customer;
  select count(*) into v_before_contact from public.contact;
  select count(*) into v_before_loc from public.service_location;
  select count(*) into v_before_sr from public.service_request;
  select count(*) into v_before_opp from public.opportunity;

  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,address_line1,postal_code,facility_type,service_need_summary,verification_status,risk_flags,missing_fields,metadata)
  values(p1,v_org,v_bu,v_jur,'G4-OAT-AUTH-1','engaged','synthetic_oat_auth','Toronto','CA','ON','G4 Auth Synthetic','office','200 Test Auth Ave','M5V1A2','office','Recurring commercial cleaning inquiry','verified','[]','[]',jsonb_build_object('synthetic',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,email,phone,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c1,p1,v_org,v_bu,v_jur,'Auth','Buyer','g4-auth-one@example.invalid','4165550188','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
  values(e1,v_org,v_bu,v_jur,p1,c1,'email','reply',now(),jsonb_build_object('synthetic',true,'reply_text','Yes, please proceed.'));
  ce1:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e1,'positive_interest','deterministic','g4-auth-oat-2026-08-26',0.99,jsonb_build_object('synthetic',true));
  qr1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_reviewer,'Synthetic G4 authorization qualification','G4-OAT-AUTH-QUAL-1',jsonb_build_object('synthetic',true));
  hc1:=(qr1->>'handoff_candidate_id')::uuid;
  update growth.prospect set lifecycle_status='handoff_ready' where id=p1;
  pre1:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc1);
  if pre1->>'status'<>'READY_EXCEPT_HANDOFF_GATE' then raise exception 'G4 auth OAT reservation failed %',pre1; end if;
  insert into public.marketing_source(id,organization_id,code,name,source_type,status,metadata)
  values(src1,v_org,'g4_oat_auth_synthetic','G4 OAT Auth Synthetic','synthetic','active',jsonb_build_object('growth_source_lane','synthetic_oat_auth','synthetic',true));
  plan1:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  if plan1->>'status'<>'READY_EXCEPT_HANDOFF_AUTHORIZATION' then raise exception 'G4 auth OAT plan failed %',plan1; end if;

  blocked:=public.growth_g4_record_serviceos_handoff_authorization(v_org,v_bu,v_jur,(plan1->>'plan_id')::uuid,repeat('0',64),v_reviewer,now()+interval '1 hour','G4-OAT-AUTH-1','Synthetic approval',jsonb_build_object('synthetic',true));
  if blocked->>'status'<>'BLOCKED' or not (blocked->'blocking_reasons' ? 'object_plan_hash_mismatch') then raise exception 'G4 auth OAT hash mismatch did not block %',blocked; end if;
  auth1:=public.growth_g4_record_serviceos_handoff_authorization(v_org,v_bu,v_jur,(plan1->>'plan_id')::uuid,plan1->>'object_plan_hash',v_reviewer,now()+interval '1 hour','G4-OAT-AUTH-1','Synthetic approval',jsonb_build_object('synthetic',true));
  if auth1->>'status'<>'AUTHORIZED_EXCEPT_HANDOFF_GATE' or coalesce((auth1->>'serviceos_mutation_authorized')::boolean,true) then raise exception 'G4 auth OAT authorization failed %',auth1; end if;
  auth2:=public.growth_g4_record_serviceos_handoff_authorization(v_org,v_bu,v_jur,(plan1->>'plan_id')::uuid,plan1->>'object_plan_hash',v_reviewer,now()+interval '1 hour','G4-OAT-AUTH-1','Synthetic approval',jsonb_build_object('synthetic',true));
  if auth2->>'status'<>'AUTHORIZED_EXCEPT_HANDOFF_GATE' or coalesce((auth2->>'idempotent_replay')::boolean,false) is not true or auth2->>'authorization_id'<>auth1->>'authorization_id' then raise exception 'G4 auth OAT replay failed %',auth2; end if;
  auth_eval:=public.growth_g4_evaluate_serviceos_handoff_authorization(v_org,v_bu,v_jur,(auth1->>'authorization_id')::uuid);
  if auth_eval->>'status'<>'AUTHORIZED_EXCEPT_HANDOFF_GATE' or coalesce((auth_eval->>'serviceos_mutation_authorized')::boolean,true) then raise exception 'G4 auth OAT gate-off evaluation failed %',auth_eval; end if;

  begin
    update growth.serviceos_handoff_authorization set metadata=jsonb_build_object('tampered',true) where id=(auth1->>'authorization_id')::uuid;
    raise exception 'G4 auth OAT immutable authorization update unexpectedly succeeded';
  exception when others then if sqlerrm='G4 auth OAT immutable authorization update unexpectedly succeeded' then raise; end if; end;

  insert into growth.suppression(organization_id,jurisdiction_id,prospect_id,channel,identity_type,identity_value_normalized,reason,source,active,metadata)
  values(v_org,v_jur,p1,'email','email','g4-auth-one@example.invalid','opt_out','synthetic_oat',true,jsonb_build_object('synthetic',true));
  blocked:=public.growth_g4_evaluate_serviceos_handoff_authorization(v_org,v_bu,v_jur,(auth1->>'authorization_id')::uuid);
  if blocked->>'status'<>'BLOCKED' or not (blocked->'blocking_reasons' ? 'active_suppression') then raise exception 'G4 auth OAT stale suppression did not block %',blocked; end if;
  delete from growth.suppression where prospect_id=p1 and source='synthetic_oat';

  revoke1:=public.growth_g4_revoke_serviceos_handoff_authorization(v_org,v_bu,v_jur,(auth1->>'authorization_id')::uuid,v_reviewer,'G4-OAT-REVOKE-1','Synthetic revocation',jsonb_build_object('synthetic',true));
  if revoke1->>'status'<>'REVOKED' then raise exception 'G4 auth OAT revoke failed %',revoke1; end if;
  blocked:=public.growth_g4_evaluate_serviceos_handoff_authorization(v_org,v_bu,v_jur,(auth1->>'authorization_id')::uuid);
  if blocked->>'status'<>'BLOCKED' or not (blocked->'blocking_reasons' ? 'authorization_revoked') then raise exception 'G4 auth OAT revoked auth did not block %',blocked; end if;

  if (select count(*) from public.customer)<>v_before_customer or (select count(*) from public.contact)<>v_before_contact or (select count(*) from public.service_location)<>v_before_loc or (select count(*) from public.service_request)<>v_before_sr or (select count(*) from public.opportunity)<>v_before_opp then raise exception 'G4 auth OAT canonical ServiceOS mutation occurred'; end if;
end $$;

rollback;

select
 (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate,
 (select count(*) from growth.serviceos_handoff_authorization where approval_reference='G4-OAT-AUTH-1') as persisted_authorizations,
 (select count(*) from growth.serviceos_handoff_authorization_revocation where revocation_reference='G4-OAT-REVOKE-1') as persisted_revocations,
 (select count(*) from growth.prospect where external_prospect_key='G4-OAT-AUTH-1') as persisted_synthetic_prospects,
 (select count(*) from public.marketing_source where code='g4_oat_auth_synthetic') as persisted_synthetic_sources;
