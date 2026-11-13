-- ============================================================================
-- Test: 56_sohee_studio_production.test.sql
-- Purpose: Verify sohee studio tables, RLS, composite FKs, atomic RPC logic,
--          concurrency conflict rollback, and idempotent decisions.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table studio_assertions (name text primary key, passed boolean not null);

-- 1. Tables exist with RLS enabled
insert into studio_assertions values
('three studio tables with RLS', (
  select count(*) = 3 from pg_class
  where relnamespace = 'public'::regnamespace and relname in
    ('sohee_studio_proposals', 'sohee_goals', 'sohee_curiosity_decisions')
    and relrowsecurity
)),
('no public write grants', (
  select count(*) = 0 from information_schema.role_table_grants
  where table_schema = 'public' and table_name in
    ('sohee_studio_proposals', 'sohee_goals', 'sohee_curiosity_decisions')
    and grantee in ('anon', 'authenticated', 'PUBLIC')
    and privilege_type in ('INSERT','UPDATE','DELETE')
)),
('active studio thread unique index exists', (
  select count(*) = 1 from pg_indexes
  where schemaname = 'public'
    and tablename = 'conversation_threads'
    and indexname = 'conversation_threads_workspace_active_studio_idx'
));

do $$ begin
 if (select not bool_and(passed) from studio_assertions) then
   raise exception 'studio assertions failed: %', (select string_agg(name, ', ') from studio_assertions where not passed);
 end if;
end $$;

-- 2. Setup fixtures
insert into auth.users(id, email) values
 ('e1111111-1111-4111-8111-111111111111', 'studio-user-a@test.invalid'),
 ('e2222222-2222-4222-8222-222222222222', 'studio-user-b@test.invalid');

insert into public.workspaces(id, name, created_by) values
 ('a1111111-1111-4111-8111-111111111111', 'Studio WS A', 'e1111111-1111-4111-8111-111111111111'),
 ('a2222222-2222-4222-8222-222222222222', 'Studio WS B', 'e2222222-2222-4222-8222-222222222222');

