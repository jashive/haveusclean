-- Growth Layer G2 provider activation authorization + single-use execution lease acceptance OAT.
-- SYNTHETIC / NON-PRODUCTION / ROLLBACK ONLY. No real credentials, provider API, or network send.
begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_sender uuid; v_prospect uuid := gen_random_uuid(); v_contact uuid := gen_random_uuid(); v_basis uuid; v_approval uuid; v_attempt uuid; v_contract uuid;
  v_preflight jsonb; v_reservation uuid; v_binding_acceptance uuid; v_binding_prod uuid; v_allow_acceptance uuid; v_allow_prod uuid; v_activation_acceptance uuid; v_activation_prod uuid;
  v_auth jsonb; v_lease jsonb; v_consume jsonb; v_token text; v_lease_id uuid; v_acceptance_credential_blocked boolean := false;
begin
  v_sender := public.growth_g2_register_sender_identity(v_org,v_bu,v_jur,'g2-auth-sender@example.invalid','Synthetic Auth Sender',jsonb_build_object('synthetic',true,'not_for_outreach',true));
  perform public.growth_g2_review_sender_identity(v_sender,'approved',v_reviewer,now()+interval '30 days','synthetic auth OAT');
  perform public.growth_g2_record_sender_auth_evidence(v_sender,'pass','pass','pass','synthetic_oat','AUTH-OAT',now(),now()+interval '7 days',v_reviewer,'accepted',jsonb_build_object('synthetic',true));
  perform public.growth_g2_refresh_sender_health_from_events(v_sender,now()-interval '24 hours',now());
  insert into growth.prospect(id,organization_id,business_unit_id,jurisdiction_id,external_prospect_key,lifecycle_status,source_lane,city,country_code,subdivision_code,company_name,segment,verification_status,risk_flags,missing_fields,metadata)
  values(v_prospect,v_org,v_bu,v_jur,'G2-AUTH-OAT-ON','review_ready','synthetic_oat','Toronto','CA','ON','G2 Auth Synthetic Company','office','verified','[]'::jsonb,'[]'::jsonb,jsonb_build_object('synthetic',true,'not_for_outreach',true));
  insert into growth.prospect_contact_candidate(id,prospect_id,organization_id,business_unit_id,jurisdiction_id,first_name,last_name,buyer_title,email,contact_source,verification_status,is_primary_candidate,metadata,review_status)
  values(v_contact,v_prospect,v_org,v_bu,v_jur,'Synthetic','Auth','Office Manager','g2-auth-target@example.invalid','synthetic_oat','verified',true,jsonb_build_object('synthetic',true,'not_for_outreach',true),'accepted');
  v_basis := public.growth_g2_record_legal_basis(v_org,v_bu,v_jur,v_prospect,v_contact,'email','implied_consent_conspicuously_published_business_contact','synthetic_oat','G2-AUTH-CASL',jsonb_build_object('synthetic',true),now()+interval '7 days');
  perform public.growth_g2_review_legal_basis(v_org,v_bu,v_jur,v_prospect,v_contact,v_basis,'accepted',v_reviewer,'synthetic auth OAT');
  v_approval := public.growth_g2_create_approval_request(v_org,v_bu,v_jur,v_prospect,v_contact,v_basis,'Synthetic approved subject','Synthetic approved body','g2-auth-sender@example.invalid','G2-AUTH-APPROVAL',jsonb_build_object('synthetic',true));
  perform public.growth_g2_review_outreach_approval(v_org,v_bu,v_jur,v_prospect,v_contact,v_approval,'approved',v_reviewer,true,true,now()+interval '24 hours','synthetic auth OAT');
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_outreach_enabled';
  v_attempt := public.growth_g2_create_non_sending_attempt(v_org,v_bu,v_jur,v_prospect,v_contact,v_approval);
  v_contract := public.growth_g2_register_provider_adapter_contract(v_org,v_bu,v_jur,'synthetic-provider','contract-v1',true,true,true,true,v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true,'contract_only',true));
  v_preflight := public.growth_g2_reserve_submission_preflight(v_org,v_bu,v_jur,v_attempt,'synthetic-provider');
  if v_preflight->>'status'<>'READY_EXCEPT_PROVIDER' then raise exception 'G2 auth OAT failed: preflight not ready %',v_preflight; end if;
  v_reservation := (v_preflight->>'reservation_id')::uuid;

  v_binding_acceptance := public.growth_g2_register_provider_runtime_binding(v_org,v_bu,v_jur,'synthetic-provider','acceptance','synthetic-adapter','SYNTHETIC_PROVIDER_TOKEN','absent',v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true));
  v_allow_acceptance := public.growth_g2_register_provider_adapter_allowlist(v_org,v_bu,v_jur,'synthetic-provider','acceptance','synthetic-adapter','1.0.0',v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true));
  v_activation_acceptance := public.growth_g2_record_provider_activation_approval(v_org,v_bu,v_jur,'synthetic-provider','acceptance','synthetic-adapter','1.0.0',v_reviewer,now()+interval '1 hour','G2-AUTH-ACCEPTANCE',jsonb_build_object('synthetic',true));
  begin
    perform public.growth_g2_register_provider_runtime_binding(v_org,v_bu,v_jur,'synthetic-provider-2','acceptance','synthetic-adapter-2','SYNTHETIC_PROVIDER_TOKEN','configured_external',v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true));
  exception when others then
    if position('acceptance provider credentials must remain absent' in sqlerrm)>0 then v_acceptance_credential_blocked:=true; else raise; end if;
  end;
  if not v_acceptance_credential_blocked then raise exception 'G2 auth OAT failed: Acceptance configured credentials were allowed'; end if;
  v_auth := public.growth_g2_evaluate_provider_execution_authorization(v_org,v_bu,v_jur,v_reservation,'synthetic-provider','acceptance','synthetic-adapter','1.0.0');
  if v_auth->>'status'<>'BLOCKED' or not (v_auth->'blocking_reasons' ? 'provider_execution_gate_disabled') or not (v_auth->'blocking_reasons' ? 'provider_credentials_absent') then raise exception 'G2 auth OAT failed: Acceptance auth did not fail closed %',v_auth; end if;

  -- Production-shaped metadata is tested only inside this Acceptance transaction. It contains no secret or provider credential value.
  v_binding_prod := public.growth_g2_register_provider_runtime_binding(v_org,v_bu,v_jur,'synthetic-provider','production','synthetic-adapter','SYNTHETIC_PROVIDER_TOKEN_REF_ONLY','configured_external',v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true,'no_secret_present',true,'acceptance_db_only',true));
  v_allow_prod := public.growth_g2_register_provider_adapter_allowlist(v_org,v_bu,v_jur,'synthetic-provider','production','synthetic-adapter','1.0.0',v_reviewer,now()+interval '7 days',jsonb_build_object('synthetic',true,'acceptance_db_only',true));
  v_activation_prod := public.growth_g2_record_provider_activation_approval(v_org,v_bu,v_jur,'synthetic-provider','production','synthetic-adapter','1.0.0',v_reviewer,now()+interval '1 hour','G2-AUTH-PROD-SHAPED',jsonb_build_object('synthetic',true,'acceptance_db_only',true));
  v_auth := public.growth_g2_evaluate_provider_execution_authorization(v_org,v_bu,v_jur,v_reservation,'synthetic-provider','production','synthetic-adapter','1.0.0');
  if v_auth->>'status'<>'BLOCKED' or not (v_auth->'blocking_reasons' ? 'provider_execution_gate_disabled') then raise exception 'G2 auth OAT failed: execution gate OFF did not block %',v_auth; end if;
  update growth.feature_gate set enabled=true,updated_at=now() where gate_code='growth_provider_execution_enabled';
  v_auth := public.growth_g2_evaluate_provider_execution_authorization(v_org,v_bu,v_jur,v_reservation,'synthetic-provider','production','synthetic-adapter','1.0.0');
  if v_auth->>'status'<>'AUTHORIZED_FOR_LEASE' then raise exception 'G2 auth OAT failed: fully approved synthetic authorization did not pass %',v_auth; end if;
  v_lease := public.growth_g2_issue_provider_execution_lease(v_org,v_bu,v_jur,v_reservation,'synthetic-provider','production','synthetic-adapter','1.0.0');
  if v_lease->>'status'<>'LEASE_ISSUED' then raise exception 'G2 auth OAT failed: lease not issued %',v_lease; end if;
  v_token := v_lease->>'execution_token'; v_lease_id := (v_lease->>'lease_id')::uuid;
  if length(v_token)<>64 then raise exception 'G2 auth OAT failed: raw execution token malformed'; end if;
  if exists(select 1 from growth.provider_execution_lease l where l.id=v_lease_id and l.lease_token_hash=v_token) then raise exception 'G2 auth OAT failed: raw execution token stored directly'; end if;
  if not exists(select 1 from growth.provider_execution_lease l where l.id=v_lease_id and l.lease_token_hash=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_token,'UTF8'),'sha256'),'hex') and l.expires_at<=now()+interval '10 minutes 5 seconds' and l.lease_status='issued') then raise exception 'G2 auth OAT failed: token hash/expiry not persisted correctly'; end if;
  v_consume := public.growth_g2_consume_provider_execution_lease(v_org,v_bu,v_jur,v_lease_id,repeat('0',64),'synthetic-provider','production','synthetic-adapter','1.0.0');
  if v_consume->>'status'<>'BLOCKED' or not (v_consume->'blocking_reasons' ? 'execution_token_invalid') then raise exception 'G2 auth OAT failed: wrong token accepted %',v_consume; end if;
  v_consume := public.growth_g2_consume_provider_execution_lease(v_org,v_bu,v_jur,v_lease_id,v_token,'synthetic-provider','production','synthetic-adapter','1.0.0');
  if v_consume->>'status'<>'LEASE_CONSUMED' then raise exception 'G2 auth OAT failed: correct token not consumed %',v_consume; end if;
  if not exists(select 1 from growth.provider_execution_lease l where l.id=v_lease_id and l.lease_status='consumed' and l.consumed_at is not null) then raise exception 'G2 auth OAT failed: consumed lease not burned'; end if;
  v_consume := public.growth_g2_consume_provider_execution_lease(v_org,v_bu,v_jur,v_lease_id,v_token,'synthetic-provider','production','synthetic-adapter','1.0.0');
  if v_consume->>'status'<>'BLOCKED' or not (v_consume->'blocking_reasons' ? 'lease_not_issued') then raise exception 'G2 auth OAT failed: consumed token replay accepted %',v_consume; end if;
  update growth.feature_gate set enabled=false,updated_at=now() where gate_code='growth_provider_execution_enabled';
  update growth.feature_gate set enabled=false,updated_at=now() where gate_code='growth_outreach_enabled';
end $$;
rollback;

select
  (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate_after_rollback,
  (select enabled from growth.feature_gate where gate_code='growth_provider_execution_enabled') as provider_execution_gate_after_rollback,
  (select count(*) from growth.provider_runtime_binding where metadata->>'synthetic'='true') as persisted_runtime_bindings,
  (select count(*) from growth.provider_adapter_allowlist where metadata->>'synthetic'='true') as persisted_allowlists,
  (select count(*) from growth.provider_activation_approval where metadata->>'synthetic'='true') as persisted_activation_approvals,
  (select count(*) from growth.provider_execution_lease where metadata->>'single_use'='true') as persisted_execution_leases,
  (select count(*) from growth.outreach_submission_reservation where metadata->>'non_sending'='true') as persisted_reservations,
  (select count(*) from growth.prospect where external_prospect_key='G2-AUTH-OAT-ON') as persisted_prospects,
  (select count(*) from growth.sender_identity where email_address='g2-auth-sender@example.invalid') as persisted_senders;
