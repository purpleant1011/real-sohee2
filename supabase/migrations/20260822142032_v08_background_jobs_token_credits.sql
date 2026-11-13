insert into public.credit_rate_versions (catalog_version, rates, policy_status)
values (
  8002,
  jsonb_build_object(
    'policyVersion', 'v08-test-2000-1',
    'policy', 'test',
    'timezone', 'Asia/Seoul',
    'weeklyPreviewAllowanceCredits', 2000,
    'commercialIncludedCredits', null,
    'microcreditsPerCredit', 1000000,
    'weights', jsonb_build_object(
      'uncachedTextInput', 250,
      'cachedTextInput', 63,
      'textOutput', 1000,
      'imageInput', 1000,
      'imageOutput', 6250
    )
  ),
  'draft'
)
on conflict (catalog_version) do update
set rates = excluded.rates,
    policy_status = excluded.policy_status;

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
  v_existing_allowance integer := 0;
  v_entry_kind text;
  v_entry_amount integer;
  v_grant_key text;
begin
  select * into v_period from private.v08_preview_credit_period(p_at);

  select (rates ->> 'weeklyPreviewAllowanceCredits')::integer
  into v_allowance
  from public.credit_rate_versions
  where catalog_version = 8002
    and policy_status = 'draft'
    and rates ->> 'policyVersion' = 'v08-test-2000-1'
    and rates ->> 'policy' = 'test';

  if v_allowance is distinct from 2000 then
    raise exception 'CREDIT_TEST_POLICY_UNAVAILABLE' using errcode = 'P0001';
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

  if v_existing_allowance < v_allowance then
    v_entry_kind := case when v_existing_allowance = 0 then 'grant' else 'adjustment' end;
    v_entry_amount := v_allowance - v_existing_allowance;
    v_grant_key := 'v08-test-2000-1:' || v_period.period_start::text || ':allowance';
    insert into public.credit_ledger_entries (
      workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key
    ) values (
      p_workspace_id, v_account_id, null, v_entry_kind, null, v_entry_amount, v_grant_key
    ) on conflict (workspace_id, idempotency_key, kind) do nothing;
  end if;

  return v_account_id;
end;
$$;

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
    'available', v_granted + v_adjustments + v_released - v_consumed - v_reserved,
    'weeklyLimit', 2000,
    'policyVersion', 'v08-test-2000-1'
  );
end;
$$;

create table public.conversation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null,
  user_message_id uuid not null,
  assistant_message_id uuid not null,
  kind text not null check (kind in ('chat', 'content_generation', 'image_generation', 'publish_preparation')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'cancel_requested', 'succeeded', 'needs_attention', 'cancelled')),
  sequence_number bigint not null check (sequence_number > 0),
  reservation_id uuid not null references public.credit_reservations(id) on delete restrict,
  worker_id uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  safe_error_code text check (safe_error_code is null or char_length(safe_error_code) <= 120),
  queued_at timestamptz not null default now(),
  queue_dispatched_at timestamptz,
  dispatch_failed_at timestamptz,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  cancel_requested_at timestamptz,
  cancel_requested_by uuid references auth.users(id),
  attention_resolved_at timestamptz,
  attention_resolution text check (
    attention_resolution is null
    or attention_resolution in ('result_restored', 'retry_created', 'ended', 'publish_reconciled')
  ),
  constraint conversation_jobs_thread_fkey foreign key (workspace_id, thread_id)
    references public.conversation_threads(workspace_id, id) on delete cascade,
  constraint conversation_jobs_user_message_fkey foreign key (workspace_id, thread_id, user_message_id)
    references public.messages(workspace_id, thread_id, id) on delete restrict,
  constraint conversation_jobs_assistant_message_fkey foreign key (workspace_id, thread_id, assistant_message_id)
    references public.messages(workspace_id, thread_id, id) on delete restrict,
  constraint conversation_jobs_workspace_user_message_key unique (workspace_id, user_message_id),
  constraint conversation_jobs_thread_sequence_key unique (thread_id, sequence_number),
  constraint conversation_jobs_terminal_time_check check (
    (status in ('queued', 'running', 'cancel_requested') and completed_at is null)
    or (status in ('succeeded', 'needs_attention', 'cancelled') and completed_at is not null)
  )
);