insert into public.conversation_threads(id, workspace_id, kind, title, status) values
 ('d1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'studio', '소희 스튜디오', 'active'),
 ('d0000000-0000-4000-8000-000000000003', 'a1111111-1111-4111-8111-111111111111', 'onboarding', '신규 온보딩 대화', 'active');

insert into public.messages(id, workspace_id, thread_id, role, content, status, created_by_user_id) values
 ('c1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 'user', '영업시간은 10시부터 20시까지입니다.', 'completed', 'e1111111-1111-4111-8111-111111111111');

-- 3. Negative query test function
create function pg_temp.studio_rejected(query text) returns boolean language plpgsql as $$
begin execute query; return false;
exception when others then return true;
end $$;

insert into studio_assertions values
('existing onboarding thread preserved across migration', (
  select count(*) = 1 from public.conversation_threads
  where id = '00000000-0000-4000-8000-000000000002' and kind = 'onboarding'
)),
('new onboarding thread allowed by extended kind check', (
  select count(*) = 1 from public.conversation_threads
  where id = 'd0000000-0000-4000-8000-000000000003' and kind = 'onboarding'
)),
('invalid thread kind rejected by check constraint', pg_temp.studio_rejected($q$
  insert into public.conversation_threads(workspace_id, kind, title, status)
  values ('a1111111-1111-4111-8111-111111111111', 'invalid_kind', '잘못된종류', 'active');
$q$)),
('cross-workspace message FK denied on proposal', pg_temp.studio_rejected($q$
 insert into public.sohee_studio_proposals(workspace_id, source_message_id, kind, category, content, created_by)
 values ('a2222222-2222-4222-8222-222222222222', 'c1111111-1111-4111-8111-111111111111', 'fact', '영업시간', '10:00~20:00', 'e2222222-2222-4222-8222-222222222222');
$q$)),
('duplicate active studio thread in same workspace denied', pg_temp.studio_rejected($q$
 insert into public.conversation_threads(workspace_id, kind, title, status)
 values ('a1111111-1111-4111-8111-111111111111', 'studio', '소희 스튜디오 2', 'active');
$q$));

-- 4. Proposal creation and atomic confirm RPC test
insert into public.sohee_studio_proposals(
  id, workspace_id, source_message_id, kind, category, content, idempotency_key, created_by
) values (
  'f1111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111111',
  'c1111111-1111-4111-8111-111111111111',
  'fact',
  '영업시간',
  '매일 10:00 ~ 20:00',
  'prop-test-key-1',
  'e1111111-1111-4111-8111-111111111111'
);

-- Execute decide_studio_proposal RPC (Confirm)
select public.decide_studio_proposal(
  'a1111111-1111-4111-8111-111111111111',
  'f1111111-1111-4111-8111-111111111111',
  'confirm',
  'e1111111-1111-4111-8111-111111111111',
  null
);

insert into studio_assertions values
('proposal confirmed with fact created', (
  select count(*) = 1 from public.sohee_studio_proposals
  where id = 'f1111111-1111-4111-8111-111111111111'
    and status = 'confirmed'
    and confirmed_target_id is not null
)),
('fact created in knowledge_facts', (
  select count(*) = 1 from public.knowledge_facts kf
  join public.sohee_studio_proposals sp on sp.confirmed_target_id = kf.id
  where sp.id = 'f1111111-1111-4111-8111-111111111111'
    and kf.status = 'active'
    and kf.category = '영업시간'
)),
('decide_studio_proposal confirm idempotent', (
  select (public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'f1111111-1111-4111-8111-111111111111',
    'confirm',
    'e1111111-1111-4111-8111-111111111111',
    null
  )->>'idempotent')::boolean = true
)),
('rejecting confirmed proposal fails with conflict error', pg_temp.studio_rejected($q$
  select public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'f1111111-1111-4111-8111-111111111111',
    'reject',
    'e1111111-1111-4111-8111-111111111111',
    null
  );
$q$));

-- 5. Fact Supersede & Concurrency Conflict Rollback Test
-- Setup replacement proposal referencing the confirmed fact above
do $$
declare
  v_confirmed_fact_id uuid;
  v_fact_created_at timestamptz;
begin
  select confirmed_target_id into v_confirmed_fact_id
  from public.sohee_studio_proposals
  where id = 'f1111111-1111-4111-8111-111111111111';

  select created_at into v_fact_created_at
  from public.knowledge_facts
  where id = v_confirmed_fact_id;

  -- Insert proposal 2: replaces fact 1 with correct expected_fact_created_at
  insert into public.sohee_studio_proposals(
    id, workspace_id, source_message_id, kind, category, content, replaces_fact_id, expected_fact_created_at, created_by
  ) values (
    'f2222222-2222-4222-8222-222222222222',
    'a1111111-1111-4111-8111-111111111111',
    'c1111111-1111-4111-8111-111111111111',
    'fact',
    '영업시간',
    '매일 11:00 ~ 21:00 (수정안)',
    v_confirmed_fact_id,
    v_fact_created_at,
    'e1111111-1111-4111-8111-111111111111'
  );

  -- Insert proposal 3: replaces fact 1 with stale expected_fact_created_at (concurrency conflict)
  insert into public.sohee_studio_proposals(
    id, workspace_id, source_message_id, kind, category, content, replaces_fact_id, expected_fact_created_at, created_by
  ) values (
    'f3333333-3333-4333-8333-333333333333',
    'a1111111-1111-4111-8111-111111111111',
    'c1111111-1111-4111-8111-111111111111',
    'fact',
    '영업시간',
    '매일 09:00 ~ 18:00 (경합안)',
    v_confirmed_fact_id,
    v_fact_created_at - interval '1 hour',
    'e1111111-1111-4111-8111-111111111111'
  );
