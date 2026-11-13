alter table public.conversation_threads
  drop constraint conversation_threads_kind_check;
alter table public.conversation_threads
  add constraint conversation_threads_kind_check check (
    kind in ('operations', 'work', 'customer_summary', 'onboarding')
  );

alter table public.operation_events
  drop constraint operation_events_event_type_check;
alter table public.operation_events
  add constraint operation_events_event_type_check check (
    event_type in (
      'content.plan.created', 'content.version.created', 'content.review.requested',
      'content.approved', 'content.approval.invalidated', 'schedule.suggested',
      'schedule.confirmed', 'publish.succeeded', 'publish.failed', 'publish.unknown',
      'report.snapshot.ready', 'customer.conversation.needs_attention',
      'knowledge.conflict.detected', 'harness.rule.candidate_created',
      'channel.response.created', 'channel.response.approved',
      'channel.response.sent', 'channel.response.failed',
      'channel.connection.connected', 'channel.connection.disconnected',
      'channel.connection.expired', 'channel.webhook.received',
      'publish.claimed', 'publish.lease_expired',
      'onboarding.started', 'onboarding.profile_reviewed', 'onboarding.completed'
    )
  );

create table public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null,
  knowledge_source_id uuid not null,
  status text not null default 'in_progress' check (
    status in ('in_progress', 'review_required', 'completed')
  ),
  active_step text not null default 'business_identity' check (
    active_step in (
      'business_identity', 'primary_offering', 'primary_audience',
      'marketing_goal', 'approval_policy', 'channel_presence',
      'summary', 'completed'
    )
  ),
  start_client_request_id uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_sessions_user_key unique (user_id),
  constraint onboarding_sessions_workspace_id_id_key unique (workspace_id, id),
  constraint onboarding_sessions_workspace_thread_key unique (workspace_id, thread_id),
  constraint onboarding_sessions_thread_fkey
    foreign key (workspace_id, thread_id)
    references public.conversation_threads (workspace_id, id)
    on delete restrict,
  constraint onboarding_sessions_knowledge_source_fkey
    foreign key (workspace_id, knowledge_source_id)
    references public.knowledge_sources (workspace_id, id)
    on delete restrict,
  constraint onboarding_sessions_completion_check check (
    (status = 'completed' and active_step = 'completed' and completed_at is not null)
    or (status <> 'completed' and active_step <> 'completed' and completed_at is null)
  )
);

create index onboarding_sessions_workspace_status_idx
  on public.onboarding_sessions (workspace_id, status, updated_at desc);

create table public.onboarding_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_key text not null check (
    profile_key in (
      'business_identity', 'primary_offering', 'primary_audience',
      'marketing_goal', 'approval_policy', 'channel_presence'
    )
  ),
  content text not null check (char_length(content) between 1 and 4000),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  constraint onboarding_answers_workspace_id_id_key unique (workspace_id, id),
  constraint onboarding_answers_session_request_key unique (session_id, client_request_id),
  constraint onboarding_answers_session_fkey
    foreign key (workspace_id, session_id)
    references public.onboarding_sessions (workspace_id, id)
    on delete cascade
);

create index onboarding_answers_session_created_idx
  on public.onboarding_answers (session_id, created_at, id);
create index onboarding_answers_user_workspace_idx
  on public.onboarding_answers (user_id, workspace_id, created_at desc);

