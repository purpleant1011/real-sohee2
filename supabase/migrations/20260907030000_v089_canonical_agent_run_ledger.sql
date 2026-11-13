-- ============================================================================
-- Sohee V0.8.9 7차 수정: Canonical Agent Run Ledger & Schema Drift 단일화
-- Linear Issue: ANI-993 (#813)
--
-- 1. Unify Agent Run Ledger to public.conversation_jobs and public.conversation_job_steps
-- 2. Extend conversation_jobs with plan_data, goal, trace_id, model_snapshot
-- 3. Extend conversation_job_steps with step_index, capability_id, risk_tier, status, payloads
-- 4. Provide agent_runs and agent_run_steps compatibility views
-- 5. Expand messages with tool_calls, run_id, evidence_refs
-- ============================================================================

-- 1. Extend conversation_jobs
do $$
begin
  -- Relax background queue strict nullability
  alter table public.conversation_jobs alter column reservation_id drop not null;
  alter table public.conversation_jobs alter column assistant_message_id drop not null;
  alter table public.conversation_jobs alter column sequence_number set default 1;

  -- Add columns if not exist
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_jobs' and column_name = 'goal') then
    alter table public.conversation_jobs add column goal text default '';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_jobs' and column_name = 'plan_data') then
    alter table public.conversation_jobs add column plan_data jsonb not null default '{}'::jsonb;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_jobs' and column_name = 'trace_id') then
    alter table public.conversation_jobs add column trace_id text default '';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_jobs' and column_name = 'model_snapshot') then
    alter table public.conversation_jobs add column model_snapshot jsonb not null default '{}'::jsonb;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_jobs' and column_name = 'updated_at') then
    alter table public.conversation_jobs add column updated_at timestamptz not null default now();
  end if;

  -- Widen status check
  alter table public.conversation_jobs drop constraint if exists conversation_jobs_status_check;
  alter table public.conversation_jobs add constraint conversation_jobs_status_check check (
    status in (
      'queued', 'running', 'planning', 'executing', 'verifying', 'awaiting_approval',
      'succeeded', 'completed', 'needs_attention', 'failed', 'cancelled', 'partially_completed'
    )
  );

  -- Widen kind check
  alter table public.conversation_jobs drop constraint if exists conversation_jobs_kind_check;
  alter table public.conversation_jobs add constraint conversation_jobs_kind_check check (
    kind in (
      'chat', 'content_generation', 'image_generation', 'publish_preparation',
      'agent_turn', 'autonomous_action'
    )
  );

  -- Relax terminal time check
  alter table public.conversation_jobs drop constraint if exists conversation_jobs_terminal_time_check;
  alter table public.conversation_jobs add constraint conversation_jobs_terminal_time_check check (
    (status in ('queued', 'running', 'cancel_requested', 'planning', 'executing', 'verifying', 'awaiting_approval') and completed_at is null)
    or (status in ('succeeded', 'completed', 'needs_attention', 'failed', 'cancelled', 'partially_completed') and completed_at is not null)
  );
end $$;

-- 2. Extend conversation_job_steps
do $$
begin
  alter table public.conversation_job_steps alter column provider_call_key drop not null;
  alter table public.conversation_job_steps alter column operation drop not null;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'step_index') then
    alter table public.conversation_job_steps add column step_index integer not null default 1;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'capability_id') then
    alter table public.conversation_job_steps add column capability_id text default '';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'risk_tier') then
    alter table public.conversation_job_steps add column risk_tier text default 'LOW' check (risk_tier in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'status') then
    alter table public.conversation_job_steps add column status text default 'pending' check (status in ('pending', 'running', 'verifying', 'completed', 'failed', 'skipped'));
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'input_payload') then
    alter table public.conversation_job_steps add column input_payload jsonb not null default '{}'::jsonb;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'output_payload') then
    alter table public.conversation_job_steps add column output_payload jsonb not null default '{}'::jsonb;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'idempotency_key') then
    alter table public.conversation_job_steps add column idempotency_key text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'external_receipt_id') then
    alter table public.conversation_job_steps add column external_receipt_id uuid;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_job_steps' and column_name = 'error') then
    alter table public.conversation_job_steps add column error text;
  end if;

  -- Relax operation and state checks
  alter table public.conversation_job_steps drop constraint if exists conversation_job_steps_operation_check;
  alter table public.conversation_job_steps drop constraint if exists conversation_job_steps_state_check;
end $$;

-- 3. Expand messages table for root-level column compatibility
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'tool_calls') then
    alter table public.messages add column tool_calls jsonb not null default '[]'::jsonb;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'run_id') then
    alter table public.messages add column run_id uuid;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'evidence_refs') then
    alter table public.messages add column evidence_refs jsonb not null default '[]'::jsonb;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'content_parts') then
    alter table public.messages add column content_parts jsonb not null default '[]'::jsonb;
  end if;
end $$;

-- 4. Create compatibility views for agent_runs & agent_run_steps
do $$
begin
  if exists (
    select 1 from information_schema.tables 
    where table_schema = 'public' and table_name = 'agent_runs' and table_type = 'BASE TABLE'
  ) then
    drop table public.agent_runs cascade;
  end if;

  if exists (
    select 1 from information_schema.tables 
    where table_schema = 'public' and table_name = 'agent_run_steps' and table_type = 'BASE TABLE'
  ) then
    drop table public.agent_run_steps cascade;
  end if;
end $$;

create or replace view public.agent_runs as
  select
    id,
    workspace_id,
    thread_id,
    status,
    coalesce(goal, '') as goal,
    plan_data,
    coalesce(trace_id, '') as trace_id,
    model_snapshot,
    queued_at as created_at,
    updated_at,
    completed_at
  from public.conversation_jobs;

create or replace view public.agent_run_steps as
  select
    id,
    workspace_id,
    job_id as run_id,
    step_index,
    capability_id,
    risk_tier,
    status,
    input_payload,
    output_payload,
    idempotency_key,
    external_receipt_id,
    error,
    prepared_at as created_at,
    completed_at
  from public.conversation_job_steps;

-- 5. Permissions
grant select, insert, update on public.conversation_jobs to authenticated, service_role;
grant select, insert, update on public.conversation_job_steps to authenticated, service_role;
grant select on public.agent_runs to authenticated, service_role;
grant select on public.agent_run_steps to authenticated, service_role;
