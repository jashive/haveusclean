create table if not exists public.quote_delivery (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  quote_version_id uuid not null,
  channel text not null check (channel = 'email'),
  provider text not null,
  recipient_email text not null,
  provider_message_id text not null,
  decision_token_hash text not null,
  decision_expires_at timestamptz not null,
  provider_accepted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by_app_user_id uuid references public.app_user(id),
  created_at timestamptz not null default now(),
  constraint fk_quote_delivery_quote_version_scope foreign key (quote_version_id, organization_id, business_unit_id)
    references public.quote_version(id, organization_id, business_unit_id) on delete restrict,
  constraint uq_quote_delivery_provider_message unique (provider, provider_message_id),
  constraint uq_quote_delivery_decision_token unique (decision_token_hash)
);

create index if not exists idx_quote_delivery_quote_version on public.quote_delivery(quote_version_id);
create index if not exists idx_quote_delivery_scope on public.quote_delivery(organization_id, business_unit_id, created_at desc);
create index if not exists idx_quote_delivery_token_hash on public.quote_delivery(decision_token_hash);

alter table public.quote_delivery enable row level security;

create policy quote_delivery_revenue_select on public.quote_delivery
for select to authenticated
using (public.has_bu_role(organization_id, business_unit_id, array['owner_admin','office_ops']::text[]));

create policy quote_delivery_revenue_insert on public.quote_delivery
for insert to authenticated
with check (
  public.has_bu_role(organization_id, business_unit_id, array['owner_admin','office_ops']::text[])
  and (created_by_app_user_id is null or created_by_app_user_id = public.current_app_user_id())
);

create table if not exists public.customer_quote_decision (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  business_unit_id uuid not null references public.business_unit(id),
  quote_version_id uuid not null,
  quote_delivery_id uuid not null references public.quote_delivery(id) on delete restrict,
  decision text not null check (decision in ('accepted','requested_changes')),
  notes text,
  decided_at timestamptz not null default now(),
  source text not null default 'customer_secure_link',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fk_customer_quote_decision_quote_version_scope foreign key (quote_version_id, organization_id, business_unit_id)
    references public.quote_version(id, organization_id, business_unit_id) on delete restrict,
  constraint uq_customer_quote_decision_quote_version unique (quote_version_id)
);

create index if not exists idx_customer_quote_decision_delivery on public.customer_quote_decision(quote_delivery_id);
create index if not exists idx_customer_quote_decision_scope on public.customer_quote_decision(organization_id, business_unit_id, decided_at desc);

alter table public.customer_quote_decision enable row level security;

create policy customer_quote_decision_revenue_select on public.customer_quote_decision
for select to authenticated
using (public.has_bu_role(organization_id, business_unit_id, array['owner_admin','office_ops']::text[]));