create table public.workspace_profile_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  answer_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_key text not null check (
    profile_key in (
      'business_identity', 'primary_offering', 'primary_audience',
      'marketing_goal', 'approval_policy', 'channel_presence'
    )
  ),
  original_value text not null check (char_length(original_value) between 1 and 4000),
  proposed_value text not null check (char_length(proposed_value) between 1 and 4000),
  confirmed_value text check (
    confirmed_value is null or char_length(confirmed_value) between 1 and 4000
  ),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence_quote text not null check (char_length(evidence_quote) between 1 and 2000),
  source text not null check (source = 'onboarding_answer'),
  status text not null default 'review_required' check (
    status in ('review_required', 'active', 'rejected', 'superseded')
  ),
  review_decision text check (
    review_decision is null or review_decision in ('approved', 'revised', 'rejected')
  ),
  version integer not null default 0 check (version >= 0),
  reviewed_by_user_id uuid references auth.users (id),
  reviewed_at timestamptz,
  knowledge_candidate_id uuid,
  knowledge_fact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_profile_candidates_workspace_id_id_key unique (workspace_id, id),
  constraint workspace_profile_candidates_answer_key unique (answer_id),
  constraint workspace_profile_candidates_session_fkey
    foreign key (workspace_id, session_id)
    references public.onboarding_sessions (workspace_id, id)
    on delete cascade,
  constraint workspace_profile_candidates_answer_fkey
    foreign key (workspace_id, answer_id)
    references public.onboarding_answers (workspace_id, id)
    on delete cascade,
  constraint workspace_profile_candidates_knowledge_candidate_fkey
    foreign key (workspace_id, knowledge_candidate_id)
    references public.knowledge_candidates (workspace_id, id)
    on delete restrict,
  constraint workspace_profile_candidates_knowledge_fact_fkey
    foreign key (workspace_id, knowledge_fact_id)
    references public.knowledge_facts (workspace_id, id)
    on delete restrict,
  constraint workspace_profile_candidates_review_check check (
    (
      status = 'review_required'
      and confirmed_value is null
      and review_decision is null
      and reviewed_by_user_id is null
      and reviewed_at is null
      and knowledge_candidate_id is null
      and knowledge_fact_id is null
    )
    or (
      status = 'rejected'
      and confirmed_value is null
      and review_decision = 'rejected'
      and reviewed_by_user_id is not null
      and reviewed_at is not null
      and knowledge_candidate_id is null
      and knowledge_fact_id is null
    )
    or (
      status in ('active', 'superseded')
      and confirmed_value is not null
      and review_decision in ('approved', 'revised')
      and reviewed_by_user_id is not null
      and reviewed_at is not null
      and knowledge_candidate_id is not null
      and knowledge_fact_id is not null
    )
  )
);

create index workspace_profile_candidates_session_created_idx
  on public.workspace_profile_candidates (session_id, created_at, id);
create index workspace_profile_candidates_user_workspace_idx
  on public.workspace_profile_candidates (user_id, workspace_id, updated_at desc);
create index workspace_profile_candidates_knowledge_candidate_idx
  on public.workspace_profile_candidates (knowledge_candidate_id)
  where knowledge_candidate_id is not null;
create index workspace_profile_candidates_knowledge_fact_idx
  on public.workspace_profile_candidates (knowledge_fact_id)
  where knowledge_fact_id is not null;
create unique index workspace_profile_candidates_active_key_idx
  on public.workspace_profile_candidates (workspace_id, profile_key)
  where status = 'active';

create trigger onboarding_sessions_set_updated_at
before update on public.onboarding_sessions
for each row execute function private.set_updated_at();

create trigger workspace_profile_candidates_set_updated_at
before update on public.workspace_profile_candidates
for each row execute function private.set_updated_at();

alter table public.onboarding_sessions enable row level security;
alter table public.onboarding_answers enable row level security;
alter table public.workspace_profile_candidates enable row level security;

create policy "users can read their onboarding session"
on public.onboarding_sessions for select to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);

create policy "users can read their onboarding answers"
on public.onboarding_answers for select to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);

create policy "users can read their profile candidates"
on public.workspace_profile_candidates for select to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);

revoke all on public.onboarding_sessions from public, anon, authenticated;
revoke all on public.onboarding_answers from public, anon, authenticated;
revoke all on public.workspace_profile_candidates from public, anon, authenticated;
grant select on public.onboarding_sessions to authenticated;
grant select on public.onboarding_answers to authenticated;
grant select on public.workspace_profile_candidates to authenticated;
grant select, insert, update, delete on public.onboarding_sessions to service_role;
grant select, insert, update, delete on public.onboarding_answers to service_role;
grant select, insert, update, delete on public.workspace_profile_candidates to service_role;

