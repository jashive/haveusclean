create or replace function public.get_public_quote_decision_context(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_delivery public.quote_delivery%rowtype;
  v_qv public.quote_version%rowtype;
  v_decision public.customer_quote_decision%rowtype;
begin
  if nullif(trim(coalesce(p_token,'')), '') is null then raise exception 'Decision token is required'; end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  select * into v_delivery from public.quote_delivery where decision_token_hash = v_hash;
  if not found then raise exception 'This quote decision link is invalid'; end if;
  if v_delivery.decision_expires_at < now() then raise exception 'This quote decision link has expired'; end if;
  select * into v_qv from public.quote_version where id = v_delivery.quote_version_id;
  if not found or v_qv.organization_id <> v_delivery.organization_id or v_qv.business_unit_id <> v_delivery.business_unit_id then raise exception 'Quote lineage is invalid'; end if;
  select * into v_decision from public.customer_quote_decision where quote_version_id = v_qv.id;
  return jsonb_build_object(
    'quote_version_id', v_qv.id,
    'title', v_qv.title,
    'lifecycle_status', v_qv.lifecycle_status,
    'customer_facing_text', v_qv.commercial_snapshot->>'customerFacingText',
    'line_items', v_qv.line_items_snapshot,
    'expires_at', v_delivery.decision_expires_at,
    'decision', case when v_decision.id is null then null else v_decision.decision end,
    'decided_at', case when v_decision.id is null then null else v_decision.decided_at end
  );
end;
$$;

revoke all on function public.get_public_quote_decision_context(text) from public;
grant execute on function public.get_public_quote_decision_context(text) to anon, authenticated;