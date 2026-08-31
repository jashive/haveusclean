-- G6 emergency-stop + separately capped G4 handoff pilot OAT.
-- Acceptance-only / synthetic / rollback-only.
begin;

do $$
declare
  v_org uuid:='411e167e-506b-4304-9428-11b7cfc98e15'; v_bu uuid:='03334f81-9f30-408d-bfd1-74579ebf6426'; v_jur uuid:='09340f23-f2fb-4c26-adbf-c1c1c625f8c6'; v_user uuid:='ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  p1 uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); e1 uuid:=gen_random_uuid(); ce1 uuid; qr1 jsonb; hc1 uuid; pre1 jsonb; pl1 jsonb; au1 jsonb; le1 jsonb; ex1 jsonb;
  p2 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid(); ce2 uuid; qr2 jsonb; hc2 uuid; pre2 jsonb; pl2 jsonb; au2 jsonb; le2 jsonb;
  src uuid:=gen_random_uuid(); v_type text; v_hpolicy jsonb; v_hpolicy_id uuid; v_heval jsonb; v_tmp jsonb;
  v_policy_id uuid:=gen_random_uuid(); v_stage_id uuid:=gen_random_uuid(); v_binding uuid; v_allow uuid; v_activation uuid; v_stop jsonb; v_gate record;