create or replace function private.start_v08_onboarding_internal(
  p_client_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  session_record public.onboarding_sessions%rowtype;
  selected_workspace_id uuid;
  created_thread_id uuid;
  created_source_id uuid;
  approved_keys jsonb;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'INVALID_ONBOARDING_START' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text, 808001::bigint)
  );

  select session.*
  into session_record
  from public.onboarding_sessions as session
  where session.user_id = actor_id;

  if session_record.id is null then
    select member.workspace_id
    into selected_workspace_id
    from public.workspace_members as member
    where member.user_id = actor_id
      and member.status = 'active'
      and member.role in ('owner', 'manager')
    order by member.created_at, member.workspace_id
    limit 1;

    if selected_workspace_id is null then
      insert into public.workspaces (name, timezone, created_by)
      values ('소희 준비 작업공간', 'Asia/Seoul', actor_id)
      returning id into selected_workspace_id;
    end if;

    insert into public.conversation_threads (workspace_id, kind, title, status)
    values (selected_workspace_id, 'onboarding', '소희와 첫 준비 대화', 'active')
    returning id into created_thread_id;

    insert into public.knowledge_sources (
      workspace_id, source_type, provider_mode, display_name, status,
      created_by_user_id
    ) values (
      selected_workspace_id, 'manual', 'registered_only',
      '가입 대화에서 확정한 사업 정보', 'approved', actor_id
    ) returning id into created_source_id;

    insert into public.onboarding_sessions (
      user_id, workspace_id, thread_id, knowledge_source_id,
      status, active_step, start_client_request_id
    ) values (
      actor_id, selected_workspace_id, created_thread_id, created_source_id,
      'in_progress', 'business_identity', p_client_request_id
    ) returning * into session_record;

    insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload
    ) values (
      session_record.workspace_id,
      'onboarding.started',
      'onboarding:start:' || session_record.id::text,
      'onboarding_session',
      session_record.id,
      pg_catalog.jsonb_build_object('sessionId', session_record.id)
    ) on conflict (workspace_id, event_key) do nothing;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(candidate.profile_key order by pg_catalog.array_position(
      array[
        'business_identity', 'primary_offering', 'primary_audience',
        'marketing_goal', 'approval_policy', 'channel_presence'
      ]::text[],
      candidate.profile_key
    )),
    '[]'::jsonb
  )
  into approved_keys
  from public.workspace_profile_candidates as candidate
  where candidate.workspace_id = session_record.workspace_id
    and candidate.status = 'active';

  return pg_catalog.jsonb_build_object(
    'sessionId', session_record.id,
    'workspaceId', session_record.workspace_id,
    'threadId', session_record.thread_id,
    'status', session_record.status,
    'activeStep', session_record.active_step,
    'approvedProfileKeys', approved_keys
  );
end;
$$;

