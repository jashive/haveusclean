-- Growth Layer G2 provider authorization revocation lifecycle OAT.
-- SYNTHETIC / ACCEPTANCE / ROLLBACK ONLY. No provider credentials, provider API, or send.
begin;

do $$
declare
  v_org uuid := '411e167e-506b-4304-9428-11b7cfc98e15';
  v_bu uuid := '03334f81-9f30-408d-bfd1-74579ebf6426';
  v_jur uuid := '09340f23-f2fb-4c26-adbf-c1c1c625f8c6';
  v_reviewer uuid := 'ff592a32-a91c-42ad-a39f-e3b540d6fad5';
  v_binding uuid;
  v_allow uuid;
  v_activation uuid;
  v_direct_mutation_blocked boolean := false;
  v_terminal_blocked boolean := false;
begin
  v_binding := public.growth_g2_register_provider_runtime_binding(v_org,v_bu,v_jur,'synthetic-revoke-provider','acceptance','synthetic-revoke-adapter','SYNTHETIC_TOKEN_REF','absent',v_reviewer,now()+interval '1 day',jsonb_build_object('synthetic_revocation_oat',true));
  v_allow := public.growth_g2_register_provider_adapter_allowlist(v_org,v_bu,v_jur,'synthetic-revoke-provider','acceptance','synthetic-revoke-adapter','9.9.9',v_reviewer,now()+interval '1 day',jsonb_build_object('synthetic_revocation_oat',true));
  v_activation := public.growth_g2_record_provider_activation_approval(v_org,v_bu,v_jur,'synthetic-revoke-provider','acceptance','synthetic-revoke-adapter','9.9.9',v_reviewer,now()+interval '1 hour','G2-REVOCATION-OAT',jsonb_build_object('synthetic_revocation_oat',true));

  if public.growth_g2_set_provider_runtime_binding_status(v_binding,'suspended',v_reviewer,'synthetic emergency suspension') <> 'suspended' then raise exception 'G2 revocation OAT: runtime suspension failed'; end if;
  if public.growth_g2_set_provider_runtime_binding_status(v_binding,'approved_metadata_only',v_reviewer,'synthetic resume after review') <> 'approved_metadata_only' then raise exception 'G2 revocation OAT: runtime resume failed'; end if;
  if public.growth_g2_set_provider_runtime_binding_status(v_binding,'revoked',v_reviewer,'synthetic terminal revocation') <> 'revoked' then raise exception 'G2 revocation OAT: runtime revocation failed'; end if;

  begin
    perform public.growth_g2_set_provider_runtime_binding_status(v_binding,'approved_metadata_only',v_reviewer,'must not restore terminal revocation');
  exception when others then
    if position('invalid runtime binding transition' in sqlerrm)>0 then v_terminal_blocked:=true; else raise; end if;
  end;
  if not v_terminal_blocked then raise exception 'G2 revocation OAT: revoked binding restored'; end if;

  if public.growth_g2_set_provider_adapter_allowlist_status(v_allow,'suspended',v_reviewer,'synthetic adapter suspension') <> 'suspended' then raise exception 'G2 revocation OAT: allowlist suspension failed'; end if;
  if public.growth_g2_set_provider_adapter_allowlist_status(v_allow,'allowed',v_reviewer,'synthetic adapter resume') <> 'allowed' then raise exception 'G2 revocation OAT: allowlist resume failed'; end if;
  if public.growth_g2_set_provider_adapter_allowlist_status(v_allow,'revoked',v_reviewer,'synthetic adapter terminal revocation') <> 'revoked' then raise exception 'G2 revocation OAT: allowlist revocation failed'; end if;

  if public.growth_g2_set_provider_activation_approval_status(v_activation,'revoked',v_reviewer,'synthetic activation revocation') <> 'revoked' then raise exception 'G2 revocation OAT: activation revocation failed'; end if;

  begin
    update growth.provider_runtime_binding set adapter_key='tampered' where id=v_binding;
  exception when others then
    if position('runtime binding fields are immutable' in sqlerrm)>0 then v_direct_mutation_blocked:=true; else raise; end if;
  end;
  if not v_direct_mutation_blocked then raise exception 'G2 revocation OAT: immutable field mutation allowed'; end if;

  if (select count(*) from growth.audit_event where correlation_id in (v_binding,v_allow,v_activation) and event_type in ('provider_runtime_binding_status_changed','provider_adapter_allowlist_status_changed','provider_activation_approval_status_changed')) <> 7 then
    raise exception 'G2 revocation OAT: expected 7 lifecycle audit events';
  end if;
end $$;

rollback;

select
 (select enabled from growth.feature_gate where gate_code='growth_outreach_enabled') as outreach_gate_after_rollback,
 (select enabled from growth.feature_gate where gate_code='growth_provider_execution_enabled') as provider_execution_gate_after_rollback,
 (select count(*) from growth.provider_runtime_binding where metadata->>'synthetic_revocation_oat'='true') as persisted_bindings,
 (select count(*) from growth.provider_adapter_allowlist where metadata->>'synthetic_revocation_oat'='true') as persisted_allowlists,
 (select count(*) from growth.provider_activation_approval where metadata->>'synthetic_revocation_oat'='true') as persisted_activations;
