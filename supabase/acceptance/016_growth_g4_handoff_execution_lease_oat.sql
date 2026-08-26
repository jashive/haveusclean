begin;

do $$
declare
 v_org uuid:='411e167e-506b-4304-9428-11b7cfc98e15'; v_bu uuid:='03334f81-9f30-408d-bfd1-74579ebf6426'; v_jur uuid:='09340f23-f2fb-4c26-adbf-c1c1c625f8c6'; v_user uuid:='ff592a32-a91c-42ad-a39f-e3b540d6fad5';
 p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); ce uuid; qr jsonb; hc uuid; pre jsonb; src uuid:=gen_random_uuid(); pl jsonb; au jsonb; lease0 jsonb; lease1 jsonb; lease2 jsonb; rev jsonb; v_hash text;
begin
 insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,address_line1,postal_code,facility_type,service_need_summary,verification_status,risk_flags,missing_fields,metadata)
 values(p,v_org,v_bu,v_jur,'G4-OAT-LEASE-1','engaged','synthetic_oat_lease','Toronto','CA','ON','G4 Lease Synthetic','office','300 Test Lease Ave','M5V1A3','office','Recurring commercial cleaning inquiry','verified','[]','[]',jsonb_build_object('synthetic',true));
 insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,email,phone,contact_source,verification_status,is_primary_candidate,metadata,review_status)
 values(c,p,v_org,v_bu,v_jur,'Lease','Buyer','g4-lease-one@example.invalid','4165550177','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
 insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
 values(e,v_org,v_bu,v_jur,p,c,'email','reply',now(),jsonb_build_object('synthetic',true));
 ce:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p,c,e,'positive_interest','deterministic','g4-lease-oat',0.99,'{}'::jsonb);
 qr:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p,c,e,ce,'qualified',true,true,true,v_user,'Synthetic G4 lease qualification','G4-OAT-LEASE-QUAL-1','{}'::jsonb);
 hc:=(qr->>'handoff_candidate_id')::uuid; update growth.prospect set lifecycle_status='handoff_ready' where id=p;
 pre:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc);
 insert into public.marketing_source(id,organization_id,code,name,source_type,status,metadata) values(src,v_org,'g4_oat_lease_synthetic','G4 OAT Lease Synthetic','synthetic','active',jsonb_build_object('growth_source_lane','synthetic_oat_lease'));
 pl:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre->>'reservation_id')::uuid);
 au:=public.growth_g4_record_serviceos_handoff_authorization(v_org,v_bu,v_jur,(pl->>'plan_id')::uuid,pl->>'object_plan_hash',v_user,now()+interval '1 hour','G4-OAT-LEASE-AUTH-1','Synthetic lease approval','{}'::jsonb);
 lease0:=public.growth_g4_issue_serviceos_handoff_execution_lease(v_org,v_bu,v_jur,(au->>'authorization_id')::uuid);
 if lease0->>'status'<>'AUTHORIZED_EXCEPT_HANDOFF_GATE' then raise exception 'G4 lease OAT gate-off did not block %',lease0; end if;
 if exists(select 1 from growth.serviceos_handoff_execution_lease l where l.authorization_id=(au->>'authorization_id')::uuid) then raise exception 'G4 lease OAT lease persisted while gate off'; end if;
 update growth.feature_gate set enabled=true where gate_code='growth_serviceos_handoff_enabled';
 lease1:=public.growth_g4_issue_serviceos_handoff_execution_lease(v_org,v_bu,v_jur,(au->>'authorization_id')::uuid);
 if lease1->>'status'<>'LEASE_ISSUED' or nullif(lease1->>'execution_token','') is null then raise exception 'G4 lease OAT issue failed %',lease1; end if;
 select lease_token_hash into v_hash from growth.serviceos_handoff_execution_lease where id=(lease1->>'lease_id')::uuid;
 if v_hash=lease1->>'execution_token' or length(v_hash)<>64 then raise exception 'G4 lease OAT raw token persisted or hash malformed'; end if;
 if (select expires_at-issued_at > interval '10 minutes' from growth.serviceos_handoff_execution_lease where id=(lease1->>'lease_id')::uuid) then raise exception 'G4 lease OAT lease exceeds 10 minutes'; end if;
 lease2:=public.growth_g4_issue_serviceos_handoff_execution_lease(v_org,v_bu,v_jur,(au->>'authorization_id')::uuid);
 if lease2->>'status'<>'BLOCKED' or not (lease2->'blocking_reasons' ? 'authorization_lease_already_exists') then raise exception 'G4 lease OAT duplicate lease did not block %',lease2; end if;
 rev:=public.growth_g4_revoke_serviceos_handoff_execution_lease(v_org,v_bu,v_jur,(lease1->>'lease_id')::uuid,'Synthetic revoke');
 if rev->>'status'<>'REVOKED' then raise exception 'G4 lease OAT revoke failed %',rev; end if;
 update growth.feature_gate set enabled=false where gate_code='growth_serviceos_handoff_enabled';
end $$;
rollback;
select (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') handoff_gate,
(select count(*) from growth.serviceos_handoff_execution_lease l join growth.serviceos_handoff_authorization a on a.id=l.authorization_id where a.approval_reference='G4-OAT-LEASE-AUTH-1') persisted_leases,
(select count(*) from growth.serviceos_handoff_authorization where approval_reference='G4-OAT-LEASE-AUTH-1') persisted_authorizations,
(select count(*) from growth.prospect where external_prospect_key='G4-OAT-LEASE-1') persisted_prospects,
(select count(*) from public.marketing_source where code='g4_oat_lease_synthetic') persisted_sources;