create or replace function public.record_quote_email_delivery(
  p_quote_version_id uuid,
  p_recipient_email text,
  p_provider text,
  p_provider_message_id text,
  p_decision_token_hash text,
  p_decision_expires_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_qv public.quote_version%rowtype;
  v_delivery public.quote_delivery%rowtype;
  v_actor uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(trim(coalesce(p_recipient_email,'')), '') is null then raise exception 'Recipient email is required'; end if;
  if nullif(trim(coalesce(p_provider_message_id,'')), '') is null then raise exception 'Provider message ID is required'; end if;
  if nullif(trim(coalesce(p_decision_token_hash,'')), '') is null then raise exception 'Decision token hash is required'; end if;
  if p_decision_expires_at <= now() then raise exception 'Decision link expiry must be in the future'; end if;

  select * into v_qv from public.quote_version where id = p_quote_version_id for update;
  if not found then raise exception 'Quote version not found or not visible'; end if;
  if not public.has_bu_role(v_qv.organization_id, v_qv.business_unit_id, array['owner_admin','office_ops']::text[]) then
    raise exception 'Not authorized for this business unit';
  end if;
  if v_qv.lifecycle_status not in ('draft','sent') then raise exception 'Only draft or sent quote versions may be emailed'; end if;

  v_actor := public.current_app_user_id();
  insert into public.quote_delivery(
    organization_id, business_unit_id, quote_version_id, channel, provider,
    recipient_email, provider_message_id, decision_token_hash, decision_expires_at,
    provider_accepted_at, metadata, created_by_app_user_id
  ) values (
    v_qv.organization_id, v_qv.business_unit_id, v_qv.id, 'email', trim(p_provider),
    lower(trim(p_recipient_email)), trim(p_provider_message_id), trim(p_decision_token_hash), p_decision_expires_at,
    now(), coalesce(p_metadata,'{}'::jsonb), v_actor
  ) returning * into v_delivery;

  if v_qv.lifecycle_status = 'draft' then
    update public.quote_version
      set lifecycle_status = 'sent', sent_at = coalesce(sent_at, now()), updated_at = now(), updated_by_app_user_id = v_actor
      where id = v_qv.id;
  end if;

  return jsonb_build_object(
    'delivery_id', v_delivery.id,
    'quote_version_id', v_delivery.quote_version_id,
    'provider', v_delivery.provider,
    'provider_message_id', v_delivery.provider_message_id,
    'recipient_email', v_delivery.recipient_email,
    'provider_accepted_at', v_delivery.provider_accepted_at,
    'decision_expires_at', v_delivery.decision_expires_at,
    'lifecycle_status', 'sent'
  );
end;
$$;

revoke all on function public.record_quote_email_delivery(uuid,text,text,text,text,timestamptz,jsonb) from public;
revoke all on function public.record_quote_email_delivery(uuid,text,text,text,text,timestamptz,jsonb) from anon;
grant execute on function public.record_quote_email_delivery(uuid,text,text,text,text,timestamptz,jsonb) to authenticated;

create or replace function public.record_public_quote_decision(
  p_token text,
  p_decision text,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_delivery public.quote_delivery%rowtype;
  v_qv public.quote_version%rowtype;
  v_existing public.customer_quote_decision%rowtype;
  v_decision public.customer_quote_decision%rowtype;
begin
  if nullif(trim(coalesce(p_token,'')), '') is null then raise exception 'Decision token is required'; end if;
  if p_decision not in ('accepted','requested_changes') then raise exception 'Unsupported customer decision'; end if;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  select * into v_delivery from public.quote_delivery where decision_token_hash = v_hash for update;
  if not found then raise exception 'This quote decision link is invalid'; end if;
  if v_delivery.decision_expires_at < now() then raise exception 'This quote decision link has expired'; end if;

  select * into v_qv from public.quote_version where id = v_delivery.quote_version_id;
  if not found or v_qv.organization_id <> v_delivery.organization_id or v_qv.business_unit_id <> v_delivery.business_unit_id then
    raise exception 'Quote lineage is invalid';
  end if;
  if v_qv.lifecycle_status <> 'sent' then raise exception 'This quote is no longer awaiting a customer decision'; end if;

  select * into v_existing from public.customer_quote_decision where quote_version_id = v_qv.id;
  if found then
    if v_existing.decision <> p_decision then
      raise exception 'A different decision has already been recorded for this quote; contact Have Us Clean for changes';
    end if;
    return jsonb_build_object('id',v_existing.id,'quote_version_id',v_existing.quote_version_id,'decision',v_existing.decision,'decided_at',v_existing.decided_at,'idempotent_replay',true);
  end if;

  insert into public.customer_quote_decision(
    organization_id,business_unit_id,quote_version_id,quote_delivery_id,decision,notes,decided_at,source,metadata
  ) values (
    v_delivery.organization_id,v_delivery.business_unit_id,v_delivery.quote_version_id,v_delivery.id,p_decision,
    nullif(trim(coalesce(p_notes,'')),''),now(),'customer_secure_link',jsonb_build_object('delivery_provider',v_delivery.provider)
  ) returning * into v_decision;

  return jsonb_build_object('id',v_decision.id,'quote_version_id',v_decision.quote_version_id,'decision',v_decision.decision,'decided_at',v_decision.decided_at,'idempotent_replay',false);
end;
$$;

revoke all on function public.record_public_quote_decision(text,text,text) from public;
grant execute on function public.record_public_quote_decision(text,text,text) to anon, authenticated;