create or replace function public.start_v08_onboarding(
  p_client_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.start_v08_onboarding_internal(p_client_request_id);
$$;

create or replace function private.save_v08_onboarding_answer_internal(
  p_workspace_id uuid,
  p_session_id uuid,
  p_step text,
  p_content text,
  p_client_request_id uuid,
  p_candidate jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_content text := pg_catalog.btrim(p_content);
  session_record public.onboarding_sessions%rowtype;
  answer_record public.onboarding_answers%rowtype;
  candidate_record public.workspace_profile_candidates%rowtype;
  proposed_value text;
  evidence_value text;
  confidence_value numeric;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not (select private.is_workspace_member(p_workspace_id)) then
    raise exception 'WORKSPACE_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;
  if p_step is null or p_step <> all (array[
    'business_identity', 'primary_offering', 'primary_audience',
    'marketing_goal', 'approval_policy', 'channel_presence'
  ]::text[]) then
    raise exception 'INVALID_ONBOARDING_STEP' using errcode = '22023';
  end if;
  if normalized_content is null
    or pg_catalog.char_length(normalized_content) not between 1 and 4000
    or p_client_request_id is null
    or p_candidate is null
    or pg_catalog.jsonb_typeof(p_candidate) <> 'object'
  then
    raise exception 'INVALID_ONBOARDING_ANSWER' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_session_id::text, 808002::bigint)
  );

  select session.*
  into session_record
  from public.onboarding_sessions as session
  where session.id = p_session_id
    and session.workspace_id = p_workspace_id
    and session.user_id = actor_id
  for update;

  if session_record.id is null then
    raise exception 'ONBOARDING_SESSION_NOT_FOUND' using errcode = '22023';
  end if;
  if session_record.status = 'completed' then
    raise exception 'ONBOARDING_ALREADY_COMPLETED' using errcode = '22023';
  end if;
  if session_record.active_step is distinct from p_step then
    raise exception 'ONBOARDING_STEP_MISMATCH' using errcode = '22023';
  end if;

  select answer.*
  into answer_record
  from public.onboarding_answers as answer
  where answer.session_id = p_session_id
    and answer.client_request_id = p_client_request_id;

  if answer_record.id is null then
    insert into public.onboarding_answers (
      session_id, workspace_id, user_id, profile_key, content, client_request_id
    ) values (
      p_session_id, p_workspace_id, actor_id, p_step, normalized_content,
      p_client_request_id
    ) returning * into answer_record;
  elsif answer_record.profile_key is distinct from p_step
    or answer_record.content is distinct from normalized_content
  then
    raise exception 'ONBOARDING_IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;

  if p_candidate <> '{}'::jsonb then
    if (select count(*) from pg_catalog.jsonb_object_keys(p_candidate)) <> 5
      or not (p_candidate ?& array['key', 'value', 'confidence', 'evidenceQuote', 'source'])
      or p_candidate->>'key' is distinct from p_step
      or p_candidate->>'source' is distinct from 'onboarding_answer'
      or pg_catalog.jsonb_typeof(p_candidate->'confidence') <> 'number'
    then
      raise exception 'INVALID_PROFILE_CANDIDATE' using errcode = '22023';
    end if;

    proposed_value := pg_catalog.btrim(p_candidate->>'value');
    evidence_value := pg_catalog.btrim(p_candidate->>'evidenceQuote');
    confidence_value := (p_candidate->>'confidence')::numeric;
    if proposed_value is null
      or pg_catalog.char_length(proposed_value) not between 1 and 4000
      or evidence_value is null
      or pg_catalog.char_length(evidence_value) not between 1 and 2000
      or confidence_value not between 0 and 1
    then
      raise exception 'INVALID_PROFILE_CANDIDATE' using errcode = '22023';
    end if;

    select candidate.*
    into candidate_record
    from public.workspace_profile_candidates as candidate
    where candidate.answer_id = answer_record.id;

    if candidate_record.id is null then
      insert into public.workspace_profile_candidates (
        session_id, answer_id, workspace_id, user_id, profile_key,
        original_value, proposed_value, confidence, evidence_quote, source
      ) values (
        p_session_id, answer_record.id, p_workspace_id, actor_id, p_step,
        answer_record.content, proposed_value, confidence_value,
        evidence_value, 'onboarding_answer'
      ) returning * into candidate_record;
    elsif candidate_record.profile_key is distinct from p_step
      or candidate_record.proposed_value is distinct from proposed_value
      or candidate_record.confidence is distinct from confidence_value
      or candidate_record.evidence_quote is distinct from evidence_value
    then
      raise exception 'ONBOARDING_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;

    update public.onboarding_sessions
    set status = 'review_required'
    where id = session_record.id
    returning * into session_record;
  end if;

  return pg_catalog.jsonb_build_object(
    'sessionId', session_record.id,
    'workspaceId', session_record.workspace_id,
    'answerId', answer_record.id,
    'candidateId', candidate_record.id,
    'status', session_record.status,
    'activeStep', session_record.active_step
  );
end;
$$;

