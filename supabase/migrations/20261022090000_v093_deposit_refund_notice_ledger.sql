-- ==============================================================================
-- Migration: 20261022090000_v093_deposit_refund_notice_ledger.sql
-- ANI-1615 (deposit intent snapshot), ANI-1616 (payment observation),
-- ANI-1617 (refund ledger + reconciliation), ANI-1620 (notice jobs).
--
-- Scope: TEST dataset only. No provider client, no PortOne/Kakao call, no secret.
-- Every table is workspace-scoped, RLS-enabled, read-only for workspace members and
-- fail-closed on dataset_mode: only 'TEST' rows may exist, so ACTUAL is impossible.
-- Every write goes through a SECURITY DEFINER RPC that only service_role may execute.
-- These RPCs never read or write booking/reservation rows.
-- ==============================================================================

-- 1. Deposit intent (frozen commercial snapshot before any payment request) ----
create table if not exists public.deposit_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  booking_id text not null,
  booking_version integer not null check (booking_version > 0),
  service_version text not null,
  customer_id text not null,
  policy text not null check (policy in ('OPTIONAL', 'REQUIRED')),
  amount_krw integer not null check (amount_krw > 0),
  total_service_price_krw integer not null,
  refund_rule_version text not null,
  cancellation_terms text not null,
  merchant_ref text not null,
  settlement_actor text not null check (settlement_actor = 'SHOP'),
  terms_fingerprint text not null,
  idempotency_key text not null,
  status text not null default 'PREPARED' check (status in (
    'PREPARED', 'REQUESTED', 'REQUEST_UNKNOWN', 'REQUEST_REJECTED', 'EXPIRED',
    'CANCELLED', 'TEST_PAID_MATCHED', 'NEEDS_REVIEW'
  )),
  expires_at timestamptz not null,
  dataset_mode text not null default 'TEST' check (dataset_mode = 'TEST'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_intents_total_covers_amount check (total_service_price_krw >= amount_krw),
  constraint deposit_intents_ws_idempotency_uniq unique (workspace_id, idempotency_key),
  constraint deposit_intents_ws_id_uniq unique (workspace_id, id)
);

comment on table public.deposit_intents is
  'TEST-only deposit intent snapshot. One active intent per booking; ACTUAL rows are impossible by constraint.';

-- At most one live intent per booking; terminal rows stay for history.
create unique index if not exists deposit_intents_ws_booking_active_uniq
  on public.deposit_intents (workspace_id, booking_id)
  where status in ('PREPARED', 'REQUESTED', 'REQUEST_UNKNOWN', 'TEST_PAID_MATCHED', 'NEEDS_REVIEW');

create index if not exists deposit_intents_ws_status_expires_idx
  on public.deposit_intents (workspace_id, status, expires_at);

-- 2. Webhook observation ledger ----------------------------------------------
create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider = 'portone'),
  event_id text not null,
  payload_digest text not null,
  intent_id uuid not null,
  outcome text not null check (outcome in ('MATCHED', 'MISMATCH', 'UNCONFIRMED')),
  dataset_mode text not null default 'TEST' check (dataset_mode = 'TEST'),
  received_at timestamptz not null default now(),
  constraint payment_webhook_events_ws_provider_event_uniq unique (workspace_id, provider, event_id),
  constraint payment_webhook_events_intent_fk foreign key (workspace_id, intent_id)
    references public.deposit_intents (workspace_id, id) on delete cascade
);

comment on table public.payment_webhook_events is
  'One row per provider event id per workspace. A different payload digest is a conflict, never an overwrite.';

create index if not exists payment_webhook_events_intent_idx
  on public.payment_webhook_events (workspace_id, intent_id, received_at desc);

-- 3. Captured payment ledger -------------------------------------------------
create table if not exists public.payment_captures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider = 'portone'),
  payment_ref text not null,
  intent_id uuid not null,
  amount_krw integer not null check (amount_krw > 0),
  currency text not null check (currency = 'KRW'),
  paid_at timestamptz not null,
  disputed boolean not null default false,
  dataset_mode text not null default 'TEST' check (dataset_mode = 'TEST'),
  created_at timestamptz not null default now(),
  constraint payment_captures_ws_provider_ref_uniq unique (workspace_id, provider, payment_ref),
  constraint payment_captures_ws_id_uniq unique (workspace_id, id),
  constraint payment_captures_intent_fk foreign key (workspace_id, intent_id)
    references public.deposit_intents (workspace_id, id) on delete cascade
);

