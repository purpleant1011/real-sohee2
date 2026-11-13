create table public.credit_rate_versions (
  id uuid primary key default gen_random_uuid(),
  catalog_version integer not null unique check (catalog_version > 0),
  rates jsonb not null default '{}'::jsonb check (jsonb_typeof(rates) = 'object'),
  policy_status text not null default 'draft' check (policy_status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now()
);

create table public.credit_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  timezone text not null default 'Asia/Seoul' check (timezone ~ '^[A-Za-z_]+/[A-Za-z_+-]+$'),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table public.credit_reservations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid not null references public.credit_accounts(id) on delete restrict,
  action text not null check (action in (
    'chat_turn', 'source_analysis', 'text_generation', 'image_generation',
    'harness_generation', 'period_plan_generation', 'performance_collection',
    'performance_report', 'external_action_prepare', 'external_action_execute'
  )),
  requested_credits integer not null check (requested_credits > 0),
  settled_credits integer not null default 0 check (settled_credits >= 0),
  released_credits integer not null default 0 check (released_credits >= 0),
  state text not null default 'reserved' check (state in ('reserved', 'settled', 'released')),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  settled_request_key text unique check (settled_request_key is null or char_length(settled_request_key) between 1 and 200),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint credit_reservations_workspace_idempotency_key unique (workspace_id, idempotency_key),
  constraint credit_reservations_workspace_account_key unique (workspace_id, account_id, id),
  check (settled_credits + released_credits <= requested_credits)
);

create index credit_reservations_workspace_state_idx
  on public.credit_reservations(workspace_id, state, created_at desc);

create table public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid not null references public.credit_accounts(id) on delete restrict,
  reservation_id uuid,
  kind text not null check (kind in ('grant', 'reserve', 'consume', 'release', 'refund', 'adjustment')),
  action text check (action is null or action in (
    'chat_turn', 'source_analysis', 'text_generation', 'image_generation',
    'harness_generation', 'period_plan_generation', 'performance_collection',
    'performance_report', 'external_action_prepare', 'external_action_execute'
  )),
  amount integer not null check (amount <> 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  occurred_at timestamptz not null default now(),
  constraint credit_ledger_entries_workspace_reservation_fkey
    foreign key (workspace_id, account_id, reservation_id)
    references public.credit_reservations(workspace_id, account_id, id)
    on delete restrict,
  constraint credit_ledger_entries_workspace_idempotency_kind_key
    unique (workspace_id, idempotency_key, kind)
);

create index credit_ledger_entries_workspace_occurred_idx
  on public.credit_ledger_entries(workspace_id, occurred_at desc);
create index credit_ledger_entries_reservation_idx
  on public.credit_ledger_entries(reservation_id, occurred_at asc)
  where reservation_id is not null;

create table public.content_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  timezone text not null check (timezone ~ '^[A-Za-z_]+/[A-Za-z_+-]+$'),
  goal text not null check (char_length(goal) between 1 and 500),
  generation_depth text not null check (generation_depth in ('fast', 'balanced', 'deep')),
  catalog_version integer not null check (catalog_version > 0),
  estimated_credits integer not null check (estimated_credits >= 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'cancelled')),
  version integer not null default 1 check (version > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  approved_request_key text unique check (approved_request_key is null or char_length(approved_request_key) between 1 and 200),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_plans_workspace_idempotency_key unique (workspace_id, idempotency_key),
  constraint content_plans_workspace_id_key unique (workspace_id, id),
  check (period_end >= period_start)
);

create index content_plans_workspace_period_idx
  on public.content_plans(workspace_id, period_start, period_end, created_at desc);

create table public.content_plan_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  plan_id uuid not null,
  channel text not null check (channel in ('instagram', 'threads', 'naver_blog', 'naver_place', 'daangn')),
  post_count integer not null check (post_count between 1 and 100),
  images_per_post integer not null check (images_per_post between 0 and 10),
  created_at timestamptz not null default now(),
  constraint content_plan_entries_workspace_plan_fkey
    foreign key (workspace_id, plan_id)
    references public.content_plans(workspace_id, id)
    on delete cascade,
  constraint content_plan_entries_plan_channel_key unique (plan_id, channel)
);

create table public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('starter', 'growth', 'operations', 'focus')),
  monthly_price_krw integer not null unique check (monthly_price_krw in (0, 150000, 300000, 500000)),
  included_credits integer check (included_credits is null or included_credits >= 0),
  policy_status text not null default 'draft' check (policy_status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now()
);