begin
  for v_gate in select gate_code,enabled from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') loop if v_gate.enabled then raise exception 'G6 OAT 026 requires protected gates OFF at start: %',v_gate.gate_code; end if; end loop;

  foreach v_type in array array['serviceos_handoff_pilot_ready','monitoring_alerting_readiness','rollback_emergency_stop_readiness','staff_sop_training_ready','hems_pilot_approval'] loop
    perform public.growth_g6_record_commissioning_evidence(v_org,v_bu,v_jur,'production',v_type,'G6-OAT-026 evidence '||v_type,v_user,now()-interval '1 minute',now()+interval '1 day','G6-OAT-026-'||v_type,jsonb_build_object('synthetic',true,'g6_oat',26,'acceptance_db_only',true));
  end loop;
  insert into public.marketing_source(id,organization_id,code,name,source_type,status,metadata) values(src,v_org,'g6_oat_026_source','G6 OAT 026 Source','synthetic','active',jsonb_build_object('growth_source_lane','g6_oat_026'));

  -- First G4 candidate.
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,address_line1,postal_code,facility_type,service_need_summary,verification_status,risk_flags,missing_fields,metadata)
  values(p1,v_org,v_bu,v_jur,'G6-OAT-026-HANDOFF-1','engaged','g6_oat_026','Toronto','CA','ON','G6 Handoff Synthetic 1','office','500 Pilot Test Ave','M5V1A4','office','Recurring commercial cleaning inquiry','verified','[]','[]',jsonb_build_object('synthetic',true,'g6_oat',26));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,email,phone,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c1,p1,v_org,v_bu,v_jur,'Handoff','One','g6-handoff-one@example.invalid','4165550261','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload) values(e1,v_org,v_bu,v_jur,p1,c1,'email','reply',now(),jsonb_build_object('synthetic',true));
  ce1:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p1,c1,e1,'positive_interest','deterministic','g6-oat-026',0.99,'{}'::jsonb);
  qr1:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p1,c1,e1,ce1,'qualified',true,true,true,v_user,'G6 OAT 026 qualification 1','G6-OAT-026-QUAL-1','{}'::jsonb);
  hc1:=(qr1->>'handoff_candidate_id')::uuid; update growth.prospect set lifecycle_status='handoff_ready' where id=p1;
  pre1:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc1);
  pl1:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre1->>'reservation_id')::uuid);
  au1:=public.growth_g4_record_serviceos_handoff_authorization(v_org,v_bu,v_jur,(pl1->>'plan_id')::uuid,pl1->>'object_plan_hash',v_user,now()+interval '1 hour','G6-OAT-026-G4-AUTH-1','Synthetic handoff approval 1','{}'::jsonb);

  -- Existing G4 gate + G4 authorization cannot bypass G6.
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_serviceos_handoff_enabled';
  v_tmp:=public.growth_g4_issue_serviceos_handoff_execution_lease(v_org,v_bu,v_jur,(au1->>'authorization_id')::uuid);
  if v_tmp->>'status'<>'BLOCKED' or not (v_tmp->'blocking_reasons' ? 'handoff_pilot_policy_missing') then raise exception 'G6 OAT 026: G4 lease bypassed missing handoff pilot policy: %',v_tmp; end if;
  update growth.feature_gate set enabled=false,updated_at=now() where gate_code='growth_serviceos_handoff_enabled';

  v_hpolicy:=public.growth_g6_record_handoff_pilot_policy(v_org,v_bu,v_jur,1,v_user,'G6-OAT-026-HANDOFF-PILOT','One-handoff rollback-only Acceptance pilot',now()+interval '30 minutes','G6-OAT-026-HANDOFF-PILOT',jsonb_build_object('synthetic',true,'g6_oat',26,'acceptance_db_only',true));
  if v_hpolicy->>'status'<>'HANDOFF_PILOT_POLICY_APPROVED' or coalesce((v_hpolicy->>'gate_mutation_performed')::boolean,true) then raise exception 'G6 OAT 026: handoff pilot policy failed: %',v_hpolicy; end if;
  v_hpolicy_id:=(v_hpolicy->>'handoff_pilot_policy_id')::uuid;
  v_heval:=public.growth_g6_evaluate_handoff_pilot_policy(v_org,v_bu,v_jur);
  if v_heval->>'status'<>'HANDOFF_PILOT_AUTHORIZED' or (v_heval->>'remaining_handoffs')::int<>1 then raise exception 'G6 OAT 026: handoff policy not current: %',v_heval; end if;
  if (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') then raise exception 'G6 OAT 026: policy approval mutated handoff gate'; end if;

  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_serviceos_handoff_enabled';
  le1:=public.growth_g4_issue_serviceos_handoff_execution_lease(v_org,v_bu,v_jur,(au1->>'authorization_id')::uuid);
  if le1->>'status'<>'LEASE_ISSUED' or le1->>'g6_handoff_pilot_policy_id'<>v_hpolicy_id::text or nullif(le1->>'g6_handoff_pilot_reservation_id','') is null then raise exception 'G6 OAT 026: G6-bound G4 lease failed: %',le1; end if;
  ex1:=public.growth_g4_execute_serviceos_handoff(v_org,v_bu,v_jur,(le1->>'lease_id')::uuid,le1->>'execution_token');
  if ex1->>'status'<>'HANDOFF_SUCCEEDED' then raise exception 'G6 OAT 026: G4 atomic handoff regressed under G6: %',ex1; end if;
  if not exists(select 1 from public.service_request where id=(ex1->>'service_request_id')::uuid and lifecycle_status='qualified') or not exists(select 1 from public.opportunity where id=(ex1->>'opportunity_id')::uuid and stage='qualified') then raise exception 'G6 OAT 026: canonical ServiceOS outcomes missing'; end if;

  -- Second candidate proves handoff cap=1.
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,address_line1,postal_code,facility_type,service_need_summary,verification_status,risk_flags,missing_fields,metadata)
  values(p2,v_org,v_bu,v_jur,'G6-OAT-026-HANDOFF-2','engaged','g6_oat_026','Toronto','CA','ON','G6 Handoff Synthetic 2','office','501 Pilot Test Ave','M5V1A5','office','Recurring commercial cleaning inquiry','verified','[]','[]',jsonb_build_object('synthetic',true,'g6_oat',26));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,email,phone,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(c2,p2,v_org,v_bu,v_jur,'Handoff','Two','g6-handoff-two@example.invalid','4165550262','synthetic_oat','verified',true,jsonb_build_object('synthetic',true),'accepted');
  insert into growth.outreach_event(id,organization_id,business_unit_id,jurisdiction_id,prospect_id,contact_candidate_id,channel,event_type,occurred_at,payload) values(e2,v_org,v_bu,v_jur,p2,c2,'email','reply',now(),jsonb_build_object('synthetic',true));
  ce2:=public.growth_g3_record_reply_classification(v_org,v_bu,v_jur,p2,c2,e2,'positive_interest','deterministic','g6-oat-026',0.99,'{}'::jsonb);
  qr2:=public.growth_g3_record_qualification_review(v_org,v_bu,v_jur,p2,c2,e2,ce2,'qualified',true,true,true,v_user,'G6 OAT 026 qualification 2','G6-OAT-026-QUAL-2','{}'::jsonb);
  hc2:=(qr2->>'handoff_candidate_id')::uuid; update growth.prospect set lifecycle_status='handoff_ready' where id=p2;
  pre2:=public.growth_g4_reserve_serviceos_handoff_preflight(v_org,v_bu,v_jur,hc2);
  pl2:=public.growth_g4_build_serviceos_handoff_dry_run_plan(v_org,v_bu,v_jur,(pre2->>'reservation_id')::uuid);
  au2:=public.growth_g4_record_serviceos_handoff_authorization(v_org,v_bu,v_jur,(pl2->>'plan_id')::uuid,pl2->>'object_plan_hash',v_user,now()+interval '1 hour','G6-OAT-026-G4-AUTH-2','Synthetic handoff approval 2','{}'::jsonb);
  le2:=public.growth_g4_issue_serviceos_handoff_execution_lease(v_org,v_bu,v_jur,(au2->>'authorization_id')::uuid);
  if le2->>'status'<>'BLOCKED' or not (le2->'blocking_reasons' ? 'handoff_pilot_cap_reached') then raise exception 'G6 OAT 026: handoff cap failed closed: %',le2; end if;
  if (select count(*) from growth.handoff_pilot_reservation where handoff_pilot_policy_id=v_hpolicy_id)<>1 then raise exception 'G6 OAT 026: handoff cap created extra reservation'; end if;

  v_tmp:=public.growth_g6_revoke_handoff_pilot_policy(v_hpolicy_id,v_user,'G6 OAT 026 handoff stop');
  if v_tmp->>'status'<>'HANDOFF_PILOT_REVOKED' or not coalesce((v_tmp->>'handoff_gate_forced_off')::boolean,false) then raise exception 'G6 OAT 026: handoff policy revoke failed: %',v_tmp; end if;
  if (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') then raise exception 'G6 OAT 026: handoff gate remained ON after policy revoke'; end if;

  -- Emergency outreach stop fixture; no provider call/network send.
  insert into growth.pilot_policy(id,organization_id,business_unit_id,jurisdiction_id,environment_name,pilot_stage,provider_code,adapter_key,adapter_version,sender_email,daily_send_cap,total_send_cap,approved_by_app_user_id,approval_reference,approval_reason,valid_from,valid_until,idempotency_key,request_hash,metadata)
  values(v_policy_id,v_org,v_bu,v_jur,'production','manual_email_outreach','g6-oat-stop-provider','g6-oat-stop-adapter','1.0.0','g6-stop@example.invalid',1,1,v_user,'G6-OAT-026-STOP-POLICY','Emergency stop fixture',now()-interval '1 minute',now()+interval '1 hour','G6-OAT-026-STOP-POLICY',repeat('a',64),jsonb_build_object('synthetic',true,'g6_oat',26));
  insert into growth.staged_activation_authorization(id,organization_id,business_unit_id,jurisdiction_id,environment_name,pilot_policy_id,pilot_policy_request_hash,provider_code,adapter_key,adapter_version,sender_email,evidence_snapshot,runtime_prerequisite_fingerprint,approved_by_app_user_id,approval_reference,approval_reason,valid_until,idempotency_key,request_hash,metadata)
  values(v_stage_id,v_org,v_bu,v_jur,'production',v_policy_id,repeat('a',64),'g6-oat-stop-provider','g6-oat-stop-adapter','1.0.0','g6-stop@example.invalid','{}'::jsonb,repeat('b',64),v_user,'G6-OAT-026-STOP-AUTH','Emergency stop fixture',now()+interval '30 minutes','G6-OAT-026-STOP-AUTH',repeat('c',64),jsonb_build_object('synthetic',true,'g6_oat',26));
  v_binding:=public.growth_g2_register_provider_runtime_binding(v_org,v_bu,v_jur,'g6-oat-stop-provider','production','g6-oat-stop-adapter','G6_OAT_STOP_REF_ONLY','configured_external',v_user,now()+interval '1 hour',jsonb_build_object('synthetic',true,'g6_oat',26));
  v_allow:=public.growth_g2_register_provider_adapter_allowlist(v_org,v_bu,v_jur,'g6-oat-stop-provider','production','g6-oat-stop-adapter','1.0.0',v_user,now()+interval '1 hour',jsonb_build_object('synthetic',true,'g6_oat',26));
  v_activation:=public.growth_g2_record_provider_activation_approval(v_org,v_bu,v_jur,'g6-oat-stop-provider','production','g6-oat-stop-adapter','1.0.0',v_user,now()+interval '30 minutes','G6-OAT-026-STOP-ACTIVATION',jsonb_build_object('synthetic',true,'g6_oat',26));
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code in ('growth_outreach_enabled','growth_provider_execution_enabled','growth_auto_followup_enabled');
  v_stop:=public.growth_g6_emergency_stop_outreach_pilot(v_stage_id,v_user,'Synthetic emergency stop proof');
  if v_stop->>'status'<>'EMERGENCY_STOPPED' then raise exception 'G6 OAT 026: emergency stop failed: %',v_stop; end if;
  if exists(select 1 from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_provider_execution_enabled','growth_auto_followup_enabled') and enabled=true) then raise exception 'G6 OAT 026: emergency stop did not force outreach gates OFF'; end if;
  if not exists(select 1 from growth.staged_activation_authorization_revocation where authorization_id=v_stage_id) then raise exception 'G6 OAT 026: emergency stop did not revoke staged auth'; end if;
  if not exists(select 1 from growth.provider_runtime_binding where id=v_binding and binding_status='suspended') then raise exception 'G6 OAT 026: emergency stop did not suspend runtime binding'; end if;
  if not exists(select 1 from growth.provider_adapter_allowlist where id=v_allow and allowlist_status='suspended') then raise exception 'G6 OAT 026: emergency stop did not suspend allowlist'; end if;
  if not exists(select 1 from growth.provider_activation_approval where id=v_activation and approval_status='revoked') then raise exception 'G6 OAT 026: emergency stop did not revoke activation approval'; end if;

  for v_gate in select gate_code,enabled from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') loop if v_gate.enabled then raise exception 'G6 OAT 026: protected gate not OFF before rollback: %',v_gate.gate_code; end if; end loop;
end $$;

select 'PASS' as g6_oat_026_emergency_stop_handoff_pilot,
       (select count(*) from growth.handoff_pilot_policy where idempotency_key='G6-OAT-026-HANDOFF-PILOT') as handoff_policies_inside_tx,
       (select count(*) from growth.handoff_pilot_reservation) as handoff_slots_inside_tx,
       (select count(*) from public.service_request where metadata->>'growth_handoff_candidate_id' in (select id::text from growth.handoff_candidate where prospect_id in (select id from growth.prospect where external_prospect_key like 'G6-OAT-026-HANDOFF-%'))) as service_requests_inside_tx;
rollback;

select
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate,
  (select enabled from growth.feature_gate where gate_code='growth_provider_execution_enabled') as provider_gate,
  (select enabled from growth.feature_gate where gate_code='growth_auto_followup_enabled') as auto_followup_gate,
  (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate,
  (select count(*) from growth.prospect where external_prospect_key like 'G6-OAT-026-%') as persisted_oat_prospects,
  (select count(*) from growth.handoff_pilot_policy where idempotency_key='G6-OAT-026-HANDOFF-PILOT') as persisted_oat_handoff_policies,
  (select count(*) from public.marketing_source where code='g6_oat_026_source') as persisted_oat_sources;
