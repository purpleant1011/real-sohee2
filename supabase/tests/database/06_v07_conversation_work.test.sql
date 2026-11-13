begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

select has_table('public', 'conversation_threads', 'conversation threads exist');
select has_table('public', 'messages', 'messages exist');
select has_table('public', 'message_evidence', 'message evidence exists');
select has_table('public', 'work_items', 'work items exist');

select has_column('public', 'conversation_threads', 'workspace_id', 'threads are workspace bound');
select has_column('public', 'messages', 'workspace_id', 'messages are workspace bound');
select has_column('public', 'message_evidence', 'workspace_id', 'evidence is workspace bound');
select has_column('public', 'work_items', 'workspace_id', 'work items are workspace bound');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.conversation_threads'::regclass),
  'conversation thread RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.messages'::regclass),
  'message RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.message_evidence'::regclass),
  'message evidence RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.work_items'::regclass),
  'work item RLS is enabled'
);

select has_index(
  'public', 'conversation_threads', 'conversation_threads_workspace_activity_idx',
  'threads have the required activity index'
);
select ok(
  pg_get_indexdef('public.conversation_threads_workspace_activity_idx'::regclass)
    like '%(workspace_id, last_message_at DESC NULLS LAST, created_at DESC, id DESC)%',
  'thread activity index keeps the workspace activity ordering contract'
);
select has_index(
  'public', 'messages', 'messages_thread_created_idx',
  'messages have the required thread recency index'
);
select has_index(
  'public', 'work_items', 'work_items_workspace_status_due_idx',
  'work items have the required status and due date index'
);
select has_index(
  'public', 'messages', 'messages_workspace_client_message_id_key',
  'client message identifiers are idempotent per workspace'
);

select ok(
  has_table_privilege('authenticated', 'public.conversation_threads', 'SELECT'),
  'authenticated members can query threads through RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.messages', 'SELECT'),
  'authenticated members can query messages through RLS'
);
select ok(
  not has_table_privilege('anon', 'public.messages', 'SELECT'),
  'anonymous users cannot query messages'
);
select ok(
  not has_table_privilege('anon', 'public.work_items', 'SELECT'),
  'anonymous users cannot query work items'
);

