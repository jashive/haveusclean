-- Growth Layer G6 staged activation + quota + production provider-lease hardening OAT.
-- SYNTHETIC / ACCEPTANCE DB / ROLLBACK ONLY. No real credentials, provider API or network send.
begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_sender uuid;
  v_p1 uuid := gen_random_uuid(); v_c1 uuid := gen_random_uuid(); v_b1 uuid; v_a1 uuid; v_attempt1 uuid; v_res1 uuid;
  v_p2 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid(); v_b2 uuid; v_a2 uuid; v_attempt2 uuid; v_res2 uuid;
  v_contract uuid; v_preflight jsonb; v_tmp jsonb; v_binding uuid; v_allow uuid; v_activation uuid;
  v_from timestamptz := now()-interval '1 minute'; v_until timestamptz := now()+interval '1 day';
  v_type text; v_policy jsonb; v_ready jsonb; v_stage jsonb; v_stage_id uuid; v_eval jsonb;
  v_lease jsonb; v_lease2 jsonb; v_lease_id uuid; v_token text; v_consume jsonb; v_gate record;
begin
  for v_gate in select gate_code,enabled from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') loop
    if v_gate.enabled then raise exception 'G6 OAT 025 requires protected gate OFF at start: %',v_gate.gate_code; end if;
  end loop;

  v_sender := public.growth_g2_register_sender_identity(v_org,v_bu,v_jur,'g6-stage-sender@example.invalid','G6 Staged Synthetic Sender',jsonb_build_object('synthetic',true,'g6_oat',25));
  perform public.growth_g2_review_sender_identity(v_sender,'approved',v_reviewer,now()+interval '30 days','G6 OAT 025');
  perform public.growth_g2_record_sender_auth_evidence(v_sender,'pass','pass','pass','synthetic_oat','G6-OAT-025-AUTH',now(),now()+interval '7 days',v_reviewer,'accepted',jsonb_build_object('synthetic',true,'g6_oat',25));
  perform public.growth_g2_refresh_sender_health_from_events(v_sender,now()-interval '24 hours',now());

  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values
    (v_p1,v_org,v_bu,v_jur,'G6-OAT-025-ON-1','review_ready','synthetic_oat','Toronto','CA','ON','G6 OAT 025 Company 1','office','verified','[]'::jsonb,'[]'::jsonb,jsonb_build_object('synthetic',true,'g6_oat',25)),
    (v_p2,v_org,v_bu,v_jur,'G6-OAT-025-ON-2','review_ready','synthetic_oat','Toronto','CA','ON','G6 OAT 025 Company 2','office','verified','[]'::jsonb,'[]'::jsonb,jsonb_build_object('synthetic',true,'g6_oat',25));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,buyer_title,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values
    (v_c1,v_p1,v_org,v_bu,v_jur,'Synthetic','One','Office Manager','g6-stage-target-1@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true,'g6_oat',25),'accepted'),
    (v_c2,v_p2,v_org,v_bu,v_jur,'Synthetic','Two','Office Manager','g6-stage-target-2@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true,'g6_oat',25),'accepted');

  v_b1 := public.growth_g2_record_legal_basis(v_org,v_bu,v_jur,v_p1,v_c1,'email','implied_consent_conspicuously_published_business_contact','synthetic_oat','G6-OAT-025-CASL-1',jsonb_build_object('synthetic',true),now()+interval '7 days');
  perform public.growth_g2_review_legal_basis(v_org,v_bu,v_jur,v_p1,v_c1,v_b1,'accepted',v_reviewer,'G6 OAT 025');
  v_a1 := public.growth_g2_create_approval_request(v_org,v_bu,v_jur,v_p1,v_c1,v_b1,'G6 OAT 025 approved subject 1','Synthetic approved body 1','g6-stage-sender@example.invalid','G6-OAT-025-APPROVAL-1',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_bu,v_jur,v_p1,v_c1,v_a1,'approved',v_reviewer,true,true,now()+interval '24 hours','G6 OAT 025');
  v_b2 := public.growth_g2_record_legal_basis(v_org,v_bu,v_jur,v_p2,v_c2,'email','implied_consent_conspicuously_published_business_contact','synthetic_oat','G6-OAT-025-CASL-2',jsonb_build_object('synthetic',true),now()+interval '7 days');
  perform public.growth_g2_review_legal_basis(v_org,v_bu,v_jur,v_p2,v_c2,v_b2,'accepted',v_reviewer,'G6 OAT 025');
  v_a2 := public.growth_g2_create_approval_request(v_org,v_bu,v_jur,v_p2,v_c2,v_b2,'G6 OAT 025 approved subject 2','Synthetic approved body 2','g6-stage-sender@example.invalid','G6-OAT-025-APPROVAL-2',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_bu,v_jur,v_p2,v_c2,v_a2,'approved',v_reviewer,true,true,now()+interval '24 hours','G6 OAT 025');

  v_contract := public.growth_g2_register_provider_adapter_contract(v_org,v_bu,v_jur,'g6-oat-provider','contract-v1',true,true,true,true,v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true,'g6_oat',25,'contract_only',true));
  v_binding := public.growth_g2_register_provider_runtime_binding(v_org,v_bu,v_jur,'g6-oat-provider','production','g6-oat-adapter','G6_OAT_PROVIDER_TOKEN_REF_ONLY','configured_external',v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true,'g6_oat',25,'acceptance_db_only',true,'no_secret_present',true));
  v_allow := public.growth_g2_register_provider_adapter_allowlist(v_org,v_bu,v_jur,'g6-oat-provider','production','g6-oat-adapter','1.0.0',v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true,'g6_oat',25,'acceptance_db_only',true));
  v_activation := public.growth_g2_record_provider_activation_approval(v_org,v_bu,v_jur,'g6-oat-provider','production','g6-oat-adapter','1.0.0',v_reviewer,now()+interval '1 hour','G6-OAT-025-PROVIDER-ACTIVATION',jsonb_build_object('synthetic',true,'g6_oat',25,'acceptance_db_only',true));

  -- Build two valid non-sending reservations using only the outreach gate, then restore gates OFF before G6 authorization.
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_outreach_enabled';
  v_attempt1 := public.growth_g2_create_non_sending_attempt(v_org,v_bu,v_jur,v_p1,v_c1,v_a1);
  v_preflight := public.growth_g2_reserve_submission_preflight(v_org,v_bu,v_jur,v_attempt1,'g6-oat-provider');
  if v_preflight->>'status'<>'READY_EXCEPT_PROVIDER' then raise exception 'G6 OAT 025 preflight1 failed: %',v_preflight; end if;
  v_res1 := (v_preflight->>'reservation_id')::uuid;
  v_attempt2 := public.growth_g2_create_non_sending_attempt(v_org,v_bu,v_jur,v_p2,v_c2,v_a2);
  v_preflight := public.growth_g2_reserve_submission_preflight(v_org,v_bu,v_jur,v_attempt2,'g6-oat-provider');
  if v_preflight->>'status'<>'READY_EXCEPT_PROVIDER' then raise exception 'G6 OAT 025 preflight2 failed: %',v_preflight; end if;
  v_res2 := (v_preflight->>'reservation_id')::uuid;

  -- Old G2 gates alone must no longer be enough for a production-mode lease.
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_provider_execution_enabled';
  v_tmp := public.growth_g2_issue_provider_execution_lease(v_org,v_bu,v_jur,v_res1,'g6-oat-provider','production','g6-oat-adapter','1.0.0');
  if v_tmp->>'status'<>'BLOCKED' or not (v_tmp->'blocking_reasons' ? 'g6_staged_activation_authorization_missing') then raise exception 'G6 OAT 025: production lease bypassed missing G6 auth: %',v_tmp; end if;
  update growth.feature_gate set enabled=false,updated_at=now() where gate_code in ('growth_outreach_enabled','growth_provider_execution_enabled');

  foreach v_type in array array['legal_compliance_approval','provider_security_review','sender_domain_readiness','monitoring_alerting_readiness','rollback_emergency_stop_readiness','staff_sop_training_ready','hems_pilot_approval'] loop
    perform public.growth_g6_record_commissioning_evidence(v_org,v_bu,v_jur,'production',v_type,'G6-OAT-025 evidence '||v_type,v_reviewer,v_from,v_until,'G6-OAT-025-'||v_type,jsonb_build_object('synthetic',true,'g6_oat',25,'acceptance_db_only',true));
  end loop;
  v_policy := public.growth_g6_record_pilot_policy(v_org,v_bu,v_jur,'production','g6-oat-provider','g6-oat-adapter','1.0.0','g6-stage-sender@example.invalid',1,1,v_reviewer,'G6-OAT-025-PILOT','One-send production-shaped micro-pilot in rollback-only Acceptance OAT',v_from,v_until,'G6-OAT-025-PILOT',jsonb_build_object('synthetic',true,'g6_oat',25,'acceptance_db_only',true));
  v_ready := public.growth_g6_commissioning_readiness(v_org,v_bu,v_jur,'production');
  if v_ready->>'status'<>'READY_FOR_STAGED_ACTIVATION_REQUEST' or coalesce((v_ready->>'execution_authorized')::boolean,true) or coalesce((v_ready->>'gate_mutation_performed')::boolean,true) then raise exception 'G6 OAT 025: pre-activation readiness not exact: %',v_ready; end if;
  v_stage := public.growth_g6_record_staged_activation_authorization(v_org,v_bu,v_jur,'production',v_reviewer,'G6-OAT-025-STAGED-AUTH','Rollback-only production-shaped staged activation authorization',now()+interval '30 minutes','G6-OAT-025-STAGED-AUTH',jsonb_build_object('synthetic',true,'g6_oat',25,'acceptance_db_only',true));
  if v_stage->>'status'<>'STAGED_ACTIVATION_AUTHORIZED' or coalesce((v_stage->>'gate_mutation_performed')::boolean,true) then raise exception 'G6 OAT 025: staged auth failed: %',v_stage; end if;
  v_stage_id := (v_stage->>'authorization_id')::uuid;
  v_eval := public.growth_g6_evaluate_staged_activation_authorization(v_stage_id);
  if v_eval->>'status'<>'AUTHORIZED_FOR_STAGED_ACTIVATION' then raise exception 'G6 OAT 025: current staged auth did not evaluate: %',v_eval; end if;
  for v_gate in select gate_code,enabled from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') loop if v_gate.enabled then raise exception 'G6 OAT 025: staged authorization mutated protected gate: %',v_gate.gate_code; end if; end loop;

  -- Simulate deliberate micro-stage activation only after authorization. Handoff and auto-followup remain OFF.
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code in ('growth_outreach_enabled','growth_provider_execution_enabled');
  if exists(select 1 from growth.feature_gate where gate_code in ('growth_auto_followup_enabled','growth_serviceos_handoff_enabled') and enabled=true) then raise exception 'G6 OAT 025: later-stage gate unexpectedly enabled'; end if;

  v_lease := public.growth_g2_issue_provider_execution_lease(v_org,v_bu,v_jur,v_res1,'g6-oat-provider','production','g6-oat-adapter','1.0.0');
  if v_lease->>'status'<>'LEASE_ISSUED' or v_lease->>'g6_staged_activation_authorization_id'<>v_stage_id::text or nullif(v_lease->>'g6_pilot_send_reservation_id','') is null then raise exception 'G6 OAT 025: authorized production lease not G6-bound: %',v_lease; end if;
  v_lease_id := (v_lease->>'lease_id')::uuid; v_token:=v_lease->>'execution_token';
  if not exists(select 1 from growth.pilot_send_reservation s where s.id=(v_lease->>'g6_pilot_send_reservation_id')::uuid and s.quota_timezone='America/Toronto' and s.staged_activation_authorization_id=v_stage_id) then raise exception 'G6 OAT 025: local-time quota reservation missing/mismatched'; end if;
  if (select count(*) from growth.pilot_send_reservation where staged_activation_authorization_id=v_stage_id)<>1 then raise exception 'G6 OAT 025: first send did not reserve exactly one quota slot'; end if;

  v_lease2 := public.growth_g2_issue_provider_execution_lease(v_org,v_bu,v_jur,v_res2,'g6-oat-provider','production','g6-oat-adapter','1.0.0');
  if v_lease2->>'status'<>'BLOCKED' or not (v_lease2->'blocking_reasons' ? 'pilot_total_send_cap_reached') then raise exception 'G6 OAT 025: total pilot cap failed closed: %',v_lease2; end if;
  if (select count(*) from growth.provider_execution_lease where g6_staged_activation_authorization_id=v_stage_id)<>1 then raise exception 'G6 OAT 025: blocked second send still created lease'; end if;

  perform public.growth_g6_revoke_staged_activation_authorization(v_stage_id,v_reviewer,'G6 OAT 025 revocation proof');
  v_eval := public.growth_g6_evaluate_staged_activation_authorization(v_stage_id);
  if v_eval->>'status'<>'BLOCKED' or not (v_eval->'blocking_reasons' ? 'authorization_revoked') then raise exception 'G6 OAT 025: revocation did not invalidate staged auth: %',v_eval; end if;
  v_consume := public.growth_g2_consume_provider_execution_lease(v_org,v_bu,v_jur,v_lease_id,v_token,'g6-oat-provider','production','g6-oat-adapter','1.0.0');
  if v_consume->>'status'<>'BLOCKED' or not (v_consume->'blocking_reasons' ? 'authorization_revoked') then raise exception 'G6 OAT 025: revoked G6 auth did not block lease consumption: %',v_consume; end if;
  if not exists(select 1 from growth.provider_execution_lease where id=v_lease_id and lease_status='issued' and consumed_at is null) then raise exception 'G6 OAT 025: blocked consumption burned lease unexpectedly'; end if;

  update growth.feature_gate set enabled=false,updated_at=now() where gate_code in ('growth_outreach_enabled','growth_provider_execution_enabled');
  for v_gate in select gate_code,enabled from growth.feature_gate where gate_code in ('growth_outreach_enabled','growth_auto_followup_enabled','growth_provider_execution_enabled','growth_serviceos_handoff_enabled') loop if v_gate.enabled then raise exception 'G6 OAT 025: protected gate not restored OFF: %',v_gate.gate_code; end if; end loop;