end $$;

-- Proposal 3 should fail due to stale expected timestamp
insert into studio_assertions values
('stale fact timestamp conflict rolls back decide RPC', pg_temp.studio_rejected($q$
  select public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'f3333333-3333-4333-8333-333333333333',
    'confirm',
    'e1111111-1111-4111-8111-111111111111',
    null
  );
$q$));

-- Proposal 2 succeeds and supersedes fact 1
select public.decide_studio_proposal(
  'a1111111-1111-4111-8111-111111111111',
  'f2222222-2222-4222-8222-222222222222',
  'confirm',
  'e1111111-1111-4111-8111-111111111111',
  null
);

insert into studio_assertions values
('previous fact is superseded', (
  select kf1.status = 'superseded' and kf2.status = 'active'
  from public.sohee_studio_proposals sp1
  join public.knowledge_facts kf1 on kf1.id = sp1.confirmed_target_id
  join public.sohee_studio_proposals sp2 on sp2.id = 'f2222222-2222-4222-8222-222222222222'
  join public.knowledge_facts kf2 on kf2.id = sp2.confirmed_target_id
  where sp1.id = 'f1111111-1111-4111-8111-111111111111'
)),
('cannot replace already superseded fact', pg_temp.studio_rejected($q$
  -- Proposal referencing fact 1 which is now superseded
  select public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'f3333333-3333-4333-8333-333333333333',
    'confirm',
    'e1111111-1111-4111-8111-111111111111',
    null
  );
$q$));

-- 6. Goal Proposal Confirmation & Reject Idempotency Test
insert into public.sohee_studio_proposals(
  id, workspace_id, source_message_id, kind, category, content, created_by
) values (
  'f4444444-4444-4444-8444-444444444444',
  'a1111111-1111-4111-8111-111111111111',
  'c1111111-1111-4111-8111-111111111111',
  'goal',
  '단골 목표',
  '월 재방문 고객 20명 달성',
  'e1111111-1111-4111-8111-111111111111'
);

select public.decide_studio_proposal(
  'a1111111-1111-4111-8111-111111111111',
  'f4444444-4444-4444-8444-444444444444',
  'confirm',
  'e1111111-1111-4111-8111-111111111111',
  null
);

insert into studio_assertions values
('goal proposal confirmed in sohee_goals', (
  select count(*) = 1
  from public.sohee_goals g
  join public.sohee_studio_proposals sp on sp.confirmed_target_id = g.id
  where sp.id = 'f4444444-4444-4444-8444-444444444444'
    and g.status = 'active'
    and g.title = '단골 목표'
)),
('goal confirmed has updated_by actor preserved', (
  select g.updated_by = 'e1111111-1111-4111-8111-111111111111'
  from public.sohee_goals g
  join public.sohee_studio_proposals sp on sp.confirmed_target_id = g.id
  where sp.id = 'f4444444-4444-4444-8444-444444444444'
)),
('re-confirming proposal with different revised content throws STUDIO_PROPOSAL_CONFLICT', pg_temp.studio_rejected($q$
  select public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'f1111111-1111-4111-8111-111111111111',
    'confirm',
    'e1111111-1111-4111-8111-111111111111',
    '전혀 다른 수정 내용 (충돌 유발)'
  );
$q$));

-- Reject flow & idempotency
insert into public.sohee_studio_proposals(
  id, workspace_id, source_message_id, kind, category, content, created_by
) values (
  'f5555555-5555-4555-8555-555555555555',
  'a1111111-1111-4111-8111-111111111111',
  'c1111111-1111-4111-8111-111111111111',
  'fact',
  '임시 메모',
  '확정하지 않을 내용',
  'e1111111-1111-4111-8111-111111111111'
);

select public.decide_studio_proposal(
  'a1111111-1111-4111-8111-111111111111',
  'f5555555-5555-4555-8555-555555555555',
  'reject',
  'e1111111-1111-4111-8111-111111111111',
  null
);

