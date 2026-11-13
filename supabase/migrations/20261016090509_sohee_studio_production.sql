-- ============================================================================
-- Migration: 20261016090509_sohee_studio_production.sql
-- Purpose: Sohee Studio Production schema (proposals, goals, curiosity decisions,
--          thread kind extension, RLS, and atomic proposal decision RPC).
-- ============================================================================

-- 1. Extend conversation_threads.kind CHECK constraint to include 'studio'
alter table public.conversation_threads
  drop constraint if exists conversation_threads_kind_check;

alter table public.conversation_threads
  add constraint conversation_threads_kind_check
  check (kind in ('operations', 'work', 'customer_summary', 'onboarding', 'studio'));

-- 2. Partial unique index for single active studio thread per workspace
create unique index if not exists conversation_threads_workspace_active_studio_idx
  on public.conversation_threads (workspace_id)
  where kind = 'studio' and status = 'active';

-- 2-1. Single assistant response per user message in studio turns (scoped by usage_metadata marker)
create unique index if not exists messages_workspace_thread_studio_sohee_reply_idx
  on public.messages (workspace_id, thread_id, reply_to_message_id)
  where role = 'sohee'
    and reply_to_message_id is not null
    and (usage_metadata->>'soheeStudioTurn') = 'true';

-- 3. public.sohee_studio_proposals table
create table public.sohee_studio_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_message_id uuid not null,
  kind text not null check (kind in ('fact', 'goal')),
  category text not null check (char_length(category) between 1 and 200 and (kind = 'goal' or char_length(category) <= 120)),
  content text not null check (char_length(content) between 1 and 12000),
  replaces_fact_id uuid,
  expected_fact_created_at timestamptz,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'rejected')),
  confirmed_target_id uuid,
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 1 and 120),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sohee_studio_proposals_workspace_id_id_key unique (workspace_id, id),
  constraint sohee_studio_proposals_source_message_fkey
    foreign key (workspace_id, source_message_id)
    references public.messages (workspace_id, id)
    on delete cascade,
  constraint sohee_studio_proposals_replaces_fact_fkey
    foreign key (workspace_id, replaces_fact_id)
    references public.knowledge_facts (workspace_id, id)
    on delete set null
);

create unique index sohee_studio_proposals_workspace_idempotency_idx
  on public.sohee_studio_proposals (workspace_id, idempotency_key)
  where idempotency_key is not null;

create index sohee_studio_proposals_workspace_status_idx
  on public.sohee_studio_proposals (workspace_id, status, created_at desc);

create index sohee_studio_proposals_source_message_idx
  on public.sohee_studio_proposals (workspace_id, source_message_id);

-- 4. public.sohee_goals table
create table public.sohee_goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  desired_outcome text not null check (char_length(desired_outcome) between 1 and 4000),
  metric jsonb check (metric is null or jsonb_typeof(metric) = 'object'),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'achieved', 'retired')),
  due_at timestamptz,
  source_message_id uuid,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sohee_goals_workspace_id_id_key unique (workspace_id, id),
  constraint sohee_goals_source_message_fkey
    foreign key (workspace_id, source_message_id)
    references public.messages (workspace_id, id)
    on delete set null
);

create index sohee_goals_workspace_status_idx
  on public.sohee_goals (workspace_id, status, created_at desc);

-- 5. public.sohee_curiosity_decisions table
create table public.sohee_curiosity_decisions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  question_key text not null check (char_length(question_key) between 1 and 200),
  status text not null check (status in ('snoozed', 'not_applicable')),
  updated_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sohee_curiosity_decisions_pkey primary key (workspace_id, question_key)
);

create index sohee_curiosity_decisions_workspace_status_idx
  on public.sohee_curiosity_decisions (workspace_id, status, updated_at desc);

-- 6. Row Level Security & Explicit Grants
alter table public.sohee_studio_proposals enable row level security;
revoke all on table public.sohee_studio_proposals from public, anon, authenticated;
grant all on table public.sohee_studio_proposals to service_role;

alter table public.sohee_goals enable row level security;
revoke all on table public.sohee_goals from public, anon, authenticated;
grant all on table public.sohee_goals to service_role;