end $$;

select 'PASS' as g6_oat_025_staged_activation_quota_provider_lease,
       (select count(*) from growth.staged_activation_authorization where idempotency_key='G6-OAT-025-STAGED-AUTH') as staged_auth_inside_tx,
       (select count(*) from growth.pilot_send_reservation) as send_reservations_inside_tx,
       (select count(*) from growth.provider_execution_lease where g6_staged_activation_authorization_id is not null) as g6_bound_leases_inside_tx;
rollback;

select
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate_after_rollback,
  (select enabled from growth.feature_gate where gate_code='growth_provider_execution_enabled') as provider_gate_after_rollback,
  (select enabled from growth.feature_gate where gate_code='growth_auto_followup_enabled') as auto_followup_gate_after_rollback,
  (select enabled from growth.feature_gate where gate_code='growth_serviceos_handoff_enabled') as handoff_gate_after_rollback,
  (select count(*) from growth.prospect where external_prospect_key like 'G6-OAT-025-%') as persisted_oat_prospects,
  (select count(*) from growth.staged_activation_authorization where idempotency_key='G6-OAT-025-STAGED-AUTH') as persisted_oat_authorizations,
  (select count(*) from growth.provider_execution_lease where g6_staged_activation_authorization_id is not null) as persisted_g6_bound_leases;
