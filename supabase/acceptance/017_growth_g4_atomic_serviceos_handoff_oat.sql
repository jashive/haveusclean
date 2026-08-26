begin;

do $$
declare
 v_org uuid:='411e167e-506b-4304-9428-11b7cfc98e15'; v_bu uuid:='03334f81-9f30-408d-bfd1-74579ebf6426'; v_jur uuid:='09340f23-f2fb-4c26-adbf-c1c1c625f8c6'; v_user uuid:='ff592a32-a91c-42ad-a39f-e3b540d6fad5';
 p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); ce uuid; qr jsonb; hc uuid; pre jsonb; src uuid:=gen_random_uuid(); pl jsonb; au jsonb; le jsonb; ex1 jsonb; ex2 jsonb;
 v_cust uuid; v_cont uuid; v_loc uuid; v_sr uuid; v_opp uuid;
begin
 insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,address_line1,postal_code,facility_type,service_need_summary,verification_status,risk_flags,missing_fields,metadata)
 values(p,v_org,v_bu,v_jur,'G4-OAT-EXEC-1','engaged','synthetic_oat_exec','Toronto','CA','ON','G4 Execute Synthetic','office','400 Test Execute Ave','M5V1A4','office','Recurring commercial cleaning inquiry','verified','[]','[]',jsonb_build_object('synthetic',true));
 insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,email,phone,contact_source,verification_status,is_primary_candidate,metadata,review_status)
 values(c,p,v_org,v_bu,v_jur,'Execute','Buyer','g4-exec-one@example.invalid','4165550166','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
 insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload)
 values(e,v_org,v_bu,v_jur,p,c,'email','reply',now(),jsonb_build_object('synthetic',true));
 ce:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p,c,e,'positive_interest','deterministic','g4-exec-oat',0.99,'{}'::jsonb);
 qr:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p,c,e,ce,'qualified',true,true,true,v_user,'Synthetic G4 execution qualification','G4-OAT-EXEC-QUAL-1','{}'::jsonb);
 hc:=(qr->>'handoff_candidate_id')::uuid; update growth.prospect set lifecycle_status='handoff_ready' where id=p;
 pre:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc);
 insert into public.marketing_source(id,organization_id,code,name,source_type,status,metadata) values(src,v_org,'g4_oat_exec_synthetic','G4 OAT Exec Synthetic','synthetic','active',jsonb_build_object('growth_source_lane','synthetic_oat_exec'));
 pl:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre->>'reservation_id')::uuid);
 au:=public.growth_g4_record_serviceos_handoff_authorization(v_org,v_bu,v_jur,(pl->>'plan_id')::uuid,pl->>'object_plan_hash',v_user,now()+interval '1 hour','G4-OAT-EXEC-AUTH-1','Synthetic execution approval','{}'::jsonb);
 update growth.feature_gate set enabled=true where gate_code='growth_serviceos_handoff_enabled';
 le:=public.growth_g4_issue_serviceos_handoff_execution_lease(v_org,v_bu,v_jur,(au->>'authorization_id')::uuid);
 if le->>'status'<>'LEASE_ISSUED' then raise exception 'G4 exec OAT lease failed %',le; end if;
 ex1:=public.growth_g4_execute_serviceos_handoff(v_org,v_bu,v_jur,(le->>'lease_id')::uuid,le->>'execution_token');
 if ex1->>'status'<>'HANDOFF_SUCCEEDED' then raise exception 'G4 exec OAT handoff failed %',ex1; end if;
 v_cust:=(ex1->>'customer_id')::uuid; v_cont:=(ex1->>'contact_id')::uuid; v_loc:=nullif(ex1->>'service_location_id','')::uuid; v_sr:=(ex1->>'service_request_id')::uuid; v_opp:=(ex1->>'opportunity_id')::uuid;
 if not exists(select 1 from public.customer where id=v_cust and organization_id=v_org and business_unit_id=v_bu) then raise exception 'G4 exec OAT customer missing'; end if;
 if not exists(select 1 from public.contact where id=v_cont and customer_id=v_cust) then raise exception 'G4 exec OAT contact missing'; end if;
 if v_loc is null or not exists(select 1 from public.service_location where id=v_loc and customer_id=v_cust and jurisdiction_id=v_jur) then raise exception 'G4 exec OAT location missing'; end if;
 if not exists(select 1 from public.service_request where id=v_sr and organization_id=v_org and business_unit_id=v_bu and customer_id=v_cust and contact_id=v_cont and service_location_id=v_loc and lifecycle_status='qualified') then raise exception 'G4 exec OAT service request missing or wrong scope'; end if;
 if not exists(select 1 from public.opportunity where id=v_opp and service_request_id=v_sr and organization_id=v_org and business_unit_id=v_bu and stage='qualified') then raise exception 'G4 exec OAT opportunity missing or wrong scope'; end if;
 if not exists(select 1 from growth.handoff_candidate where id=hc and status='succeeded' and serviceos_customer_id=v_cust and serviceos_contact_id=v_cont and serviceos_location_id=v_loc and serviceos_service_request_id=v_sr and serviceos_opportunity_id=v_opp) then raise exception 'G4 exec OAT Growth acknowledgment missing'; end if;
 if not exists(select 1 from growth.serviceos_handoff_execution_lease where id=(le->>'lease_id')::uuid and lease_status='consumed' and consumed_at is not null) then raise exception 'G4 exec OAT lease not consumed'; end if;
 if not exists(select 1 from public.idempotency_key where scope='growth_g4_serviceos_handoff' and key='handoff_candidate:'||hc::text and response_code=200 and request_hash=pl->>'object_plan_hash') then raise exception 'G4 exec OAT canonical idempotency record missing'; end if;
 if (select count(*) from public.external_reference where system_name='growth_layer_1_0' and metadata->>'handoff_candidate_id'=hc::text) < 5 then raise exception 'G4 exec OAT expected canonical external references missing'; end if;
 ex2:=public.growth_g4_execute_serviceos_handoff(v_org,v_bu,v_jur,(le->>'lease_id')::uuid,le->>'execution_token');
 if ex2->>'status'<>'HANDOFF_SUCCEEDED' or coalesce((ex2->>'idempotent_replay')::boolean,false) is not true or ex2->>'service_request_id'<>v_sr::text or ex2->>'opportunity_id'<>v_opp::text then raise exception 'G4 exec OAT idempotent replay failed %',ex2; end if;
 if (select count(*) from public.service_request where id=v_sr)<>1 or (select count(*) from public.opportunity where id=v_opp)<>1 then raise exception 'G4 exec OAT replay duplicated canonical objects'; end if;
 update growth.feature_gate set enabled=false where gate_code='growth_serviceos_handoff_enabled';
end $$;
rollback;
select (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') handoff_gate,
(select count(*) from growth.prospect where external_prospect_key='G4-OAT-EXEC-1') persisted_prospects,
(select count(*) from public.marketing_source where code='g4_oat_exec_synthetic') persisted_sources,
(select count(*) from growth.serviceos_handoff_authorization where approval_reference='G4-OAT-EXEC-AUTH-1') persisted_authorizations,
(select count(*) from public.service_request where metadata->>'growth_handoff_candidate_id' in (select id::text from growth.handoff_candidate where prospect_id in (select id from growth.prospect where external_prospect_key='G4-OAT-EXEC-1'))) persisted_service_requests;
