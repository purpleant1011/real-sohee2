-- ============================================================================
-- Migration: 20261009080000_confirm_interview_fact_rpc.sql
-- 목적: 소희 인터뷰 답변 확정 시 knowledge_sources(인터뷰 소스), knowledge_candidates,
--       knowledge_facts, 이전 active fact supersede 처리를 단일 DB 트랜잭션 RPC로
--       원자적으로 수행하여 중간 실패로 인한 부분 영속화 정합성 문제를 원천 방지한다.
-- ============================================================================

create or replace function public.confirm_interview_fact(
  p_workspace_id uuid,
  p_user_id uuid,
  p_question_id text,
  p_category text,
  p_key text,
  p_raw_answer text,
  p_content text
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_candidate_id uuid;
  v_fact_id uuid;
  v_previous_fact_id uuid;
  v_trimmed_category text;
  v_trimmed_content text;
  v_trimmed_question_id text;
  v_category text;
  v_content text;
  v_source_location text;
  v_excerpt text;
  v_now timestamptz;
begin
  -- 1. 필수 인자 유효성 검사
  if p_workspace_id is null then
    raise exception 'invalid_argument: workspaceId is required' using errcode = '22023';
  end if;
  if p_user_id is null then
    raise exception 'invalid_argument: userId is required' using errcode = '22023';
  end if;

  v_trimmed_question_id := pg_catalog.btrim(p_question_id);
  if p_question_id is null or v_trimmed_question_id = '' then
    raise exception 'invalid_argument: questionId is required' using errcode = '22023';
  end if;

  v_trimmed_category := pg_catalog.btrim(p_category);
  if p_category is null or v_trimmed_category = '' then
    raise exception 'invalid_argument: category is required' using errcode = '22023';
  end if;

  v_trimmed_content := pg_catalog.btrim(p_content);
  if p_content is null or v_trimmed_content = '' then
    raise exception 'invalid_argument: content is required' using errcode = '22023';
  end if;

  -- 2. 길이 제한 강제 (category 120, content 12000, excerpt 2000)
  v_category := pg_catalog.left(v_trimmed_category, 120);
  v_content := pg_catalog.left(v_trimmed_content, 12000);
  v_source_location := 'interview:' || pg_catalog.left(v_trimmed_question_id, 990);
  if p_raw_answer is not null and pg_catalog.btrim(p_raw_answer) <> '' then
    v_excerpt := pg_catalog.left(pg_catalog.btrim(p_raw_answer), 2000);
  else
    v_excerpt := null;
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- 3. 인터뷰 소스(display_name '소희 인터뷰') 조회 또는 생성 (직렬화 락)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_workspace_id::text || ':interview')::bigint);

  select id
  into v_source_id
  from public.knowledge_sources
  where workspace_id = p_workspace_id
    and display_name = '소희 인터뷰'
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
    )
    values (
      p_workspace_id,
      '소희 인터뷰',
      'manual',
      'approved',
      p_user_id,
      v_now,
      v_now
    )
    returning id into v_source_id;
  end if;

  -- 4. 같은 질문(source_location 일치)의 기존 active fact 조회
  select kf.id
  into v_previous_fact_id
  from public.knowledge_facts kf
  join public.knowledge_candidates kc
    on kc.workspace_id = kf.workspace_id
   and kc.id = kf.source_candidate_id
  where kf.workspace_id = p_workspace_id
    and kf.status = 'active'
    and kc.source_location = v_source_location
  order by kf.created_at desc
  limit 1;

  -- 5. knowledge_candidates 생성 (승인 증거 및 인터뷰 질문 위치 기록)
  insert into public.knowledge_candidates (
    workspace_id,
    knowledge_source_id,
    category,
    content,
    source_excerpt,
    source_location,
    confidence,
    status,
    reviewed_by_user_id,
    reviewed_at,
    created_by_user_id,
    created_at,
    updated_at
  )
  values (
    p_workspace_id,
    v_source_id,
    v_category,
    v_content,
    v_excerpt,
    v_source_location,
    1.000,
    'approved',
    p_user_id,
    v_now,
    p_user_id,
    v_now,
    v_now
  )
  returning id into v_candidate_id;

  -- 6. knowledge_facts 생성 (active, 이전 사실 연결)
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
  )
  values (
    p_workspace_id,
    v_candidate_id,
    p_user_id,
    v_now,
    v_now,
    'active',
    v_category,
    v_content,
    v_previous_fact_id,
    v_now
  )
  returning id into v_fact_id;

  -- 7. 이전 active fact 상태를 'superseded'로 갱신
  if v_previous_fact_id is not null then
    update public.knowledge_facts
    set status = 'superseded'
    where workspace_id = p_workspace_id
      and id = v_previous_fact_id;
  end if;

  return v_fact_id;
end;
$$;

revoke execute on function public.confirm_interview_fact(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_interview_fact(uuid, uuid, text, text, text, text, text) to service_role;