create index conversation_jobs_workspace_status_idx
  on public.conversation_jobs(workspace_id, status, queued_at desc);
create index conversation_jobs_thread_sequence_idx
  on public.conversation_jobs(thread_id, sequence_number);

create table public.conversation_job_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.conversation_jobs(id) on delete cascade,
  provider_call_key text not null check (char_length(provider_call_key) between 1 and 200),
  operation text not null check (operation in ('text_response', 'image_generation', 'image_edit')),
  state text not null check (state in ('prepared', 'in_flight', 'succeeded', 'failed', 'unknown')),
  provider_request_id text check (provider_request_id is null or char_length(provider_request_id) <= 255),
  safe_error_code text check (safe_error_code is null or char_length(safe_error_code) <= 120),
  prepared_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint conversation_job_steps_workspace_job_key unique (workspace_id, job_id, id),
  constraint conversation_job_steps_job_call_key unique (job_id, provider_call_key)
);

create index conversation_job_steps_job_state_idx
  on public.conversation_job_steps(job_id, state, prepared_at);

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.conversation_jobs(id) on delete restrict,
  message_id uuid not null,
  provider text not null check (provider = 'openai'),
  model text not null check (char_length(model) between 1 and 120),
  operation text not null check (operation in ('text_response', 'image_generation', 'image_edit')),
  provider_request_id text check (provider_request_id is null or char_length(provider_request_id) <= 255),
  provider_call_key text not null check (char_length(provider_call_key) between 1 and 200),
  text_input_tokens integer not null check (text_input_tokens >= 0),
  cached_text_input_tokens integer not null check (
    cached_text_input_tokens >= 0 and cached_text_input_tokens <= text_input_tokens
  ),
  text_output_tokens integer not null check (text_output_tokens >= 0),
  image_input_tokens integer not null check (image_input_tokens >= 0),
  image_output_tokens integer not null check (image_output_tokens >= 0),
  provider_total_tokens integer not null check (provider_total_tokens >= 0),
  usage_source text not null check (usage_source in ('actual', 'estimated_missing_usage')),
  policy_version text not null check (char_length(policy_version) between 1 and 80),
  computed_credits integer not null check (computed_credits > 0),
  occurred_at timestamptz not null default now(),
  constraint ai_usage_events_message_fkey foreign key (workspace_id, message_id)
    references public.messages(workspace_id, id) on delete restrict,
  constraint ai_usage_events_workspace_call_key unique (workspace_id, provider_call_key)
);

create index ai_usage_events_job_idx on public.ai_usage_events(job_id, occurred_at);