insert into studio_assertions values
('proposal marked rejected', (
  select status = 'rejected'
  from public.sohee_studio_proposals
  where id = 'f5555555-5555-4555-8555-555555555555'
)),
('decide_studio_proposal reject idempotent', (
  select (public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'f5555555-5555-4555-8555-555555555555',
    'reject',
    'e1111111-1111-4111-8111-111111111111',
    null
  )->>'idempotent')::boolean = true
)),
('confirming rejected proposal fails with conflict error', pg_temp.studio_rejected($q$
  select public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'f5555555-5555-4555-8555-555555555555',
    'confirm',
    'e1111111-1111-4111-8111-111111111111',
    null
  );
$q$));

-- 7. Atomic Turn Finalization RPC Test
insert into public.messages(id, workspace_id, thread_id, role, content, status, reply_to_message_id, created_by_user_id) values
 ('c2222222-2222-4222-8222-222222222222', 'a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 'sohee', '응답 준비 중', 'streaming', 'c1111111-1111-4111-8111-111111111111', 'e1111111-1111-4111-8111-111111111111');

select public.finalize_studio_turn(
  'a1111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111111',
  'c2222222-2222-4222-8222-222222222222',
  '예약 안내 답변입니다.',
  'completed',
  '{"tokens": 120}'::jsonb,
  '[{"kind":"fact","category":"예약안내","content":"네이버 예약 가능","idempotencyKey":"finalize-test-prop-1"}]'::jsonb,
  'e1111111-1111-4111-8111-111111111111'
);

insert into studio_assertions values
('assistant message finalized to completed', (
  select status = 'completed' and content = '예약 안내 답변입니다.'
  from public.messages
  where id = 'c2222222-2222-4222-8222-222222222222'
)),
('proposals atomically inserted by finalize_studio_turn', (
  select count(*) = 1
  from public.sohee_studio_proposals
  where workspace_id = 'a1111111-1111-4111-8111-111111111111'
    and category = '예약안내'
    and content = '네이버 예약 가능'
));

-- 8. Cross-Workspace replaces_fact_id Rejection Test
-- Workspace B tries to reference a fact owned by Workspace A via composite FK
do $$
begin
  insert into public.conversation_threads(id, workspace_id, kind, title, status) values
   ('d2222222-2222-4222-8222-222222222222', 'a2222222-2222-4222-8222-222222222222', 'studio', '소희 스튜디오 B', 'active');

  insert into public.messages(id, workspace_id, thread_id, role, content, status, created_by_user_id) values
   ('c3333333-3333-4333-8333-333333333333', 'a2222222-2222-4222-8222-222222222222', 'd2222222-2222-4222-8222-222222222222', 'user', '워크스페이스 B 질문', 'completed', 'e2222222-2222-4222-8222-222222222222');
end $$;

insert into studio_assertions values
('cross-workspace fact replacement rejected by composite FK', pg_temp.studio_rejected($q$
  insert into public.sohee_studio_proposals(
    id, workspace_id, source_message_id, kind, category, content, replaces_fact_id, created_by
  ) values (
    'f6666666-6666-4666-8666-666666666666',
    'a2222222-2222-4222-8222-222222222222',
    'c3333333-3333-4333-8333-333333333333',
    'fact',
    '영업시간',
    'WS B 영업시간',
    (select confirmed_target_id from public.sohee_studio_proposals where id = 'f2222222-2222-4222-8222-222222222222'),
    'e2222222-2222-4222-8222-222222222222'
  );
$q$));

-- 9. Mid-Transaction Insert Failure & Rollback Test
-- Setup trigger that fails during fact insertion
create or replace function pg_temp.fail_fact_insert() returns trigger language plpgsql as $$
begin
  if NEW.category = '강제실패카테고리' then
    raise exception 'forced_fact_insert_failure' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

create trigger trg_fail_fact
  before insert on public.knowledge_facts
  for each row execute function pg_temp.fail_fact_insert();

-- Insert proposal that triggers the forced failure
do $$
declare
  v_target_fact_id uuid;
begin
  select confirmed_target_id into v_target_fact_id
  from public.sohee_studio_proposals
  where id = 'f2222222-2222-4222-8222-222222222222';

  insert into public.sohee_studio_proposals(
    id, workspace_id, source_message_id, kind, category, content, replaces_fact_id, created_by
  ) values (
    'f7777777-7777-4777-8777-777777777777',
    'a1111111-1111-4111-8111-111111111111',
    'c1111111-1111-4111-8111-111111111111',
    'fact',
    '강제실패카테고리',
    '실패해야 하는 내용',
    v_target_fact_id,
    'e1111111-1111-4111-8111-111111111111'
  );
end $$;

-- Execution must fail and abort the sub-transaction
insert into studio_assertions values
('forced mid-transaction fact failure throws exception', pg_temp.studio_rejected($q$
  select public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'f7777777-7777-4777-8777-777777777777',
    'confirm',
    'e1111111-1111-4111-8111-111111111111',
    null
  );
$q$));