create or replace function public.save_v08_onboarding_answer(
  p_workspace_id uuid,
  p_session_id uuid,
  p_step text,
  p_content text,
  p_client_request_id uuid,
  p_candidate jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.save_v08_onboarding_answer_internal(
    p_workspace_id,
    p_session_id,
    p_step,
    p_content,
    p_client_request_id,
    p_candidate
  );
$$;

create or replace function private.review_v08_profile_candidate_internal(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_confirmed_value text,
  p_expected_version integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_value text := pg_catalog.btrim(p_confirmed_value);
  candidate_record public.workspace_profile_candidates%rowtype;
  session_record public.onboarding_sessions%rowtype;
  prior_fact_id uuid;
  created_knowledge_candidate_id uuid;
  created_knowledge_fact_id uuid;
  active_key_count integer;
  next_step text;
  next_version integer;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception 'WORKSPACE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_decision is null
    or p_decision <> all (array['approved', 'revised', 'rejected']::text[])
    or normalized_value is null
    or pg_catalog.char_length(normalized_value) not between 1 and 4000
    or p_expected_version is null
    or p_expected_version < 0
  then
    raise exception 'INVALID_PROFILE_REVIEW' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_candidate_id::text, 808003::bigint)
  );

  select candidate.*
  into candidate_record
  from public.workspace_profile_candidates as candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_candidate_id
  for update;

  if candidate_record.id is null then
    raise exception 'PROFILE_CANDIDATE_NOT_FOUND' using errcode = '22023';
  end if;
  if candidate_record.version is distinct from p_expected_version
    or candidate_record.status <> 'review_required'
  then
    raise exception 'STALE_PROFILE_CANDIDATE' using errcode = '40001';
  end if;

  select session.*
  into session_record
  from public.onboarding_sessions as session
  where session.workspace_id = p_workspace_id
    and session.id = candidate_record.session_id
    and session.user_id = actor_id
  for update;

  if session_record.id is null then
    raise exception 'ONBOARDING_SESSION_NOT_FOUND' using errcode = '22023';
  end if;

  next_version := candidate_record.version + 1;

  if p_decision = 'rejected' then
    update public.workspace_profile_candidates
    set
      status = 'rejected',
      review_decision = 'rejected',
      reviewed_by_user_id = actor_id,
      reviewed_at = statement_timestamp(),
      version = next_version
    where id = candidate_record.id;

    update public.onboarding_sessions
    set status = 'in_progress', active_step = candidate_record.profile_key
    where id = session_record.id
    returning * into session_record;
  else
    select fact.id
    into prior_fact_id
    from public.knowledge_facts as fact
    where fact.workspace_id = p_workspace_id
      and fact.category = candidate_record.profile_key
      and fact.status = 'active'
    order by fact.approved_at desc, fact.id
    limit 1
    for update;

    update public.workspace_profile_candidates
    set status = 'superseded'
    where workspace_id = p_workspace_id
      and profile_key = candidate_record.profile_key
      and status = 'active'
      and id <> candidate_record.id;

    update public.knowledge_facts
    set status = 'superseded', valid_until = statement_timestamp()
    where workspace_id = p_workspace_id
      and category = candidate_record.profile_key
      and status = 'active';

    insert into public.knowledge_candidates (
      workspace_id, knowledge_source_id, category, content,
      source_excerpt, confidence, status, version,
      reviewed_by_user_id, reviewed_at, created_by_user_id
    ) values (
      p_workspace_id,
      session_record.knowledge_source_id,
      candidate_record.profile_key,
      normalized_value,
      candidate_record.original_value,
      candidate_record.confidence,
      'approved',
      next_version,
      actor_id,
      statement_timestamp(),
      actor_id
    ) returning id into created_knowledge_candidate_id;

    insert into public.knowledge_facts (
      workspace_id, category, content, status, source_candidate_id,
      approved_by_user_id, approved_at, supersedes_fact_id
    ) values (
      p_workspace_id,
      candidate_record.profile_key,
      normalized_value,
      'active',
      created_knowledge_candidate_id,
      actor_id,
      statement_timestamp(),
      prior_fact_id
    ) returning id into created_knowledge_fact_id;

    update public.workspace_profile_candidates
    set
      status = 'active',
      confirmed_value = normalized_value,
      review_decision = p_decision,
      reviewed_by_user_id = actor_id,
      reviewed_at = statement_timestamp(),
      knowledge_candidate_id = created_knowledge_candidate_id,
      knowledge_fact_id = created_knowledge_fact_id,
      version = next_version
    where id = candidate_record.id;

    select count(*)::integer
    into active_key_count
    from public.workspace_profile_candidates as active_candidate
    where active_candidate.workspace_id = p_workspace_id
      and active_candidate.status = 'active'
      and active_candidate.profile_key = any (array[
        'business_identity', 'primary_offering', 'primary_audience',
        'marketing_goal', 'approval_policy', 'channel_presence'
      ]::text[]);

    if active_key_count = 6 then
      update public.onboarding_sessions
      set
        status = 'completed',
        active_step = 'completed',
        completed_at = statement_timestamp()
      where id = session_record.id
      returning * into session_record;
    else
      select required_key
      into next_step
      from unnest(array[
        'business_identity', 'primary_offering', 'primary_audience',
        'marketing_goal', 'approval_policy', 'channel_presence'
      ]::text[]) with ordinality as required(required_key, position)
      where not exists (
        select 1
        from public.workspace_profile_candidates as active_candidate
        where active_candidate.workspace_id = p_workspace_id
          and active_candidate.profile_key = required.required_key
          and active_candidate.status = 'active'
      )
      order by position
      limit 1;

      update public.onboarding_sessions
      set status = 'in_progress', active_step = next_step
      where id = session_record.id
      returning * into session_record;
    end if;
  end if;

  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload
  ) values (
    p_workspace_id,
    'onboarding.profile_reviewed',
    'onboarding:review:' || candidate_record.id::text || ':v' || next_version::text,
    'workspace_profile_candidate',
    candidate_record.id,
    pg_catalog.jsonb_build_object(
      'profileKey', candidate_record.profile_key,
      'decision', p_decision,
      'version', next_version
    )
  ) on conflict (workspace_id, event_key) do nothing;

  if session_record.status = 'completed' then
    insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload
    ) values (
      p_workspace_id,
      'onboarding.completed',
      'onboarding:complete:' || session_record.id::text,
      'onboarding_session',
      session_record.id,
      pg_catalog.jsonb_build_object('approvedProfileCount', 6)
    ) on conflict (workspace_id, event_key) do nothing;
  end if;

  return pg_catalog.jsonb_build_object(
    'sessionId', session_record.id,
    'workspaceId', session_record.workspace_id,
    'candidateId', candidate_record.id,
    'candidateStatus', case when p_decision = 'rejected' then 'rejected' else 'active' end,
    'version', next_version,
    'status', session_record.status,
    'activeStep', session_record.active_step
  );