create or replace function public.record_ai_usage_event(
  p_workspace_id uuid,
  p_job_id uuid,
  p_message_id uuid,
  p_provider_call_key text,
  p_provider_request_id text,
  p_model text,
  p_operation text,
  p_text_input_tokens integer,
  p_cached_text_input_tokens integer,
  p_text_output_tokens integer,
  p_image_input_tokens integer,
  p_image_output_tokens integer,
  p_provider_total_tokens integer,
  p_usage_source text,
  p_policy_version text,
  p_computed_credits integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_usage public.ai_usage_events%rowtype;
begin
  if not exists (
    select 1 from public.conversation_jobs
    where id = p_job_id and workspace_id = p_workspace_id and assistant_message_id = p_message_id
  ) then
    raise exception 'AI_USAGE_JOB_MISMATCH' using errcode = '22023';
  end if;

  insert into public.ai_usage_events (
    workspace_id, job_id, message_id, provider, model, operation,
    provider_request_id, provider_call_key, text_input_tokens,
    cached_text_input_tokens, text_output_tokens, image_input_tokens,
    image_output_tokens, provider_total_tokens, usage_source,
    policy_version, computed_credits
  ) values (
    p_workspace_id, p_job_id, p_message_id, 'openai', p_model, p_operation,
    p_provider_request_id, p_provider_call_key, p_text_input_tokens,
    p_cached_text_input_tokens, p_text_output_tokens, p_image_input_tokens,
    p_image_output_tokens, p_provider_total_tokens, p_usage_source,
    p_policy_version, p_computed_credits
  ) on conflict (workspace_id, provider_call_key) do nothing;

  select * into v_usage from public.ai_usage_events
  where workspace_id = p_workspace_id and provider_call_key = p_provider_call_key;

  if v_usage.job_id <> p_job_id
    or v_usage.message_id <> p_message_id
    or v_usage.model <> p_model
    or v_usage.operation <> p_operation
    or v_usage.computed_credits <> p_computed_credits
  then
    raise exception 'AI_USAGE_IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;
  return true;
end;
$$;

create or replace function private.prevent_ai_usage_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AI_USAGE_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

create trigger ai_usage_events_append_only
before update or delete on public.ai_usage_events
for each row execute function private.prevent_ai_usage_mutation();

alter table public.conversation_jobs enable row level security;
alter table public.conversation_job_steps enable row level security;
alter table public.ai_usage_events enable row level security;

create policy "workspace members can read conversation jobs"
on public.conversation_jobs for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read conversation job steps"
on public.conversation_job_steps for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read AI usage events"
on public.ai_usage_events for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on public.conversation_jobs, public.conversation_job_steps, public.ai_usage_events
from public, anon, authenticated;
grant select on public.conversation_jobs, public.conversation_job_steps, public.ai_usage_events
to authenticated;
grant select, insert, update on public.conversation_jobs, public.conversation_job_steps
to service_role;
grant select, insert on public.ai_usage_events to service_role;

revoke all on function public.record_ai_usage_event(
  uuid, uuid, uuid, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, integer
) from public, anon, authenticated;
grant execute on function public.record_ai_usage_event(
  uuid, uuid, uuid, text, text, text, text,
  integer, integer, integer, integer, integer, integer, text, text, integer
) to service_role;

create or replace function public.enqueue_conversation_job(
  p_workspace_id uuid,
  p_thread_id uuid,
  p_user_id uuid,
  p_client_message_id uuid,
  p_display_content text,
  p_execution_content text,
  p_kind text,
  p_requested_credits integer,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_message public.messages%rowtype;
  v_assistant_message public.messages%rowtype;
  v_job public.conversation_jobs%rowtype;
  v_reservation public.credit_reservations%rowtype;
  v_sequence bigint;
  v_action text;
begin
  if p_kind not in ('chat', 'content_generation', 'image_generation', 'publish_preparation')
    or p_requested_credits <= 0
    or char_length(btrim(p_display_content)) not between 1 and 8000
    or char_length(btrim(p_execution_content)) not between 1 and 8000
  then
    raise exception 'CONVERSATION_JOB_INVALID' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_user_id and status = 'active'
  ) or not exists (
    select 1 from public.conversation_threads
    where workspace_id = p_workspace_id and id = p_thread_id and status = 'active'
  ) then
    raise exception 'CONVERSATION_JOB_FORBIDDEN' using errcode = '42501';
  end if;

  select message.* into v_user_message
  from public.messages as message
  where message.workspace_id = p_workspace_id
    and message.client_message_id = p_client_message_id;

  if v_user_message.id is not null then
    select job.* into v_job
    from public.conversation_jobs as job
    where job.workspace_id = p_workspace_id and job.user_message_id = v_user_message.id;
    if v_user_message.thread_id <> p_thread_id
      or v_user_message.created_by_user_id <> p_user_id
      or v_user_message.content <> btrim(p_display_content)
    then
      raise exception 'CONVERSATION_JOB_REQUEST_CONFLICT' using errcode = '23505';
    end if;
    if v_job.id is not null then
      select * into v_assistant_message from public.messages where id = v_job.assistant_message_id;
      select * into v_reservation from public.credit_reservations
      where workspace_id = p_workspace_id and id = v_job.reservation_id;
      return jsonb_build_object(
        'job', to_jsonb(v_job),
        'userMessage', to_jsonb(v_user_message),
        'assistantMessage', to_jsonb(v_assistant_message),
        'reservation', jsonb_build_object(
          'id', v_reservation.id,
          'requestedCredits', v_reservation.requested_credits
        )
      );
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_thread_id::text, 0));

  if v_user_message.id is null then
    insert into public.messages (
      workspace_id, thread_id, role, content, status, client_message_id,
      created_by_user_id, completed_at, usage_metadata
    ) values (
      p_workspace_id, p_thread_id, 'user', btrim(p_display_content), 'completed',
      p_client_message_id, p_user_id, statement_timestamp(),
      jsonb_build_object('executionContent', btrim(p_execution_content))
    ) returning * into v_user_message;
  else
    update public.messages
    set usage_metadata = usage_metadata || jsonb_build_object('executionContent', btrim(p_execution_content))
    where id = v_user_message.id;
  end if;

  insert into public.messages (
    workspace_id, thread_id, role, content, status, reply_to_message_id, model_name
  ) values (
    p_workspace_id, p_thread_id, 'sohee', '작업을 준비하고 있습니다.', 'queued',
    v_user_message.id, case when p_kind = 'image_generation' then 'gpt-image-2' else 'gpt-5.6-luna' end
  ) returning * into v_assistant_message;

  v_action := case
    when p_kind = 'image_generation' then 'image_generation'
    when p_kind = 'content_generation' then 'text_generation'
    else 'chat_turn'
  end;

  perform public.reserve_workspace_credits(
    p_workspace_id,
    v_action,
    p_requested_credits,
    'conversation-job:' || p_client_message_id::text || ':reserve',
    p_reservation_id
  );

  select * into v_reservation from public.credit_reservations
  where workspace_id = p_workspace_id and id = p_reservation_id;

  select coalesce(max(sequence_number), 0) + 1 into v_sequence
  from public.conversation_jobs where thread_id = p_thread_id;

  insert into public.conversation_jobs (
    workspace_id, thread_id, user_message_id, assistant_message_id, kind,
    status, sequence_number, reservation_id
  ) values (
    p_workspace_id, p_thread_id, v_user_message.id, v_assistant_message.id, p_kind,
    'queued', v_sequence, p_reservation_id
  ) returning * into v_job;

  update public.conversation_threads
  set last_message_at = statement_timestamp(), updated_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = p_thread_id;

  return jsonb_build_object(
    'job', to_jsonb(v_job),
    'userMessage', to_jsonb(v_user_message),
    'assistantMessage', to_jsonb(v_assistant_message),
    'reservation', jsonb_build_object(
      'id', v_reservation.id,
      'requestedCredits', v_reservation.requested_credits
    )
  );
