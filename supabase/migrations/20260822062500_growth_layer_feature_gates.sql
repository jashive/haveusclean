-- Growth Layer 1.0 feature gates.
-- All gates default OFF in migration history. Acceptance may explicitly enable only the core G1 gate after OAT.

begin;

create table growth.feature_gate (
  gate_code text primary key,
  enabled boolean not null default false,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint growth_feature_gate_code_ck check (gate_code in (
    'growth_layer_enabled',
    'growth_outreach_enabled',
    'growth_auto_followup_enabled',
    'growth_serviceos_handoff_enabled'
  ))
);

insert into growth.feature_gate (gate_code, enabled, description) values
  ('growth_layer_enabled', false, 'Core Growth G1 prospecting, enrichment, scoring and queue access.'),
  ('growth_outreach_enabled', false, 'Outbound sending. Must remain off until compliance and deliverability gates pass.'),
  ('growth_auto_followup_enabled', false, 'Automated follow-up sequences. Must remain off until sequence controls pass.'),
  ('growth_serviceos_handoff_enabled', false, 'Growth-to-ServiceOS Revenue handoff. Must remain off until adapter acceptance passes.');

alter table growth.feature_gate enable row level security;
revoke all on growth.feature_gate from public, anon, authenticated;
grant select, update on growth.feature_gate to service_role;

create or replace function public.growth_gate_enabled(p_gate_code text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((select fg.enabled from growth.feature_gate fg where fg.gate_code = p_gate_code), false);
$$;

revoke all on function public.growth_gate_enabled(text) from public, anon, authenticated;
grant execute on function public.growth_gate_enabled(text) to service_role;

commit;
