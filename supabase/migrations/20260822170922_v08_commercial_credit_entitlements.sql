insert into public.credit_rate_versions (catalog_version, rates, policy_status)
values (
  8003,
  jsonb_build_object(
    'policyVersion', 'v08-commercial-token-1',
    'policy', 'commercial',
    'timezone', 'Asia/Seoul',
    'weeklyCredits', jsonb_build_object(
      'starter', 300,
      'growth', 2000,
      'operations', 5000,
      'focus', 10000
    ),
    'microcreditsPerCredit', 1000000,
    'weights', jsonb_build_object(
      'uncachedTextInput', 250,
      'cachedTextInput', 63,
      'textOutput', 1000,
      'imageInput', 1000,
      'imageOutput', 6250
    )
  ),
  'active'
)
on conflict (catalog_version) do update
set rates = excluded.rates,
    policy_status = excluded.policy_status;

create table public.billing_plan_entitlement_versions (
  policy_version text not null check (char_length(policy_version) between 1 and 100),
  plan_code text not null references public.billing_plans(code) on delete restrict,
  weekly_credits integer not null check (weekly_credits > 0),
  timezone text not null default 'Asia/Seoul' check (timezone = 'Asia/Seoul'),
  effective_from timestamptz not null,
  policy_status text not null check (policy_status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  primary key (policy_version, plan_code),
  check (
    effective_from = (
      date_trunc('week', effective_from at time zone 'Asia/Seoul')
      at time zone 'Asia/Seoul'
    )
  )
);

insert into public.billing_plan_entitlement_versions (
  policy_version, plan_code, weekly_credits, effective_from, policy_status
) values
  ('v08-commercial-token-1', 'starter', 300, '2026-08-24T00:00:00+09:00', 'active'),
  ('v08-commercial-token-1', 'growth', 2000, '2026-08-24T00:00:00+09:00', 'active'),
  ('v08-commercial-token-1', 'operations', 5000, '2026-08-24T00:00:00+09:00', 'active'),
  ('v08-commercial-token-1', 'focus', 10000, '2026-08-24T00:00:00+09:00', 'active');

update public.billing_plans
set included_credits = case code
  when 'starter' then 300
  when 'growth' then 2000
  when 'operations' then 5000
  when 'focus' then 10000
end,
policy_status = 'active';

create table public.workspace_billing_entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_code text not null,
  policy_version text not null,
  state text not null check (state in ('active', 'ended')),
  effective_from timestamptz not null,
  effective_until timestamptz,
  source_reference text not null check (char_length(source_reference) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint workspace_billing_entitlements_policy_fkey
    foreign key (policy_version, plan_code)
    references public.billing_plan_entitlement_versions(policy_version, plan_code)
    on delete restrict,
  constraint workspace_billing_entitlements_period_check
    check (effective_until is null or effective_until > effective_from),
  constraint workspace_billing_entitlements_week_boundary_check
    check (
      effective_from = (
        date_trunc('week', effective_from at time zone 'Asia/Seoul')
        at time zone 'Asia/Seoul'
      )
    ),
  constraint workspace_billing_entitlements_source_key
    unique (workspace_id, source_reference)
);

create unique index workspace_billing_entitlements_one_active_idx
  on public.workspace_billing_entitlements(workspace_id)
  where state = 'active';

create index workspace_billing_entitlements_lookup_idx
  on public.workspace_billing_entitlements(workspace_id, effective_from desc, effective_until);

create or replace function private.prevent_credit_entitlement_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'CREDIT_ENTITLEMENT_VERSION_IMMUTABLE' using errcode = 'P0001';
end;
$$;

create trigger billing_plan_entitlement_versions_immutable
before update or delete on public.billing_plan_entitlement_versions
for each row execute function private.prevent_credit_entitlement_version_mutation();

alter table public.billing_plan_entitlement_versions enable row level security;
alter table public.workspace_billing_entitlements enable row level security;

create policy "authenticated users can read active plan entitlements"
on public.billing_plan_entitlement_versions for select to authenticated
using (policy_status = 'active');

create policy "workspace members can read their billing entitlement"
on public.workspace_billing_entitlements for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on public.billing_plan_entitlement_versions, public.workspace_billing_entitlements
from public, anon, authenticated;
grant select on public.billing_plan_entitlement_versions, public.workspace_billing_entitlements
to authenticated;
grant select, insert on public.billing_plan_entitlement_versions, public.workspace_billing_entitlements
to service_role;
grant update (state, effective_until) on public.workspace_billing_entitlements to service_role;

create or replace function private.resolve_workspace_weekly_credit_policy(
  p_workspace_id uuid,
  p_at timestamptz default statement_timestamp()
)
returns table(policy_version text, weekly_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select version.policy_version, version.weekly_credits
  from public.workspace_billing_entitlements entitlement
  join public.billing_plan_entitlement_versions version
    on version.policy_version = entitlement.policy_version
   and version.plan_code = entitlement.plan_code
  where entitlement.workspace_id = p_workspace_id
    and entitlement.state = 'active'
    and entitlement.effective_from <= p_at
    and (entitlement.effective_until is null or entitlement.effective_until > p_at)
    and version.policy_status = 'active'
    and version.effective_from <= p_at
  order by entitlement.effective_from desc
  limit 1;

  if found then
    return;
  end if;

  return query select 'v08-test-2000-1'::text, 2000::integer;
end;
$$;

create or replace function private.ensure_workspace_weekly_entitlement(
  p_workspace_id uuid,
  p_at timestamptz default statement_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period record;
  v_policy record;
  v_account_id uuid;
  v_existing_allowance integer := 0;
  v_entry_kind text;
  v_entry_amount integer;
  v_grant_key text;
begin
  select * into v_period from private.v08_preview_credit_period(p_at);
  select * into v_policy from private.resolve_workspace_weekly_credit_policy(p_workspace_id, p_at);

  if v_policy.policy_version is null or v_policy.weekly_credits is null then
    raise exception 'CREDIT_POLICY_UNAVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.credit_accounts (workspace_id, period_start, period_end, timezone)
  values (p_workspace_id, v_period.period_start, v_period.period_end, v_period.period_timezone)
  on conflict (workspace_id, period_start, period_end) do nothing
  returning id into v_account_id;

  if v_account_id is null then
    select id into v_account_id
    from public.credit_accounts
    where workspace_id = p_workspace_id
      and period_start = v_period.period_start
      and period_end = v_period.period_end;
  end if;

  if v_account_id is null then
    raise exception 'CREDIT_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount) filter (where kind in ('grant', 'adjustment')), 0)
  into v_existing_allowance
  from public.credit_ledger_entries
  where workspace_id = p_workspace_id and account_id = v_account_id;

  if v_existing_allowance > v_policy.weekly_credits then
    raise exception 'CREDIT_ENTITLEMENT_PERIOD_CONFLICT' using errcode = 'P0001';
  end if;

  if v_existing_allowance < v_policy.weekly_credits then
    v_entry_kind := case when v_existing_allowance = 0 then 'grant' else 'adjustment' end;
    v_entry_amount := v_policy.weekly_credits - v_existing_allowance;
    v_grant_key := v_policy.policy_version || ':' || v_period.period_start::text || ':allowance';
    insert into public.credit_ledger_entries (
      workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key
    ) values (
      p_workspace_id, v_account_id, null, v_entry_kind, null, v_entry_amount, v_grant_key
    ) on conflict (workspace_id, idempotency_key, kind) do nothing;
  end if;

  return v_account_id;
end;
$$;

create or replace function private.ensure_v08_preview_credit_account(
  p_workspace_id uuid,
  p_at timestamptz default statement_timestamp()
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.ensure_workspace_weekly_entitlement(p_workspace_id, p_at);
$$;

create or replace function public.get_workspace_credit_balance(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.credit_accounts%rowtype;
  v_policy record;
  v_granted integer := 0;
  v_adjustments integer := 0;
  v_released integer := 0;
  v_consumed integer := 0;
  v_reserved integer := 0;
begin
  if not private.has_credit_workspace_access(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_policy
  from private.resolve_workspace_weekly_credit_policy(p_workspace_id, statement_timestamp());

  select * into v_account
  from public.credit_accounts
  where id = private.ensure_workspace_weekly_entitlement(p_workspace_id, statement_timestamp());

  select
    coalesce(sum(amount) filter (where kind = 'grant'), 0),
    coalesce(sum(amount) filter (where kind = 'adjustment'), 0),
    coalesce(sum(amount) filter (where kind = 'release'), 0),
    coalesce(sum(amount) filter (where kind = 'consume'), 0),
    coalesce(sum(amount) filter (where kind = 'reserve'), 0)
  into v_granted, v_adjustments, v_released, v_consumed, v_reserved
  from public.credit_ledger_entries
  where workspace_id = p_workspace_id and account_id = v_account.id;

  return jsonb_build_object(
    'workspaceId', p_workspace_id,
    'periodStart', v_account.period_start,
    'periodEnd', v_account.period_end,
    'granted', v_granted,
    'adjustments', v_adjustments,
    'released', v_released,
    'consumed', v_consumed,
    'reserved', v_reserved,
    'available', v_granted + v_adjustments + v_released - v_consumed - v_reserved,
    'weeklyLimit', v_policy.weekly_credits,
    'policyVersion', v_policy.policy_version
  );
end;
$$;

revoke all on function private.prevent_credit_entitlement_version_mutation() from public, anon, authenticated;
revoke all on function private.resolve_workspace_weekly_credit_policy(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.ensure_workspace_weekly_entitlement(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.ensure_v08_preview_credit_account(uuid, timestamptz) from public, anon, authenticated;
grant execute on function private.resolve_workspace_weekly_credit_policy(uuid, timestamptz) to service_role;
grant execute on function private.ensure_workspace_weekly_entitlement(uuid, timestamptz) to service_role;
grant execute on function private.ensure_v08_preview_credit_account(uuid, timestamptz) to service_role;