end;
$$;

create or replace function public.claim_conversation_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
begin
  select * into v_job from public.conversation_jobs where id = p_job_id for update;
  if v_job.id is null then return jsonb_build_object('state', 'missing'); end if;
  if v_job.status in ('succeeded', 'needs_attention', 'cancelled') then
    return jsonb_build_object('state', 'terminal', 'job', to_jsonb(v_job));
  end if;
  if v_job.status = 'running' and v_job.heartbeat_at >= p_now - interval '15 minutes' then
    return jsonb_build_object('state', 'not_claimed');
  end if;
  if v_job.status in ('running', 'cancel_requested') then
    update public.conversation_jobs
    set status = 'needs_attention', completed_at = p_now, heartbeat_at = p_now,
        safe_error_code = 'PROVIDER_RESULT_UNKNOWN'
    where id = v_job.id returning * into v_job;
    update public.messages
    set status = 'failed', completed_at = p_now,
        content = case when content = '작업을 준비하고 있습니다.' then '작업 결과를 확인해 주세요.' else content end
    where id = v_job.assistant_message_id and status in ('queued', 'streaming');
    return jsonb_build_object('state', 'terminal', 'job', to_jsonb(v_job));
  end if;
  if exists (
    select 1 from public.conversation_jobs predecessor
    where predecessor.thread_id = v_job.thread_id
      and predecessor.sequence_number < v_job.sequence_number
      and (
        predecessor.status in ('queued', 'running', 'cancel_requested')
        or (predecessor.status = 'needs_attention' and predecessor.attention_resolved_at is null)
      )
  ) then
    return jsonb_build_object('state', 'blocked_by_predecessor');
  end if;
  update public.conversation_jobs
  set status = 'running', worker_id = p_worker_id, attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, p_now), heartbeat_at = p_now
  where id = v_job.id and status = 'queued'
  returning * into v_job;
  if v_job.id is null then return jsonb_build_object('state', 'not_claimed'); end if;
  update public.messages set status = 'streaming'
  where id = v_job.assistant_message_id and status = 'queued';
  return jsonb_build_object('state', 'claimed', 'job', to_jsonb(v_job));