insert into auth.users (id, email)
values
  ('11000000-0000-4000-8000-000000000001', 'stage1-owner-a@sohee.test.invalid'),
  ('11000000-0000-4000-8000-000000000002', 'stage1-owner-b@sohee.test.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

insert into public.workspaces (id, name, created_by)
values (
  '21000000-0000-4000-8000-000000000001',
  '대화 작업공간 A',
  '11000000-0000-4000-8000-000000000001'
);

insert into public.conversation_threads (id, workspace_id, kind, title)
values (
  '31000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'operations',
  '기본 운영 대화'
);

insert into public.messages (
  id, workspace_id, thread_id, role, content, status, client_message_id,
  created_by_user_id, completed_at
)
values (
  '41000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'user',
  '이번 주 콘텐츠 작업을 시작해 줘.',
  'completed',
  '51000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '2026-08-10T08:00:00Z'
);

select ok(
  (
    select completed_at is not null
    from public.messages
    where id = '41000000-0000-4000-8000-000000000001'
  ),
  'an authenticated user message can persist its completion time'
);

insert into public.work_items (
  id, workspace_id, type, title, summary, status, priority, owner_type,
  source_thread_id, source_message_id, created_by
)
values (
  '61000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'content',
  '이번 주 콘텐츠 만들기',
  '대화에서 생성된 콘텐츠 업무',
  'idea',
  'normal',
  'shared',
  '31000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001'
);

update public.messages
set work_item_id = '61000000-0000-4000-8000-000000000001'
where id = '41000000-0000-4000-8000-000000000001';

select lives_ok(
  $$insert into public.message_evidence (
      id, workspace_id, message_id, evidence_type, evidence_id, label, excerpt
    ) values (
      '71000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001',
      'work_item',
      '61000000-0000-4000-8000-000000000001',
      '생성된 업무',
      '이번 주 콘텐츠 만들기'
    )$$,
  'a message can cite a work item in the same workspace'
);

select is(
  (
    select source_message_id
    from public.work_items
    where id = '61000000-0000-4000-8000-000000000001'
  ),
  '41000000-0000-4000-8000-000000000001'::uuid,
  'a work item can retain its same-workspace source message'
);

select is(
  (
    select work_item_id
    from public.messages
    where id = '41000000-0000-4000-8000-000000000001'
  ),
  '61000000-0000-4000-8000-000000000001'::uuid,
  'a message can link back to a same-workspace work item'
);

select throws_ok(
  $$insert into public.messages (
      workspace_id, thread_id, role, content, status, created_by_user_id
    ) values (
      '21000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      'system_event',
      '임의 시스템 이벤트',
      'completed',
      '11000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'new row violates row-level security policy for table "messages"',
  'a regular user cannot forge a system event'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);

insert into public.workspaces (id, name, created_by)
values (
  '21000000-0000-4000-8000-000000000002',
  '대화 작업공간 B',
  '11000000-0000-4000-8000-000000000002'
);

insert into public.conversation_threads (id, workspace_id, kind, title)
values (
  '31000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000002',
  'operations',
  '다른 운영 대화'
);

insert into public.messages (
  id, workspace_id, thread_id, role, content, status, created_by_user_id
)
values (
  '41000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000002',
  'user',
  '다른 작업공간 메시지',
  'completed',
  '11000000-0000-4000-8000-000000000002'
);

insert into public.work_items (
  id, workspace_id, type, title, status, priority, owner_type, created_by
)
values (
  '61000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000002',
  'knowledge_review',
  '다른 작업공간 업무',
  'review_required',
  'high',
  'user',
  '11000000-0000-4000-8000-000000000002'
);

select is(
  (
    select count(*)::integer
    from public.conversation_threads
    where workspace_id = '21000000-0000-4000-8000-000000000001'
  ),
  0,
  'another workspace owner cannot read foreign threads'
);
select is(
  (
    select count(*)::integer
    from public.messages
    where workspace_id = '21000000-0000-4000-8000-000000000001'
  ),
  0,
  'another workspace owner cannot read foreign messages'
);
select is(
  (
    select count(*)::integer
    from public.work_items
    where workspace_id = '21000000-0000-4000-8000-000000000001'
  ),
  0,
  'another workspace owner cannot read foreign work items'
);

reset role;

select throws_ok(
  $$insert into public.message_evidence (
      workspace_id, message_id, evidence_type, evidence_id, label
    ) values (
      '21000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000001',
      'work_item',
      '61000000-0000-4000-8000-000000000002',
      '다른 작업공간 업무'
    )$$,
  'P0001',
  '근거가 현재 작업 공간에 속하지 않습니다.',
  'message evidence cannot cite a resource from another workspace'
);

select throws_ok(
  $$insert into public.work_items (
      workspace_id, type, title, status, priority, owner_type,
      source_thread_id, source_message_id, created_by
    ) values (
      '21000000-0000-4000-8000-000000000001',
      'recovery',
      '잘못 연결된 업무',
      'recovery_required',
      'urgent',
      'shared',
      '31000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000001'
    )$$,
  '23503',
  'insert or update on table "work_items" violates foreign key constraint "work_items_source_thread_fkey"',
  'a work item cannot link a source message from another workspace'
);

select throws_ok(
  $$insert into public.messages (
      workspace_id, thread_id, role, content, status, client_message_id,
      created_by_user_id
    ) values (
      '21000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      'user',
      '중복 요청',
      'completed',
      '51000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001'
    )$$,
  '23505',
  'duplicate key value violates unique constraint "messages_workspace_client_message_id_key"',
  'duplicate client message requests are rejected'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname in ('conversation_threads', 'messages', 'message_evidence', 'work_items')
      and relrowsecurity
  ),
  4,
  'all stage one conversation tables enforce RLS'
);

select * from finish();
rollback;
