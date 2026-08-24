create or replace function public.growth_g2_evaluate_sender_readiness(
  p_organization_id uuid,p_business_unit_id uuid,p_jurisdiction_id uuid,p_sender_email text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sender growth.sender_identity%rowtype; v_auth growth.sender_auth_evidence%rowtype; v_health growth.sender_health_snapshot%rowtype; v_blockers text[]:=array[]::text[]; begin
  select * into v_sender from growth.sender_identity s where s.organization_id=p_organization_id and s.business_unit_id=p_business_unit_id and s.jurisdiction_id=p_jurisdiction_id and s.email_address=lower(btrim(coalesce(p_sender_email,''))) order by s.updated_at desc limit 1;
  if v_sender.id is null then v_blockers:=array_append(v_blockers,'sender_not_registered'); return jsonb_build_object('ready',false,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-sender-readiness-2026-08-23'); end if;
  if v_sender.status<>'approved' then v_blockers:=array_append(v_blockers,'sender_not_approved'); end if;
  if v_sender.valid_until is null or v_sender.valid_until<=now() then v_blockers:=array_append(v_blockers,'sender_approval_expired'); end if;
  select * into v_auth from growth.sender_auth_evidence a where a.sender_identity_id=v_sender.id order by a.checked_at desc,a.created_at desc limit 1;
  if v_auth.id is null then v_blockers:=array_append(v_blockers,'sender_auth_evidence_missing'); else
    if v_auth.evidence_status<>'accepted' then v_blockers:=array_append(v_blockers,'sender_auth_evidence_not_accepted'); end if;
    if v_auth.valid_until<=now() then v_blockers:=array_append(v_blockers,'sender_auth_evidence_expired'); end if;
    if v_auth.spf_status<>'pass' then v_blockers:=array_append(v_blockers,'spf_not_pass'); end if;
    if v_auth.dkim_status<>'pass' then v_blockers:=array_append(v_blockers,'dkim_not_pass'); end if;
    if v_auth.dmarc_status<>'pass' then v_blockers:=array_append(v_blockers,'dmarc_not_pass'); end if;
  end if;
  select * into v_health from growth.sender_health_snapshot h where h.sender_identity_id=v_sender.id order by h.window_end desc,h.recorded_at desc limit 1;
  if v_health.id is null then v_blockers:=array_append(v_blockers,'sender_health_missing'); else
    if v_health.window_end < now()-interval '24 hours' then v_blockers:=array_append(v_blockers,'sender_health_stale'); end if;
    if v_health.health_status<>'healthy' then v_blockers:=array_append(v_blockers,'sender_health_not_healthy'); end if;
  end if;
  return jsonb_build_object('ready',cardinality(v_blockers)=0,'blocking_reasons',to_jsonb(v_blockers),'policy_version','g2-sender-readiness-2026-08-23','sender_identity_id',v_sender.id);
end; $$;
revoke execute on function public.growth_g2_evaluate_sender_readiness(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.growth_g2_evaluate_sender_readiness(uuid,uuid,uuid,text) to service_role;