end;
$$;

create or replace function public.complete_conversation_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_status text,
  p_safe_error_code text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
begin
  if p_status not in ('succeeded', 'needs_attention', 'cancelled') then
    raise exception 'CONVERSATION_JOB_STATUS_INVALID' using errcode = '22023';
  end if;
  update public.conversation_jobs
  set status = p_status, safe_error_code = p_safe_error_code, completed_at = p_now,
      heartbeat_at = p_now
  where id = p_job_id and worker_id = p_worker_id and status in ('running', 'cancel_requested')
  returning * into v_job;
  if v_job.id is null then
    select * into v_job from public.conversation_jobs where id = p_job_id;
  end if;
  if v_job.id is not null and p_status in ('needs_attention', 'cancelled') then
    update public.messages
    set status = case when p_status = 'cancelled' then 'cancelled' else 'failed' end,
        completed_at = p_now,
        content = case
          when p_status = 'needs_attention' and content = '작업을 준비하고 있습니다.'
            then '작업 결과를 확인해 주세요.'
          else content
        end
    where id = v_job.assistant_message_id and status in ('queued', 'streaming');
  end if;
  return jsonb_build_object('job', to_jsonb(v_job));
end;
$$;

create or replace function public.get_conversation_work_status(p_workspace_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_balance jsonb;
begin
  if not private.is_workspace_member(p_workspace_id) then
    raise exception 'CONVERSATION_WORK_STATUS_FORBIDDEN' using errcode = '42501';
  end if;
  v_balance := public.get_workspace_credit_balance(p_workspace_id);
  return jsonb_build_object(
    'activeJobCount', (
      select count(*) from public.conversation_jobs
      where workspace_id = p_workspace_id and status in ('queued', 'running', 'cancel_requested')
    ),
    'attentionThreadCount', (
      select count(distinct thread_id) from public.conversation_jobs
      where workspace_id = p_workspace_id and status = 'needs_attention' and attention_resolved_at is null
    ),
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'threadId', thread.id,
        'displayStatus', case
          when thread.status = 'archived' then 'archived'
          when exists (select 1 from public.conversation_jobs active where active.thread_id = thread.id and active.status in ('queued', 'running', 'cancel_requested')) then 'working'
          when exists (select 1 from public.conversation_jobs attention where attention.thread_id = thread.id and attention.status = 'needs_attention' and attention.attention_resolved_at is null) then 'attention'
          else 'idle'
        end,
        'activeJobCount', (select count(*) from public.conversation_jobs active where active.thread_id = thread.id and active.status in ('queued', 'running', 'cancel_requested')),
        'latestJobUpdatedAt', (select max(coalesce(job.heartbeat_at, job.completed_at, job.queued_at)) from public.conversation_jobs job where job.thread_id = thread.id)
      ) order by thread.last_message_at desc nulls last, thread.created_at desc)
      from public.conversation_threads thread where thread.workspace_id = p_workspace_id
    ), '[]'::jsonb),
    'creditBalance', v_balance || jsonb_build_object(
      'weeklyLimit', 2000,
      'policyVersion', 'v08-test-2000-1'
    ),
    'observedAt', statement_timestamp()
  );