comment on table public.payment_captures is
  'Captured money actually observed. A payment reference can bind exactly one intent per workspace.';

-- 4. Refund ledger -----------------------------------------------------------
create table if not exists public.deposit_refunds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  capture_id uuid not null,
  operation_key text not null,
  amount_krw integer not null check (amount_krw > 0),
  reason text not null,
  rule_version text not null,
  status text not null check (status in (
    'RESERVED', 'REQUESTED', 'UNKNOWN', 'REJECTED', 'TEST_REFUND_MATCHED', 'NEEDS_REVIEW'
  )),
  cancellation_ref text,
  dataset_mode text not null default 'TEST' check (dataset_mode = 'TEST'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_refunds_ws_operation_key_uniq unique (workspace_id, operation_key),
  constraint deposit_refunds_capture_fk foreign key (workspace_id, capture_id)
    references public.payment_captures (workspace_id, id) on delete cascade
);

comment on table public.deposit_refunds is
  'Refund reservations. UNKNOWN (provider timeout) is counted as consumed and blocks new keys on the capture.';

create index if not exists deposit_refunds_capture_status_idx
  on public.deposit_refunds (workspace_id, capture_id, status);

-- 5. Reconciliation queue (no silent retries; humans or jobs resolve) --------
create table if not exists public.payment_reconciliation_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  intent_id uuid not null,
  reason text not null check (reason in (
    'LATE_PAYMENT', 'BOOKING_CANCELLED', 'EXPIRED_INTENT', 'EVENT_CONFLICT', 'MISMATCH',
    'PAYMENT_REF_CONFLICT'
  )),
  dataset_mode text not null default 'TEST' check (dataset_mode = 'TEST'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint payment_reconciliation_queue_intent_fk foreign key (workspace_id, intent_id)
    references public.deposit_intents (workspace_id, id) on delete cascade
);

comment on table public.payment_reconciliation_queue is
  'Unresolved money observations. Repeated conflicting webhooks converge on one open row per reason.';

create unique index if not exists payment_reconciliation_queue_open_uniq
  on public.payment_reconciliation_queue (workspace_id, intent_id, reason)
  where resolved_at is null;

-- 6. Notice jobs (confirmation / reminder / change / cancellation) -----------
create table if not exists public.notice_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  booking_id text not null,
  -- ms epoch 예약 version. 같은 ms 안에서 재변경되는 경우까지 담아야 하므로 bigint다.
  booking_version bigint not null check (booking_version > 0),
  kind text not null check (kind in ('CONFIRMATION', 'REMINDER', 'CHANGE', 'CANCELLATION')),
  template_version text not null,
  recipient_ref_hash text not null check (recipient_ref_hash ~ '^[a-f0-9]{64}$'),
  scheduled_at timestamptz not null,
  payload_fingerprint text not null,
  status text not null default 'PLANNED' check (status in (
    'PLANNED', 'CLAIMED', 'REQUEST_ACCEPTED', 'UNKNOWN', 'INVALIDATED', 'HUMAN_REVIEW', 'REJECTED'
  )),
  claim_generation integer not null default 0 check (claim_generation >= 0),
  dataset_mode text not null default 'TEST' check (dataset_mode = 'TEST'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notice_jobs_natural_uniq unique (
    workspace_id, booking_id, booking_version, kind, template_version, recipient_ref_hash, scheduled_at
  )
);

comment on table public.notice_jobs is
  'Scheduled customer notices. The recipient is only stored as a 64-hex reference hash; raw contact data is rejected.';

create index if not exists notice_jobs_claim_idx
  on public.notice_jobs (workspace_id, status, scheduled_at)
  where status in ('PLANNED', 'CLAIMED');

create index if not exists notice_jobs_booking_idx
  on public.notice_jobs (workspace_id, booking_id, booking_version);