drop trigger trg_fail_fact on public.knowledge_facts;

-- Verify complete rollback after mid-transaction failure:
insert into studio_assertions values
('mid-transaction failure preserves proposal status as proposed', (
  select status = 'proposed' and confirmed_target_id is null
  from public.sohee_studio_proposals
  where id = 'f7777777-7777-4777-8777-777777777777'
)),
('mid-transaction failure preserves target fact as active', (
  select kf.status = 'active'
  from public.knowledge_facts kf
  join public.sohee_studio_proposals sp on sp.confirmed_target_id = kf.id
  where sp.id = 'f2222222-2222-4222-8222-222222222222'
)),
('mid-transaction failure rolled back candidate creation', (
  select count(*) = 0
  from public.knowledge_candidates
  where source_location = 'studio:proposal:f7777777-7777-4777-8777-777777777777'
));

-- 10. Assistant Response Uniqueness Scoped to Studio Turns Test
-- 10-1. Regular operations thread allows multiple assistant replies (existing retry semantics preserved)
insert into public.conversation_threads(id, workspace_id, kind, title, status) values
 ('d3333333-3333-4333-8333-333333333333', 'a1111111-1111-4111-8111-111111111111', 'operations', '일반 운영 대화', 'active');

insert into public.messages(id, workspace_id, thread_id, role, content, status, created_by_user_id) values
 ('c5555555-5555-4555-8555-555555555555', 'a1111111-1111-4111-8111-111111111111', 'd3333333-3333-4333-8333-333333333333', 'user', '일반 질문', 'completed', 'e1111111-1111-4111-8111-111111111111');

insert into public.messages(id, workspace_id, thread_id, role, content, status, reply_to_message_id, created_by_user_id) values
 ('c6666666-6666-4666-8666-666666666666', 'a1111111-1111-4111-8111-111111111111', 'd3333333-3333-4333-8333-333333333333', 'sohee', '첫 응답', 'completed', 'c5555555-5555-4555-8555-555555555555', 'e1111111-1111-4111-8111-111111111111'),
 ('c7777777-7777-4777-8777-777777777777', 'a1111111-1111-4111-8111-111111111111', 'd3333333-3333-4333-8333-333333333333', 'sohee', '재시도 응답', 'completed', 'c5555555-5555-4555-8555-555555555555', 'e1111111-1111-4111-8111-111111111111');