end;
$$;

create or replace function public.review_v08_profile_candidate(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_confirmed_value text,
  p_expected_version integer
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.review_v08_profile_candidate_internal(
    p_workspace_id,
    p_candidate_id,
    p_decision,
    p_confirmed_value,
    p_expected_version
  );
$$;

revoke execute on function private.start_v08_onboarding_internal(uuid)
from public, anon;
revoke execute on function private.save_v08_onboarding_answer_internal(
  uuid, uuid, text, text, uuid, jsonb
) from public, anon;
revoke execute on function private.review_v08_profile_candidate_internal(
  uuid, uuid, text, text, integer
) from public, anon;
grant execute on function private.start_v08_onboarding_internal(uuid)
to authenticated;
grant execute on function private.save_v08_onboarding_answer_internal(
  uuid, uuid, text, text, uuid, jsonb
) to authenticated;
grant execute on function private.review_v08_profile_candidate_internal(
  uuid, uuid, text, text, integer
) to authenticated;

revoke all on function public.start_v08_onboarding(uuid) from public, anon;
revoke all on function public.save_v08_onboarding_answer(
  uuid, uuid, text, text, uuid, jsonb
) from public, anon;
revoke all on function public.review_v08_profile_candidate(
  uuid, uuid, text, text, integer
) from public, anon;
grant execute on function public.start_v08_onboarding(uuid) to authenticated;
grant execute on function public.save_v08_onboarding_answer(
  uuid, uuid, text, text, uuid, jsonb
) to authenticated;
grant execute on function public.review_v08_profile_candidate(
  uuid, uuid, text, text, integer
) to authenticated;

notify pgrst, 'reload schema';