-- 7. Row Level Security: workspace members read, nobody but service_role writes
do $$
declare
  rec_table text;
  tables text[] := array[
    'deposit_intents',
    'payment_webhook_events',
    'payment_captures',
    'deposit_refunds',
    'payment_reconciliation_queue',
    'notice_jobs'
  ];
begin
  foreach rec_table in array tables loop
    execute format('alter table public.%I enable row level security', rec_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', rec_table);
    execute format('grant select on table public.%I to authenticated', rec_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', rec_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_workspace_member(workspace_id)))',
      rec_table || '_members_select', rec_table
    );
  end loop;
end $$;

-- No INSERT/UPDATE/DELETE policy exists on purpose: the only writer is service_role,
-- which bypasses RLS in Supabase, through the RPCs below.

-- 8. Atomic server RPCs ------------------------------------------------------

-- 8.1 commit_payment_observation: claim one provider event and settle the intent.
create or replace function public.commit_payment_observation(
  p_workspace_id uuid,
  p_event_id text,
  p_payload_digest text,
  p_intent_id uuid,
  p_payment_ref text,
  p_amount_krw integer,
  p_currency text,
  p_paid_at timestamptz,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.deposit_intents%rowtype;
  v_event public.payment_webhook_events%rowtype;
  v_existing_capture public.payment_captures%rowtype;
  v_capture public.payment_captures%rowtype;
  v_outcome text := p_outcome;
  v_conflict_kind text;
  v_queue_reason text;
  v_replay_capture uuid;
begin
  if p_workspace_id is null or p_intent_id is null
     or p_event_id is null or btrim(p_event_id) = ''
     or p_payload_digest is null or btrim(p_payload_digest) = '' then
    raise exception 'INVALID_ARGUMENT: workspace, intent, event id and payload digest are required'
      using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('MATCHED', 'MISMATCH', 'UNCONFIRMED') then
    raise exception 'INVALID_ARGUMENT: unsupported payment outcome %', p_outcome using errcode = '22023';
  end if;

  -- The intent is the tenant-scoped anchor; locking it serialises all observations.
  select * into v_intent
  from public.deposit_intents
  where workspace_id = p_workspace_id and id = p_intent_id
  for update;
  if not found then
    return jsonb_build_object('kind', 'NOT_FOUND');
  end if;

  -- 1. Event claim. Same digest is a replay; a different digest is a conflict and
  --    must never overwrite the recorded evidence.
  select * into v_event
  from public.payment_webhook_events
  where workspace_id = p_workspace_id and provider = 'portone' and event_id = p_event_id
  for update;
  if found then
    if v_event.payload_digest = p_payload_digest then
      return jsonb_build_object('kind', 'REPLAY', 'event_id', v_event.id, 'outcome', v_event.outcome);
    end if;
    update public.deposit_intents
       set status = 'NEEDS_REVIEW', updated_at = now()
     where workspace_id = p_workspace_id and id = v_intent.id;
    insert into public.payment_reconciliation_queue (workspace_id, intent_id, reason)
    values (p_workspace_id, v_intent.id, 'EVENT_CONFLICT')
    on conflict do nothing;
    return jsonb_build_object('kind', 'EVENT_CONFLICT', 'event_id', v_event.id);
  end if;

  -- 2. Matched observations must be provable before they are recorded.
  if p_outcome = 'MATCHED' then
    if p_payment_ref is null or btrim(p_payment_ref) = '' or p_paid_at is null
       or p_amount_krw is null or p_amount_krw <= 0 or p_currency is distinct from 'KRW' then
      raise exception 'INVALID_ARGUMENT: matched observation requires payment ref, positive KRW amount and paid_at'
        using errcode = '22023';
    end if;
    if p_amount_krw <> v_intent.amount_krw then
      v_outcome := 'MISMATCH';
      v_conflict_kind := 'AMOUNT_MISMATCH';
      v_queue_reason := 'MISMATCH';
    else
      select * into v_existing_capture
      from public.payment_captures
      where workspace_id = p_workspace_id and provider = 'portone' and payment_ref = p_payment_ref
      for update;
      if found then
        if v_existing_capture.intent_id = v_intent.id then
          v_replay_capture := v_existing_capture.id;
        else
          v_outcome := 'MISMATCH';
          v_conflict_kind := 'PAYMENT_REF_CONFLICT';
          v_queue_reason := 'PAYMENT_REF_CONFLICT';
        end if;
      end if;
    end if;
  end if;

  insert into public.payment_webhook_events (
    workspace_id, provider, event_id, payload_digest, intent_id, outcome
  ) values (
    p_workspace_id, 'portone', p_event_id, p_payload_digest, v_intent.id, v_outcome
  )
  on conflict (workspace_id, provider, event_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    -- A concurrent caller claimed the same event id first.
    select * into v_event
    from public.payment_webhook_events
    where workspace_id = p_workspace_id and provider = 'portone' and event_id = p_event_id;
    if v_event.payload_digest = p_payload_digest then
      return jsonb_build_object('kind', 'REPLAY', 'event_id', v_event.id, 'outcome', v_event.outcome);
    end if;
    update public.deposit_intents
       set status = 'NEEDS_REVIEW', updated_at = now()
     where workspace_id = p_workspace_id and id = v_intent.id;
    insert into public.payment_reconciliation_queue (workspace_id, intent_id, reason)
    values (p_workspace_id, v_intent.id, 'EVENT_CONFLICT')
    on conflict do nothing;
    return jsonb_build_object('kind', 'EVENT_CONFLICT', 'event_id', v_event.id);
  end if;

  if v_replay_capture is not null then
    return jsonb_build_object('kind', 'REPLAY', 'event_id', v_event.id, 'capture_id', v_replay_capture);
  end if;

  -- 3. Anything that is not a clean match is preserved as evidence but never settled.
  if v_outcome <> 'MATCHED' then
    update public.deposit_intents
       set status = 'NEEDS_REVIEW', updated_at = now()
     where workspace_id = p_workspace_id and id = v_intent.id;
    insert into public.payment_reconciliation_queue (workspace_id, intent_id, reason)
    values (p_workspace_id, v_intent.id, coalesce(v_queue_reason, 'MISMATCH'))
    on conflict do nothing;
    return jsonb_build_object(
      'kind', coalesce(v_conflict_kind, 'MISMATCH'),
      'event_id', v_event.id,
      'outcome', v_outcome
    );
  end if;

  -- 4. Record the capture. A payment reference is bound to exactly one intent.
  begin
    insert into public.payment_captures (
      workspace_id, provider, payment_ref, intent_id, amount_krw, currency, paid_at
    ) values (
      p_workspace_id, 'portone', p_payment_ref, v_intent.id, p_amount_krw, p_currency, p_paid_at
    )
    returning * into v_capture;
  exception when unique_violation then
    select * into v_capture
    from public.payment_captures
    where workspace_id = p_workspace_id and provider = 'portone' and payment_ref = p_payment_ref;
    if v_capture.intent_id <> v_intent.id then
      update public.deposit_intents
         set status = 'NEEDS_REVIEW', updated_at = now()
       where workspace_id = p_workspace_id and id = v_intent.id;
      insert into public.payment_reconciliation_queue (workspace_id, intent_id, reason)
      values (p_workspace_id, v_intent.id, 'PAYMENT_REF_CONFLICT')
      on conflict do nothing;
      return jsonb_build_object('kind', 'PAYMENT_REF_CONFLICT', 'event_id', v_event.id);
    end if;
    return jsonb_build_object('kind', 'REPLAY', 'event_id', v_event.id, 'capture_id', v_capture.id);
  end;

  -- 5. Money that arrives after expiry, or for a cancelled/expired intent, is kept
  --    as financial evidence. The booking itself is never restored or refunded here.
  if p_paid_at > v_intent.expires_at or v_intent.status in ('EXPIRED', 'CANCELLED') then
    update public.deposit_intents
       set status = 'NEEDS_REVIEW', updated_at = now()
     where workspace_id = p_workspace_id and id = v_intent.id;
    insert into public.payment_reconciliation_queue (workspace_id, intent_id, reason)
    values (p_workspace_id, v_intent.id, 'LATE_PAYMENT')
    on conflict do nothing;
    return jsonb_build_object('kind', 'LATE_PAYMENT', 'event_id', v_event.id, 'capture_id', v_capture.id);
  end if;

  update public.deposit_intents
     set status = 'TEST_PAID_MATCHED', updated_at = now()
   where workspace_id = p_workspace_id and id = v_intent.id;

  return jsonb_build_object('kind', 'MATCHED', 'event_id', v_event.id, 'capture_id', v_capture.id);
end;
$$;

-- 8.2 reserve_deposit_refund: idempotent reservation bounded by the capture.
create or replace function public.reserve_deposit_refund(
  p_workspace_id uuid,
  p_payment_ref text,
  p_operation_key text,
  p_amount_krw integer,
  p_reason text,
  p_rule_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capture public.payment_captures%rowtype;
  v_existing public.deposit_refunds%rowtype;
  v_refund public.deposit_refunds%rowtype;
  v_used integer;
  v_available integer;
begin
  if p_workspace_id is null
     or p_payment_ref is null or btrim(p_payment_ref) = ''
     or p_operation_key is null or btrim(p_operation_key) = ''
     or p_amount_krw is null or p_amount_krw <= 0 then
    raise exception 'INVALID_ARGUMENT: workspace, payment ref, operation key and positive amount are required'
      using errcode = '22023';
  end if;

  select * into v_capture
  from public.payment_captures
  where workspace_id = p_workspace_id and provider = 'portone' and payment_ref = p_payment_ref
  for update;
  if not found then
    return jsonb_build_object('kind', 'CAPTURE_NOT_FOUND');
  end if;

  -- Idempotency first: a retried operation must replay even when nothing is available.
  select * into v_existing
  from public.deposit_refunds
  where workspace_id = p_workspace_id and operation_key = p_operation_key
  for update;
  if found then
    if v_existing.capture_id <> v_capture.id then
      return jsonb_build_object('kind', 'CONFLICT', 'reason', 'OPERATION_KEY_BOUND_TO_OTHER_CAPTURE');
    end if;
    if v_existing.amount_krw = p_amount_krw then
      return jsonb_build_object('kind', 'REPLAY', 'refund_id', v_existing.id, 'status', v_existing.status);
    end if;
    return jsonb_build_object('kind', 'CONFLICT', 'refund_id', v_existing.id);
  end if;

  -- A dispute freezes the money: no automatic refund while it is open.
  if v_capture.disputed then
    return jsonb_build_object('kind', 'BLOCKED_DISPUTE', 'capture_id', v_capture.id);
  end if;

  -- An UNKNOWN refund may have reached the provider. Hold every other key.
  if exists (
    select 1 from public.deposit_refunds
    where workspace_id = p_workspace_id
      and capture_id = v_capture.id
      and status = 'UNKNOWN'
      and operation_key <> p_operation_key
  ) then
    return jsonb_build_object('kind', 'HOLD_UNKNOWN_REFUND', 'capture_id', v_capture.id);
  end if;

  select coalesce(sum(amount_krw), 0) into v_used
  from public.deposit_refunds
  where workspace_id = p_workspace_id
    and capture_id = v_capture.id
    and status in ('TEST_REFUND_MATCHED', 'RESERVED', 'REQUESTED', 'UNKNOWN');

  v_available := v_capture.amount_krw - v_used;
  if p_amount_krw > v_available then
    return jsonb_build_object('kind', 'EXCEEDS_AVAILABLE', 'available_krw', v_available);
  end if;

  insert into public.deposit_refunds (
    workspace_id, capture_id, operation_key, amount_krw, reason, rule_version, status
  ) values (
    p_workspace_id, v_capture.id, p_operation_key, p_amount_krw,
    coalesce(p_reason, ''), coalesce(p_rule_version, ''), 'RESERVED'
  )
  returning * into v_refund;

  return jsonb_build_object(
    'kind', 'RESERVED',
    'refund_id', v_refund.id,
    'available_krw', v_available - p_amount_krw
  );
end;
$$;

-- 8.3 claim_notice_job: one statement CAS, so two schedulers cannot both win.
create or replace function public.claim_notice_job(
  p_workspace_id uuid,
  p_job_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.notice_jobs%rowtype;
  v_current public.notice_jobs%rowtype;
begin
  if p_workspace_id is null or p_job_id is null or p_now is null then
    raise exception 'INVALID_ARGUMENT: workspace, job and now are required' using errcode = '22023';
  end if;

  update public.notice_jobs
     set status = 'CLAIMED',
         claim_generation = claim_generation + 1,
         updated_at = now()
   where workspace_id = p_workspace_id
     and id = p_job_id
     and status = 'PLANNED'
     and scheduled_at <= p_now
  returning * into v_job;

  if v_job.id is not null then
    return jsonb_build_object(
      'kind', 'CLAIMED',
      'claim_generation', v_job.claim_generation,
      'job', to_jsonb(v_job)
    );
  end if;

  select * into v_current
  from public.notice_jobs
  where workspace_id = p_workspace_id and id = p_job_id;
  if not found then
    return jsonb_build_object('kind', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'kind', 'NOT_CLAIMABLE',
    'status', v_current.status,
    'scheduled_at', v_current.scheduled_at,
    'claim_generation', v_current.claim_generation
  );
end;
$$;

-- 8.4 invalidate_notice_jobs: stale versions are voided, in-flight notices are not.
create or replace function public.invalidate_notice_jobs(
  p_workspace_id uuid,
  p_booking_id text,
  p_current_version bigint,
  p_current_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invalidated integer := 0;
  v_in_flight integer := 0;
begin
  if p_workspace_id is null
     or p_booking_id is null or btrim(p_booking_id) = ''
     or p_current_version is null or p_current_version <= 0
     or p_current_status is null or btrim(p_current_status) = '' then
    raise exception 'INVALID_ARGUMENT: workspace, booking, positive version and status are required'
      using errcode = '22023';
  end if;

  with invalidated as (
    update public.notice_jobs
       set status = 'INVALIDATED', updated_at = now()
     where workspace_id = p_workspace_id
       and booking_id = p_booking_id
       and status in ('PLANNED', 'CLAIMED')
       -- version이 현재와 다르면(더 오래됐거나 더 새것이거나) 구 job으로 본다. `<` 였다면
       -- 현재보다 큰 version의 job이 살아남았다. 정확히 같은 version의 job은 여기서 유지하며,
       -- 같은 ms 안에서 방문 시각만 바뀐 경우는 dispatch 직전 재검증이 잡는다.
       and (booking_version <> p_current_version or p_current_status <> 'CONFIRMED')
       -- A cancellation at the current version is exactly the notice we want to keep.
       and not (
         kind = 'CANCELLATION'
         and p_current_status = 'CANCELLED'
         and booking_version = p_current_version
       )
    returning 1
  )
  select count(*) into v_invalidated from invalidated;

  -- Already accepted or unknown notices are never silently rewritten.
  select count(*) into v_in_flight
  from public.notice_jobs
  where workspace_id = p_workspace_id
    and booking_id = p_booking_id
    and status in ('REQUEST_ACCEPTED', 'UNKNOWN');

  return jsonb_build_object(
    'kind', 'OK',
    'invalidated', v_invalidated,
    'in_flight_or_sent', v_in_flight
  );
end;
$$;

-- 9. Privileges: service_role only ------------------------------------------
revoke all on function public.commit_payment_observation(uuid, text, text, uuid, text, integer, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.reserve_deposit_refund(uuid, text, text, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_notice_job(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.invalidate_notice_jobs(uuid, text, bigint, text)
  from public, anon, authenticated;

grant execute on function public.commit_payment_observation(uuid, text, text, uuid, text, integer, text, timestamptz, text)
  to service_role;
grant execute on function public.reserve_deposit_refund(uuid, text, text, integer, text, text)
  to service_role;
grant execute on function public.claim_notice_job(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.invalidate_notice_jobs(uuid, text, bigint, text)
  to service_role;

-- Rollback plan: see docs/v093-orchestration/evidence/rollback-20261022090000.md