end;
$$;

create or replace function public.persist_conversation_job_request(
  p_workspace_id uuid,
  p_job_id uuid,
  p_request_metadata jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_message_id uuid;
begin
  if jsonb_typeof(p_request_metadata) <> 'object'
    or (p_request_metadata - array['attachmentIds', 'replyToMessageId', 'selectedSlideId', 'retryFailedSlideId', 'retryAssistantMessageId']) <> '{}'::jsonb
  then
    raise exception 'CONVERSATION_JOB_METADATA_INVALID' using errcode = '22023';
  end if;
  select user_message_id into v_message_id from public.conversation_jobs
  where id = p_job_id and workspace_id = p_workspace_id;
  if v_message_id is null then raise exception 'CONVERSATION_JOB_NOT_FOUND' using errcode = 'P0001'; end if;
  update public.messages
  set usage_metadata = usage_metadata || p_request_metadata
  where workspace_id = p_workspace_id and id = v_message_id and role = 'user';
  return found;
end;
$$;

create or replace function public.mark_conversation_job_dispatched(
  p_workspace_id uuid,
  p_job_id uuid,
  p_now timestamptz
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  update public.conversation_jobs
  set queue_dispatched_at = coalesce(queue_dispatched_at, p_now)
  where workspace_id = p_workspace_id and id = p_job_id
  returning true;
$$;

create or replace function public.fail_conversation_job_dispatch(
  p_workspace_id uuid,
  p_job_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
  v_reservation public.credit_reservations%rowtype;
  v_remaining integer;
begin
  select * into v_job from public.conversation_jobs
  where workspace_id = p_workspace_id and id = p_job_id for update;
  if v_job.id is null then return false; end if;
  if v_job.status = 'queued' then
    update public.conversation_jobs
    set status = 'needs_attention', safe_error_code = 'QUEUE_DISPATCH_FAILED',
        completed_at = p_now, dispatch_failed_at = p_now
    where id = v_job.id;
    update public.messages
    set status = 'failed', completed_at = p_now, content = '작업을 시작하지 못했어요.'
    where id = v_job.assistant_message_id and status = 'queued';
  end if;
  select * into v_reservation from public.credit_reservations
  where id = v_job.reservation_id and workspace_id = p_workspace_id;
  v_remaining := coalesce(v_reservation.requested_credits - v_reservation.settled_credits - v_reservation.released_credits, 0);
  if v_remaining > 0 then
    perform public.release_credit_reservation(
      p_workspace_id, v_reservation.id, v_remaining,
      v_job.id::text || ':dispatch-failed-release'
    );
  end if;
  return true;
end;
$$;

create or replace function public.request_conversation_job_cancel(
  p_workspace_id uuid,
  p_job_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
  v_reservation public.credit_reservations%rowtype;
  v_remaining integer;
begin
  if (select auth.uid()) is null
    or (select auth.uid()) <> p_user_id
    or not private.is_workspace_member(p_workspace_id)
  then
    raise exception 'CONVERSATION_JOB_CANCEL_FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_job from public.conversation_jobs
  where workspace_id = p_workspace_id and id = p_job_id for update;

  if v_job.status = 'queued' then
    update public.conversation_jobs
    set status = 'cancelled', completed_at = statement_timestamp(),
        cancel_requested_at = statement_timestamp(), cancel_requested_by = p_user_id
    where id = v_job.id returning * into v_job;
    update public.messages set status = 'cancelled', completed_at = statement_timestamp()
    where id = v_job.assistant_message_id and status = 'queued';
    select * into v_reservation from public.credit_reservations
    where id = v_job.reservation_id and workspace_id = p_workspace_id;
    v_remaining := coalesce(v_reservation.requested_credits - v_reservation.settled_credits - v_reservation.released_credits, 0);
    if v_remaining > 0 then
      perform public.release_credit_reservation(
        p_workspace_id, v_reservation.id, v_remaining,
        v_job.id::text || ':queued-cancel-release'
      );
    end if;
  elsif v_job.status = 'running' then
    update public.conversation_jobs
    set status = 'cancel_requested', cancel_requested_at = statement_timestamp(),
        cancel_requested_by = p_user_id
    where id = v_job.id returning * into v_job;
  end if;

  if v_job.id is null then
    raise exception 'CONVERSATION_JOB_NOT_FOUND' using errcode = 'P0001';
  end if;
  return jsonb_build_object('job', to_jsonb(v_job));
end;
$$;

create or replace function public.resolve_conversation_job_attention(
  p_workspace_id uuid,
  p_job_id uuid,
  p_user_id uuid,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
begin
  if (select auth.uid()) is null
    or (select auth.uid()) <> p_user_id
    or not private.is_workspace_member(p_workspace_id)
  then
    raise exception 'CONVERSATION_JOB_RESOLVE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_resolution not in ('result_restored', 'retry_created', 'ended', 'publish_reconciled') then
    raise exception 'CONVERSATION_JOB_RESOLUTION_INVALID' using errcode = '22023';
  end if;
  update public.conversation_jobs
  set attention_resolved_at = statement_timestamp(),
      attention_resolution = p_resolution
  where workspace_id = p_workspace_id
    and id = p_job_id
    and status = 'needs_attention'
    and attention_resolved_at is null
  returning * into v_job;
  if v_job.id is null then
    raise exception 'CONVERSATION_JOB_NOT_RESOLVABLE' using errcode = 'P0001';
  end if;
  return jsonb_build_object('job', to_jsonb(v_job));
end;
$$;

revoke all on function public.enqueue_conversation_job(uuid, uuid, uuid, uuid, text, text, text, integer, uuid)
from public, anon, authenticated;
revoke all on function public.claim_conversation_job(uuid, uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.complete_conversation_job(uuid, uuid, text, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.get_conversation_work_status(uuid) from public, anon;
revoke all on function public.persist_conversation_job_request(uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.mark_conversation_job_dispatched(uuid, uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.fail_conversation_job_dispatch(uuid, uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.request_conversation_job_cancel(uuid, uuid, uuid)
from public, anon;
revoke all on function public.resolve_conversation_job_attention(uuid, uuid, uuid, text)
from public, anon;

grant execute on function public.enqueue_conversation_job(uuid, uuid, uuid, uuid, text, text, text, integer, uuid)
to service_role;
grant execute on function public.claim_conversation_job(uuid, uuid, timestamptz) to service_role;
grant execute on function public.complete_conversation_job(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.get_conversation_work_status(uuid) to authenticated, service_role;
grant execute on function public.persist_conversation_job_request(uuid, uuid, jsonb) to service_role;
grant execute on function public.mark_conversation_job_dispatched(uuid, uuid, timestamptz) to service_role;
grant execute on function public.fail_conversation_job_dispatch(uuid, uuid, timestamptz) to service_role;
grant execute on function public.request_conversation_job_cancel(uuid, uuid, uuid)
to authenticated;
grant execute on function public.resolve_conversation_job_attention(uuid, uuid, uuid, text)
to authenticated;

select private.ensure_v08_preview_credit_account(workspace.id, statement_timestamp())
from public.workspaces as workspace;
