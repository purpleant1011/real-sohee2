-- V0.8 preview policy only. This is deliberately not a commercial plan allowance.
insert into public.credit_rate_versions (catalog_version, rates, policy_status)
values (
  8001,
  jsonb_build_object(
    'policyVersion', 'v08-preview-1',
    'policy', 'preview',
    'timezone', 'Asia/Seoul',
    'actionRateCredits', 1,
    'weeklyPreviewAllowanceCredits', 100,
    'commercialIncludedCredits', null
  ),
  'draft'
)
on conflict (catalog_version) do update
set rates = excluded.rates,
    policy_status = excluded.policy_status;

alter table public.credit_accounts
  drop constraint if exists credit_accounts_workspace_id_key;

alter table public.credit_accounts
  add constraint credit_accounts_workspace_period_key
  unique (workspace_id, period_start, period_end);

create index if not exists credit_accounts_workspace_period_idx
  on public.credit_accounts(workspace_id, period_start desc, period_end desc);

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspace_members as member
      where member.workspace_id = p_workspace_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    );
$$;

create or replace function private.has_credit_workspace_access(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    current_setting('request.jwt.claim.role', true) = 'service_role'
    or private.is_workspace_member(p_workspace_id);
$$;

revoke all on function private.has_credit_workspace_access(uuid) from public, anon, authenticated;

create or replace function private.v08_preview_credit_period(p_at timestamptz default statement_timestamp())
returns table (period_start date, period_end date, period_timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  with local_day as (
    select timezone('Asia/Seoul', p_at)::date as value
  )
  select
    value - (extract(isodow from value)::integer - 1),
    value + (7 - extract(isodow from value)::integer),
    'Asia/Seoul'::text
  from local_day;
$$;

revoke all on function private.v08_preview_credit_period(timestamptz) from public, anon, authenticated;

create or replace function private.ensure_v08_preview_credit_account(
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
  v_account_id uuid;
  v_allowance integer;
  v_grant_key text;
begin
  select * into v_period from private.v08_preview_credit_period(p_at);

  select (rates ->> 'weeklyPreviewAllowanceCredits')::integer
  into v_allowance
  from public.credit_rate_versions
  where catalog_version = 8001
    and policy_status = 'draft'
    and rates ->> 'policyVersion' = 'v08-preview-1'
    and rates ->> 'policy' = 'preview';

  if v_allowance is distinct from 100 then
    raise exception 'CREDIT_PREVIEW_POLICY_UNAVAILABLE' using errcode = 'P0001';
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

  v_grant_key := 'v08-preview-1:' || v_period.period_start::text || ':grant';
  insert into public.credit_ledger_entries (
    workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key
  ) values (
    p_workspace_id, v_account_id, null, 'grant', null, v_allowance, v_grant_key
  ) on conflict (workspace_id, idempotency_key, kind) do nothing;

  return v_account_id;
end;
$$;

revoke all on function private.ensure_v08_preview_credit_account(uuid, timestamptz) from public, anon, authenticated;
grant execute on function private.ensure_v08_preview_credit_account(uuid, timestamptz) to service_role;

create or replace function private.ensure_v08_preview_credit_account_on_workspace_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_v08_preview_credit_account(new.id, new.created_at);
  return new;
end;
$$;

revoke all on function private.ensure_v08_preview_credit_account_on_workspace_insert() from public, anon, authenticated;

drop trigger if exists workspaces_ensure_v08_preview_credit_account on public.workspaces;
create trigger workspaces_ensure_v08_preview_credit_account
after insert on public.workspaces
for each row execute function private.ensure_v08_preview_credit_account_on_workspace_insert();

select private.ensure_v08_preview_credit_account(workspace.id, statement_timestamp())
from public.workspaces as workspace;

create or replace function public.get_workspace_credit_balance(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.credit_accounts%rowtype;
  v_granted integer := 0;
  v_adjustments integer := 0;
  v_released integer := 0;
  v_consumed integer := 0;
  v_reserved integer := 0;
begin
  if not private.has_credit_workspace_access(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_account
  from public.credit_accounts
  where id = private.ensure_v08_preview_credit_account(p_workspace_id, statement_timestamp());

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
    'available', v_granted + v_adjustments + v_released - v_consumed - v_reserved
  );
end;
$$;

create or replace function public.reserve_workspace_credits(
  p_workspace_id uuid,
  p_action text,
  p_credits integer,
  p_idempotency_key text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.credit_accounts%rowtype;
  v_reservation public.credit_reservations%rowtype;
  v_available integer;
begin
  if not private.has_credit_workspace_access(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_action not in (
    'chat_turn', 'source_analysis', 'text_generation', 'image_generation',
    'harness_generation', 'period_plan_generation', 'performance_collection',
    'performance_report', 'external_action_prepare', 'external_action_execute'
  ) or p_credits <= 0 or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'CREDIT_RESERVE_INVALID' using errcode = 'P0001';
  end if;

  perform private.ensure_v08_preview_credit_account(p_workspace_id, statement_timestamp());

  select * into v_reservation
  from public.credit_reservations
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    if v_reservation.id <> p_reservation_id or v_reservation.action <> p_action or v_reservation.requested_credits <> p_credits then
      raise exception 'CREDIT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'reservationId', v_reservation.id,
      'state', v_reservation.state,
      'requestedCredits', v_reservation.requested_credits
    );
  end if;

  select * into v_account
  from public.credit_accounts
  where id = private.ensure_v08_preview_credit_account(p_workspace_id, statement_timestamp())
  for update;

  select (public.get_workspace_credit_balance(p_workspace_id) ->> 'available')::integer into v_available;
  if v_available < p_credits then
    raise exception 'CREDIT_INSUFFICIENT' using errcode = 'P0001';
  end if;

  insert into public.credit_reservations (
    id, workspace_id, account_id, action, requested_credits, idempotency_key
  ) values (
    p_reservation_id, p_workspace_id, v_account.id, p_action, p_credits, p_idempotency_key
  ) returning * into v_reservation;

  insert into public.credit_ledger_entries (
    workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key
  ) values (
    p_workspace_id, v_account.id, v_reservation.id, 'reserve', p_action, p_credits, p_idempotency_key
  );

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'state', v_reservation.state,
    'requestedCredits', v_reservation.requested_credits
  );
end;
$$;

create or replace function public.settle_credit_reservation(
  p_workspace_id uuid,
  p_reservation_id uuid,
  p_actual_credits integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.credit_reservations%rowtype;
  v_remaining integer;
begin
  if not private.has_credit_workspace_access(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_actual_credits < 0 or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'CREDIT_SETTLE_INVALID' using errcode = 'P0001';
  end if;

  select * into v_reservation from public.credit_reservations
  where workspace_id = p_workspace_id and id = p_reservation_id for update;
  if not found then
    raise exception 'CREDIT_RESERVATION_STALE' using errcode = 'P0001';
  end if;
  if v_reservation.settled_request_key = p_idempotency_key then
    return jsonb_build_object('reservationId', v_reservation.id, 'state', v_reservation.state);
  end if;
  if v_reservation.state <> 'reserved' then
    raise exception 'CREDIT_RESERVATION_STALE' using errcode = 'P0001';
  end if;

  v_remaining := v_reservation.requested_credits - v_reservation.settled_credits - v_reservation.released_credits;
  if p_actual_credits > v_remaining then
    raise exception 'CREDIT_SETTLE_EXCEEDS_RESERVED' using errcode = 'P0001';
  end if;

  if p_actual_credits > 0 then
    insert into public.credit_ledger_entries (
      workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key
    ) values (
      p_workspace_id, v_reservation.account_id, v_reservation.id, 'consume',
      v_reservation.action, p_actual_credits, p_idempotency_key
    );
  end if;
  if v_remaining > 0 then
    insert into public.credit_ledger_entries (
      workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key
    ) values (
      p_workspace_id, v_reservation.account_id, v_reservation.id, 'release',
      v_reservation.action, v_remaining, p_idempotency_key
    );
  end if;

  update public.credit_reservations
  set settled_credits = settled_credits + p_actual_credits,
      released_credits = released_credits + (v_remaining - p_actual_credits),
      state = 'settled',
      settled_request_key = p_idempotency_key,
      settled_at = now()
  where id = v_reservation.id;

  return jsonb_build_object('reservationId', v_reservation.id, 'state', 'settled');
end;
$$;

create or replace function public.release_credit_reservation(
  p_workspace_id uuid,
  p_reservation_id uuid,
  p_release_credits integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.credit_reservations%rowtype;
  v_remaining integer;
begin
  if not private.has_credit_workspace_access(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_release_credits <= 0 or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'CREDIT_RELEASE_INVALID' using errcode = 'P0001';
  end if;

  select * into v_reservation from public.credit_reservations
  where workspace_id = p_workspace_id and id = p_reservation_id for update;
  if not found then
    raise exception 'CREDIT_RESERVATION_STALE' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.credit_ledger_entries
    where workspace_id = p_workspace_id and reservation_id = p_reservation_id
      and kind = 'release' and idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('reservationId', v_reservation.id, 'state', v_reservation.state);
  end if;
  if v_reservation.state <> 'reserved' then
    raise exception 'CREDIT_RESERVATION_STALE' using errcode = 'P0001';
  end if;

  v_remaining := v_reservation.requested_credits - v_reservation.settled_credits - v_reservation.released_credits;
  if p_release_credits > v_remaining then
    raise exception 'CREDIT_RELEASE_EXCEEDS_RESERVED' using errcode = 'P0001';
  end if;

  insert into public.credit_ledger_entries (
    workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key
  ) values (
    p_workspace_id, v_reservation.account_id, v_reservation.id, 'release',
    v_reservation.action, p_release_credits, p_idempotency_key
  );
  update public.credit_reservations
  set released_credits = released_credits + p_release_credits,
      state = case when p_release_credits = v_remaining then 'released' else 'reserved' end
  where id = v_reservation.id;

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'state', case when p_release_credits = v_remaining then 'released' else 'reserved' end
  );
end;
$$;