alter table public.sohee_curiosity_decisions enable row level security;
revoke all on table public.sohee_curiosity_decisions from public, anon, authenticated;
grant all on table public.sohee_curiosity_decisions to service_role;

-- 7. DB RPC for atomic proposal decisions
create or replace function public.decide_studio_proposal(
  p_workspace_id uuid,
  p_proposal_id uuid,
  p_decision text,
  p_user_id uuid,
  p_revised_content text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_proposal record;
  v_existing_fact record;
  v_source_id uuid;
  v_candidate_id uuid;
  v_target_id uuid;
  v_effective_content text;
  v_now timestamptz;
begin
  -- 1. 필수 인자 유효성 검사
  if p_workspace_id is null then
    raise exception 'invalid_argument: workspaceId is required' using errcode = '22023';
  end if;
  if p_proposal_id is null then
    raise exception 'invalid_argument: proposalId is required' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('confirm', 'reject') then
    raise exception 'invalid_argument: decision must be confirm or reject' using errcode = '22023';
  end if;
  if p_user_id is null then
    raise exception 'invalid_argument: userId is required' using errcode = '22023';
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- 2. 제안 행 잠금 및 존재 확인
  select *
  into v_proposal
  from public.sohee_studio_proposals
  where workspace_id = p_workspace_id
    and id = p_proposal_id
  for update;

  if v_proposal.id is null then
    raise exception 'proposal_not_found: Proposal % does not exist in workspace %', p_proposal_id, p_workspace_id using errcode = 'P0002';
  end if;

  -- 3. 멱등성 검사 (이미 처리된 제안인 경우)
  if v_proposal.status = 'confirmed' then
    if p_decision = 'confirm' then
      -- 확정된 내용과 다른 내용으로 재확정 시도 시 충돌 오류
      if p_revised_content is not null
         and pg_catalog.btrim(p_revised_content) <> ''
         and pg_catalog.left(pg_catalog.btrim(p_revised_content), 12000) <> v_proposal.content then
        raise exception 'conflict: proposal is already confirmed with different content (STUDIO_PROPOSAL_CONFLICT)' using errcode = '23505';
      end if;

      return pg_catalog.jsonb_build_object(
        'success', true,
        'id', v_proposal.id,
        'status', v_proposal.status,
        'confirmed_target_id', v_proposal.confirmed_target_id,
        'kind', v_proposal.kind,
        'idempotent', true
      );
    else
      raise exception 'conflict: proposal is already confirmed' using errcode = '23505';
    end if;
  end if;

  if v_proposal.status = 'rejected' then
    if p_decision = 'reject' then
      return pg_catalog.jsonb_build_object(
        'success', true,
        'id', v_proposal.id,
        'status', v_proposal.status,
        'confirmed_target_id', null,
        'kind', v_proposal.kind,
        'idempotent', true
      );
    else
      raise exception 'conflict: proposal is already rejected' using errcode = '23505';
    end if;
  end if;

  -- 4. 거절 처리 (멱등)
  if p_decision = 'reject' then
    update public.sohee_studio_proposals
    set status = 'rejected',
        updated_at = v_now
    where id = v_proposal.id;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'id', v_proposal.id,
      'status', 'rejected',
      'confirmed_target_id', null,
      'kind', v_proposal.kind,
      'idempotent', false
    );
  end if;

  -- 5. 확정 처리 (confirm)
  if p_revised_content is not null and pg_catalog.btrim(p_revised_content) <> '' then
    v_effective_content := pg_catalog.left(pg_catalog.btrim(p_revised_content), 12000);
  else
    v_effective_content := v_proposal.content;
  end if;

  if v_proposal.kind = 'fact' then
    -- 대체 대상 사실이 지정된 경우 검증 및 잠금
    if v_proposal.replaces_fact_id is not null then
      select *
      into v_existing_fact
      from public.knowledge_facts
      where workspace_id = p_workspace_id
        and id = v_proposal.replaces_fact_id
      for update;

      if v_existing_fact.id is null then
        raise exception 'fact_not_found: Fact to replace % not found in workspace', v_proposal.replaces_fact_id using errcode = 'P0002';
      end if;

      if v_existing_fact.status <> 'active' then
        raise exception 'conflict: fact to replace is not active (current status: %)', v_existing_fact.status using errcode = '40001';
      end if;

      if v_proposal.expected_fact_created_at is not null and v_existing_fact.created_at <> v_proposal.expected_fact_created_at then
        raise exception 'conflict: fact has been modified concurrently' using errcode = '40001';
      end if;
    end if;

    -- 소스 확인 및 생성 (워크스페이스 직렬화 락)
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_workspace_id::text || ':studio')::bigint);

    select id
    into v_source_id
    from public.knowledge_sources
    where workspace_id = p_workspace_id
      and display_name = '소희 스튜디오'
    limit 1;

    if v_source_id is null then
      insert into public.knowledge_sources (
        workspace_id,
        display_name,
        source_type,
        status,
        created_by_user_id,
        created_at,
        updated_at
      ) values (
        p_workspace_id,
        '소희 스튜디오',
        'manual',
        'approved',
        p_user_id,
        v_now,
        v_now
      ) returning id into v_source_id;
    end if;

    -- 후보 생성
    insert into public.knowledge_candidates (
      workspace_id,
      knowledge_source_id,
      category,
      content,
      source_location,
      confidence,
      status,
      reviewed_by_user_id,
      reviewed_at,
      created_by_user_id,
      created_at,
      updated_at
    ) values (
      p_workspace_id,
      v_source_id,
      v_proposal.category,
      v_effective_content,
      'studio:proposal:' || v_proposal.id::text,
      1.000,
      'approved',
      p_user_id,
      v_now,
      p_user_id,
      v_now,
      v_now
    ) returning id into v_candidate_id;

    -- 팩트 생성
    insert into public.knowledge_facts (
      workspace_id,
      source_candidate_id,
      approved_by_user_id,
      approved_at,
      valid_from,
      status,
      category,
      content,
      supersedes_fact_id,
      created_at
    ) values (
      p_workspace_id,
      v_candidate_id,
      p_user_id,
      v_now,
      v_now,
      'active',
      v_proposal.category,
      v_effective_content,
      v_proposal.replaces_fact_id,
      v_now
    ) returning id into v_target_id;

    -- 이전 active fact supersede 처리
    if v_proposal.replaces_fact_id is not null then
      update public.knowledge_facts
      set status = 'superseded'
      where workspace_id = p_workspace_id
        and id = v_proposal.replaces_fact_id;
    end if;

  elsif v_proposal.kind = 'goal' then
    -- 목표 생성
    insert into public.sohee_goals (
      workspace_id,
      title,
      desired_outcome,
      priority,
      status,
      source_message_id,
      created_by,
      updated_by,
      created_at,
      updated_at
    ) values (
      p_workspace_id,
      v_proposal.category,
      v_effective_content,
      'normal',
      'active',
      v_proposal.source_message_id,
      p_user_id,
      p_user_id,
      v_now,
      v_now
    ) returning id into v_target_id;

  else
    raise exception 'invalid_state: unsupported proposal kind %', v_proposal.kind using errcode = '22023';
  end if;

  -- 제안 확정 갱신
  update public.sohee_studio_proposals
  set status = 'confirmed',
      confirmed_target_id = v_target_id,
      content = v_effective_content,
      updated_at = v_now
  where id = v_proposal.id;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'id', v_proposal.id,
    'status', 'confirmed',
    'confirmed_target_id', v_target_id,
    'kind', v_proposal.kind,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.decide_studio_proposal(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_studio_proposal(uuid, uuid, text, uuid, text) to service_role;

-- 8. DB RPC for atomic turn finalization (assistant completion + proposals insert)
create or replace function public.finalize_studio_turn(
  p_workspace_id uuid,
  p_thread_id uuid,
  p_assistant_message_id uuid,
  p_content text,
  p_status text,
  p_usage_metadata jsonb default '{}'::jsonb,
  p_proposals jsonb default '[]'::jsonb,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_reply_to_id uuid;
  v_updated_msg record;
  v_item jsonb;
  v_inserted_proposals jsonb := '[]'::jsonb;
  v_new_prop_id uuid;
  v_user_id uuid;
begin
  if p_workspace_id is null then
    raise exception 'invalid_argument: workspaceId is required' using errcode = '22023';
  end if;
  if p_thread_id is null then
    raise exception 'invalid_argument: threadId is required' using errcode = '22023';
  end if;
  if p_assistant_message_id is null then
    raise exception 'invalid_argument: assistantMessageId is required' using errcode = '22023';
  end if;
  if p_content is null or pg_catalog.btrim(p_content) = '' then
    raise exception 'invalid_argument: content is required' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('completed', 'failed', 'cancelled') then
    raise exception 'invalid_argument: invalid status %', p_status using errcode = '22023';
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- 1. 어시스턴트 메시지 잠금 및 갱신
  select reply_to_message_id, created_by_user_id
  into v_reply_to_id, v_user_id
  from public.messages
  where workspace_id = p_workspace_id
    and id = p_assistant_message_id
  for update;

  if not found then
    raise exception 'message_not_found: assistant message % not found', p_assistant_message_id using errcode = 'P0002';
  end if;

  v_user_id := coalesce(p_user_id, v_user_id);

  update public.messages
  set content = pg_catalog.left(pg_catalog.btrim(p_content), 20000),
      status = p_status,
      usage_metadata = coalesce(p_usage_metadata, '{}'::jsonb) || '{"soheeStudioTurn":"true"}'::jsonb,
      completed_at = case when p_status = 'completed' then v_now else null end
  where workspace_id = p_workspace_id
    and id = p_assistant_message_id
  returning * into v_updated_msg;

  -- 2. 제안 목록 원자적 저장
  if p_proposals is not null and pg_catalog.jsonb_array_length(p_proposals) > 0 then
    for v_item in select * from pg_catalog.jsonb_array_elements(p_proposals)
    loop
      insert into public.sohee_studio_proposals (
        workspace_id,
        source_message_id,
        kind,
        category,
        content,
        replaces_fact_id,
        expected_fact_created_at,
        status,
        idempotency_key,
        created_by,
        created_at,
        updated_at
      ) values (
        p_workspace_id,
        coalesce(v_reply_to_id, p_assistant_message_id),
        v_item->>'kind',
        case when v_item->>'kind' = 'goal' then pg_catalog.left(v_item->>'category', 200) else pg_catalog.left(v_item->>'category', 120) end,
        pg_catalog.left(v_item->>'content', 12000),
        case when (v_item->>'replacesFactId') is not null and (v_item->>'replacesFactId') <> '' then (v_item->>'replacesFactId')::uuid else null end,
        case when (v_item->>'expectedFactCreatedAt') is not null and (v_item->>'expectedFactCreatedAt') <> '' then (v_item->>'expectedFactCreatedAt')::timestamptz else null end,
        'proposed',
        nullif(v_item->>'idempotencyKey', ''),
        v_user_id,
        v_now,
        v_now
      )
      returning id into v_new_prop_id;

      v_inserted_proposals := v_inserted_proposals || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id', v_new_prop_id,
          'workspace_id', p_workspace_id,
          'source_message_id', coalesce(v_reply_to_id, p_assistant_message_id),
          'kind', v_item->>'kind',
          'category', v_item->>'category',
          'content', v_item->>'content',
          'replaces_fact_id', v_item->>'replacesFactId',
          'status', 'proposed',
          'created_at', v_now
        )
      );
    end loop;
  end if;

  -- 3. thread last_message_at 업데이트
  update public.conversation_threads
  set last_message_at = v_now,
      updated_at = v_now
  where workspace_id = p_workspace_id
    and id = p_thread_id;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'assistant_message', pg_catalog.to_jsonb(v_updated_msg),
    'proposals', v_inserted_proposals
  );
end;
$$;

revoke execute on function public.finalize_studio_turn(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.finalize_studio_turn(uuid, uuid, uuid, text, text, jsonb, jsonb, uuid) to service_role;