create table public.checkout_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  billing_plan_id uuid not null references public.billing_plans(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  state text not null default 'provider_pending' check (state in (
    'draft', 'provider_pending', 'provider_succeeded', 'activation_succeeded', 'failed', 'cancelled'
  )),
  provider_reference text check (provider_reference is null or char_length(provider_reference) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_intents_workspace_idempotency_key unique (workspace_id, idempotency_key)
);

create index checkout_intents_workspace_created_idx
  on public.checkout_intents(workspace_id, created_at desc);

insert into public.billing_plans (id, code, monthly_price_krw, included_credits, policy_status)
values
  ('88000000-0000-4000-8000-000000000001', 'starter', 0, null, 'draft'),
  ('88000000-0000-4000-8000-000000000002', 'growth', 150000, null, 'draft'),
  ('88000000-0000-4000-8000-000000000003', 'operations', 300000, null, 'draft'),
  ('88000000-0000-4000-8000-000000000004', 'focus', 500000, null, 'draft');

create or replace function private.prevent_credit_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'CREDIT_LEDGER_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

create trigger credit_ledger_entries_append_only
before update or delete on public.credit_ledger_entries
for each row execute function private.prevent_credit_ledger_mutation();

alter table public.credit_rate_versions enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.credit_ledger_entries enable row level security;
alter table public.content_plans enable row level security;
alter table public.content_plan_entries enable row level security;
alter table public.billing_plans enable row level security;
alter table public.checkout_intents enable row level security;

create policy "workspace members can read credit accounts"
on public.credit_accounts for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read credit reservations"
on public.credit_reservations for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read credit ledger"
on public.credit_ledger_entries for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read content plans"
on public.content_plans for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read content plan entries"
on public.content_plan_entries for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read checkout intents"
on public.checkout_intents for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on public.credit_rate_versions, public.credit_accounts, public.credit_reservations,
  public.credit_ledger_entries, public.content_plans, public.content_plan_entries,
  public.billing_plans, public.checkout_intents from anon, authenticated;
grant select on public.credit_accounts, public.credit_reservations, public.credit_ledger_entries,
  public.content_plans, public.content_plan_entries, public.checkout_intents to authenticated;
grant select, insert on public.credit_rate_versions, public.credit_accounts, public.credit_reservations,
  public.credit_ledger_entries, public.content_plans, public.content_plan_entries,
  public.billing_plans, public.checkout_intents to service_role;
grant update (state, settled_credits, released_credits, settled_request_key, settled_at)
  on public.credit_reservations to service_role;
grant update (status, version, approved_request_key, approved_at, updated_at)
  on public.content_plans to service_role;
grant update (state, provider_reference, updated_at) on public.checkout_intents to service_role;

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
  if not private.is_workspace_member(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_account from public.credit_accounts where workspace_id = p_workspace_id;
  if not found then
    raise exception 'CREDIT_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;

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
  if not private.is_workspace_member(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_action not in (
    'chat_turn', 'source_analysis', 'text_generation', 'image_generation',
    'harness_generation', 'period_plan_generation', 'performance_collection',
    'performance_report', 'external_action_prepare', 'external_action_execute'
  ) or p_credits <= 0 or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'CREDIT_RESERVE_INVALID' using errcode = 'P0001';
  end if;

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

  select * into v_account from public.credit_accounts
  where workspace_id = p_workspace_id for update;
  if not found then
    raise exception 'CREDIT_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;

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

create or replace function public.list_workspace_credit_ledger(
  p_workspace_id uuid,
  p_kind text default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  workspace_id uuid,
  account_id uuid,
  reservation_id uuid,
  kind text,
  action text,
  amount integer,
  idempotency_key text,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_workspace_member(p_workspace_id) then
    raise exception 'CREDIT_FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'CREDIT_LEDGER_LIMIT_INVALID' using errcode = 'P0001';
  end if;

  return query
  select
    entry.id, entry.workspace_id, entry.account_id, entry.reservation_id,
    entry.kind, entry.action, entry.amount, entry.idempotency_key, entry.occurred_at
  from public.credit_ledger_entries as entry
  where entry.workspace_id = p_workspace_id
    and (p_kind is null or entry.kind = p_kind)
  order by entry.occurred_at desc, entry.id desc
  limit p_limit;
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
  if not private.is_workspace_member(p_workspace_id) then
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
  if not private.is_workspace_member(p_workspace_id) then
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

create or replace function public.create_period_content_plan(
  p_workspace_id uuid,
  p_request jsonb,
  p_catalog_version integer,
  p_estimated_credits integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.content_plans%rowtype;
  v_channel_count integer;
begin
  if not private.has_workspace_role(p_workspace_id, array['owner', 'manager', 'reviewer']::text[]) then
    raise exception 'PLAN_FORBIDDEN' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_request) <> 'object' or p_catalog_version <= 0 or p_estimated_credits < 0
    or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'PLAN_REQUEST_INVALID' using errcode = 'P0001';
  end if;

  select * into v_plan from public.content_plans
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('planId', v_plan.id, 'version', v_plan.version, 'status', v_plan.status);
  end if;

  insert into public.content_plans (
    workspace_id, period_start, period_end, timezone, goal, generation_depth,
    catalog_version, estimated_credits, idempotency_key
  ) values (
    p_workspace_id,
    (p_request ->> 'periodStart')::date,
    (p_request ->> 'periodEnd')::date,
    p_request ->> 'timezone',
    p_request ->> 'goal',
    p_request ->> 'generationDepth',
    p_catalog_version, p_estimated_credits, p_idempotency_key
  ) returning * into v_plan;

  insert into public.content_plan_entries (workspace_id, plan_id, channel, post_count, images_per_post)
  select
    p_workspace_id,
    v_plan.id,
    entry.value ->> 'channel',
    (entry.value ->> 'postCount')::integer,
    (entry.value ->> 'imagesPerPost')::integer
  from jsonb_array_elements(p_request -> 'channels') as entry(value);
  get diagnostics v_channel_count = row_count;
  if v_channel_count < 1 then
    raise exception 'PLAN_CHANNELS_REQUIRED' using errcode = 'P0001';
  end if;

  return jsonb_build_object('planId', v_plan.id, 'version', v_plan.version, 'status', v_plan.status);
end;
$$;

create or replace function public.approve_period_content_plan(
  p_workspace_id uuid,
  p_plan_id uuid,
  p_expected_version integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.content_plans%rowtype;
begin
  if not private.has_workspace_role(p_workspace_id, array['owner', 'manager']::text[]) then
    raise exception 'PLAN_FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_plan from public.content_plans
  where workspace_id = p_workspace_id and id = p_plan_id for update;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_plan.approved_request_key = p_idempotency_key then
    return jsonb_build_object('planId', v_plan.id, 'version', v_plan.version, 'status', v_plan.status);
  end if;
  if v_plan.version <> p_expected_version or v_plan.status <> 'draft' then
    raise exception 'PLAN_VERSION_CONFLICT' using errcode = 'P0001';
  end if;

  update public.content_plans
  set status = 'approved', version = version + 1, approved_request_key = p_idempotency_key,
      approved_at = now(), updated_at = now()
  where id = v_plan.id
  returning * into v_plan;

  return jsonb_build_object('planId', v_plan.id, 'version', v_plan.version, 'status', v_plan.status);
end;
$$;

create or replace function public.create_checkout_intent(
  p_workspace_id uuid,
  p_billing_plan_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.checkout_intents%rowtype;
begin
  if not private.has_workspace_role(p_workspace_id, array['owner', 'manager']::text[]) then
    raise exception 'CHECKOUT_FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_intent from public.checkout_intents
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('checkoutIntentId', v_intent.id, 'state', v_intent.state);
  end if;
  if not exists (select 1 from public.billing_plans where id = p_billing_plan_id) then
    raise exception 'BILLING_PLAN_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.checkout_intents (workspace_id, billing_plan_id, idempotency_key, state)
  values (p_workspace_id, p_billing_plan_id, p_idempotency_key, 'provider_pending')
  returning * into v_intent;

  return jsonb_build_object('checkoutIntentId', v_intent.id, 'state', v_intent.state);
end;
$$;

revoke all on function public.get_workspace_credit_balance(uuid) from public, anon;
revoke all on function public.reserve_workspace_credits(uuid, text, integer, text, uuid) from public, anon;
revoke all on function public.list_workspace_credit_ledger(uuid, text, integer) from public, anon;
revoke all on function public.settle_credit_reservation(uuid, uuid, integer, text) from public, anon;
revoke all on function public.release_credit_reservation(uuid, uuid, integer, text) from public, anon;
revoke all on function public.create_period_content_plan(uuid, jsonb, integer, integer, text) from public, anon;
revoke all on function public.approve_period_content_plan(uuid, uuid, integer, text) from public, anon;
revoke all on function public.create_checkout_intent(uuid, uuid, text) from public, anon;
grant execute on function public.get_workspace_credit_balance(uuid) to authenticated, service_role;
grant execute on function public.reserve_workspace_credits(uuid, text, integer, text, uuid) to authenticated, service_role;
grant execute on function public.list_workspace_credit_ledger(uuid, text, integer) to authenticated, service_role;
grant execute on function public.settle_credit_reservation(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.release_credit_reservation(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.create_period_content_plan(uuid, jsonb, integer, integer, text) to authenticated, service_role;
grant execute on function public.approve_period_content_plan(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.create_checkout_intent(uuid, uuid, text) to authenticated, service_role;