insert into studio_assertions values
('regular operations thread allows multiple assistant replies', (
  select count(*) = 2
  from public.messages
  where thread_id = 'd3333333-3333-4333-8333-333333333333'
    and role = 'sohee'
    and reply_to_message_id = 'c5555555-5555-4555-8555-555555555555'
)),
-- 10-2. Studio turn with marker forbids duplicate assistant claims
('duplicate studio assistant claim denied by scoped unique index', pg_temp.studio_rejected($q$
  insert into public.messages(id, workspace_id, thread_id, role, content, status, reply_to_message_id, usage_metadata, created_by_user_id) values
   ('c4444444-4444-4444-8444-444444444444', 'a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 'sohee', '중복 스튜디오 응답 시도', 'streaming', 'c1111111-1111-4111-8111-111111111111', '{"soheeStudioTurn":"true"}'::jsonb, 'e1111111-1111-4111-8111-111111111111');
$q$));

-- 11. Category Length Contract (Goal <= 200, Fact <= 120) Test
insert into public.sohee_studio_proposals(
  id, workspace_id, source_message_id, kind, category, content, created_by
) values (
  'f8888888-8888-4888-8888-888888888888',
  'a1111111-1111-4111-8111-111111111111',
  'c1111111-1111-4111-8111-111111111111',
  'goal',
  repeat('목표제목길이150자-', 15), -- 150 chars
  '긴 목표 제목 정상 수용',
  'e1111111-1111-4111-8111-111111111111'
);

insert into studio_assertions values
('goal category 150 chars accepted in proposals', (
  select count(*) = 1
  from public.sohee_studio_proposals
  where id = 'f8888888-8888-4888-8888-888888888888'
)),
('fact category 150 chars denied by CHECK constraint', pg_temp.studio_rejected($q$
  insert into public.sohee_studio_proposals(
    id, workspace_id, source_message_id, kind, category, content, created_by
  ) values (
    'f9999999-9999-4999-8999-999999999999',
    'a1111111-1111-4111-8111-111111111111',
    'c1111111-1111-4111-8111-111111111111',
    'fact',
    repeat('사실카테고리150자-', 15), -- 150 chars
    '사실은 120자 초과 불가',
    'e1111111-1111-4111-8111-111111111111'
  );
$q$));

-- 12. Direct Role Permission Inspection & Denial Test
insert into studio_assertions values
('anon role cannot select sohee_studio_proposals', pg_temp.studio_rejected($q$
  set local role anon;
  select * from public.sohee_studio_proposals limit 1;
$q$)),
('authenticated role cannot insert sohee_studio_proposals', pg_temp.studio_rejected($q$
  set local role authenticated;
  insert into public.sohee_studio_proposals(workspace_id, source_message_id, kind, category, content, created_by)
  values ('a1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'fact', '권한테스트', '내용', 'e1111111-1111-4111-8111-111111111111');
$q$)),
('anon role cannot execute decide_studio_proposal RPC', pg_temp.studio_rejected($q$
  set local role anon;
  select public.decide_studio_proposal('a1111111-1111-4111-8111-111111111111', 'f1111111-1111-4111-8111-111111111111', 'confirm', 'e1111111-1111-4111-8111-111111111111', null);
$q$)),
('authenticated role cannot execute decide_studio_proposal RPC', pg_temp.studio_rejected($q$
  set local role authenticated;
  select public.decide_studio_proposal('a1111111-1111-4111-8111-111111111111', 'f1111111-1111-4111-8111-111111111111', 'confirm', 'e1111111-1111-4111-8111-111111111111', null);
$q$));

-- 13. Direct Execution Under service_role (Verifies SECURITY INVOKER with actual service_role privileges)
do $$
begin
  set local role service_role;

  insert into public.sohee_studio_proposals(
    id, workspace_id, source_message_id, kind, category, content, created_by
  ) values (
    'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a1111111-1111-4111-8111-111111111111',
    'c1111111-1111-4111-8111-111111111111',
    'fact',
    '서비스역할검증',
    'service_role로 직접 확정하는 내용',
    'e1111111-1111-4111-8111-111111111111'
  );

  perform public.decide_studio_proposal(
    'a1111111-1111-4111-8111-111111111111',
    'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'confirm',
    'e1111111-1111-4111-8111-111111111111',
    null
  );

  reset role;
end $$;

insert into studio_assertions values
('service_role role executes decide_studio_proposal successfully', (
  select count(*) = 1
  from public.sohee_studio_proposals sp
  join public.knowledge_facts kf on kf.id = sp.confirmed_target_id
  where sp.id = 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and sp.status = 'confirmed'
    and kf.status = 'active'
    and kf.category = '서비스역할검증'
));

-- 14. Column-Specific ON DELETE SET NULL Regression Verification
-- 14-1. Message deletion sets sohee_goals.source_message_id to null without violating NOT NULL workspace_id
insert into public.messages(id, workspace_id, thread_id, role, content, status, created_by_user_id) values
 ('c8888888-8888-4888-8888-888888888888', 'a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 'user', '목표 출처 메시지', 'completed', 'e1111111-1111-4111-8111-111111111111');

insert into public.sohee_goals(id, workspace_id, title, desired_outcome, source_message_id, created_by) values
 ('08888888-8888-4888-8888-888888888888', 'a1111111-1111-4111-8111-111111111111', '보존목표', '결과', 'c8888888-8888-4888-8888-888888888888', 'e1111111-1111-4111-8111-111111111111');

delete from public.messages where id = 'c8888888-8888-4888-8888-888888888888';

insert into studio_assertions values
('message deletion sets goal source_message_id to null while preserving workspace_id', (
  select count(*) = 1 and bool_and(workspace_id = 'a1111111-1111-4111-8111-111111111111' and source_message_id is null)
  from public.sohee_goals
  where id = '08888888-8888-4888-8888-888888888888'
));

-- 14-2. Fact deletion sets sohee_studio_proposals.replaces_fact_id to null without violating NOT NULL workspace_id
insert into public.knowledge_sources(id, workspace_id, source_type, display_name, created_by_user_id) values
 ('18888888-8888-4888-8888-888888888888', 'a1111111-1111-4111-8111-111111111111', 'manual', '임시자료', 'e1111111-1111-4111-8111-111111111111');

insert into public.knowledge_candidates(id, workspace_id, knowledge_source_id, category, content, status, reviewed_by_user_id, reviewed_at, created_by_user_id) values
 ('b8888888-8888-4888-8888-888888888888', 'a1111111-1111-4111-8111-111111111111', '18888888-8888-4888-8888-888888888888', '테스트', '임시지식내용', 'approved', 'e1111111-1111-4111-8111-111111111111', now(), 'e1111111-1111-4111-8111-111111111111');

insert into public.knowledge_facts(id, workspace_id, category, content, status, source_candidate_id, approved_by_user_id, approved_at) values
 ('28888888-8888-4888-8888-888888888888', 'a1111111-1111-4111-8111-111111111111', '테스트', '임시지식내용', 'active', 'b8888888-8888-4888-8888-888888888888', 'e1111111-1111-4111-8111-111111111111', now());

insert into public.sohee_studio_proposals(id, workspace_id, source_message_id, kind, category, content, replaces_fact_id, created_by) values
 ('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'a1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'fact', '테스트', '새제안내용', '28888888-8888-4888-8888-888888888888', 'e1111111-1111-4111-8111-111111111111');

delete from public.knowledge_facts where id = '28888888-8888-4888-8888-888888888888';

insert into studio_assertions values
('fact deletion sets proposal replaces_fact_id to null while preserving workspace_id', (
  select count(*) = 1 and bool_and(workspace_id = 'a1111111-1111-4111-8111-111111111111' and replaces_fact_id is null)
  from public.sohee_studio_proposals
  where id = 'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
));

do $$ begin
 if (select not bool_and(passed) from studio_assertions) then
   raise exception 'studio assertions failed: %', (select string_agg(name, ', ') from studio_assertions where not passed);
 end if;
end $$;

select count(*) as total_assertions, bool_and(passed) as all_passed from studio_assertions;

rollback;
