begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

select has_table('public', 'knowledge_sources', 'knowledge sources exist');
select has_table('public', 'knowledge_candidates', 'knowledge candidates exist');
select has_table('public', 'knowledge_facts', 'approved knowledge facts exist');
select has_table('public', 'customer_conversations', 'customer conversations exist');
select has_table('public', 'harness_rules', 'harness rules exist');

select has_column('public', 'knowledge_sources', 'workspace_id', 'sources are workspace bound');
select has_column('public', 'knowledge_candidates', 'workspace_id', 'candidates are workspace bound');
select has_column('public', 'knowledge_facts', 'workspace_id', 'facts are workspace bound');
select has_column('public', 'customer_conversations', 'workspace_id', 'customers are workspace bound');
select has_column('public', 'harness_rules', 'workspace_id', 'harness rules are workspace bound');
select has_column(
  'public', 'customer_conversations', 'external_subject_reference_hash',
  'customer records retain only a hashed external subject reference'
);
select hasnt_column(
  'public', 'customer_conversations', 'external_subject_reference',
  'raw external customer identifiers have no storage column'
);

select has_function(
  'public', 'review_knowledge_candidate',
  array['uuid', 'uuid', 'text', 'text', 'integer'],
  'knowledge candidate review RPC exists'
);
select has_function(
  'public', 'resolve_knowledge_conflict',
  array['uuid', 'uuid', 'text', 'text', 'integer'],
  'knowledge conflict RPC exists'
);
select has_function(
  'public', 'review_harness_rule',
  array['uuid', 'uuid', 'text', 'text', 'integer'],
  'harness review RPC exists'
);
select has_function(
  'public', 'pause_harness_rule',
  array['uuid', 'uuid', 'text', 'text', 'integer'],
  'harness lifecycle RPC exists'
);

select ok(
  not has_function_privilege(
    'anon', 'public.review_knowledge_candidate(uuid,uuid,text,text,integer)', 'EXECUTE'
  ),
  'anonymous users cannot review knowledge candidates'
);
select ok(
  not has_function_privilege(
    'anon', 'public.review_harness_rule(uuid,uuid,text,text,integer)', 'EXECUTE'
  ),
  'anonymous users cannot activate harness rules'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname in (
        'knowledge_sources', 'knowledge_candidates', 'knowledge_facts',
        'customer_conversations', 'harness_rules'
      )
      and relrowsecurity
  ),
  5,
  'all knowledge, customer, and harness tables enforce RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.knowledge_facts', 'INSERT'),
  'authenticated users cannot bypass reviewed fact creation'
);

insert into auth.users (id, email)
values
  ('12000000-0000-4000-8000-000000000001', 'knowledge-owner-a@sohee.test.invalid'),
  ('12000000-0000-4000-8000-000000000002', 'knowledge-owner-b@sohee.test.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);

insert into public.workspaces (id, name, created_by)
values (
  '22000000-0000-4000-8000-000000000001',
  '지식 작업공간 A',
  '12000000-0000-4000-8000-000000000001'
);

insert into public.conversation_threads (id, workspace_id, kind, title)
values (
  '32000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'operations',
  '지식과 하네스 대화'
);

insert into public.messages (
  id, workspace_id, thread_id, role, content, status, created_by_user_id
)
values (
  '42000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'user',
  '이 응답 규칙을 후보로 저장해 줘.',
  'completed',
  '12000000-0000-4000-8000-000000000001'
);

insert into public.knowledge_sources (
  id, workspace_id, source_type, provider_mode, display_name, status, created_by_user_id
)
values (
  '52000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'manual',
  'registered_only',
  '운영 정책 메모',
  'review_required',
  '12000000-0000-4000-8000-000000000001'
);

insert into public.knowledge_candidates (
  id, workspace_id, knowledge_source_id, category, content, confidence,
  status, created_by_user_id
)
values (
  '62000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  'operation_policy',
  '게시 전에는 항상 사용자의 최종 확인이 필요하다.',
  0.98,
  'review_required',
  '12000000-0000-4000-8000-000000000001'
);

select is(
  (select count(*)::integer from public.knowledge_facts),
  0,
  'an unreviewed candidate is not an active fact'
);

select lives_ok(
  $$select public.review_knowledge_candidate(
      '22000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000001',
      'approve',
      '운영 승인 경계를 확인했습니다.',
      1
    )$$,
  'an owner can approve a candidate at the expected version'
);

select is(
  (
    select status from public.knowledge_facts
    where source_candidate_id = '62000000-0000-4000-8000-000000000001'
  ),
  'active',
  'approval creates an active fact'
);
select ok(
  (
    select approved_by_user_id is not null and approved_at is not null
    from public.knowledge_facts
    where source_candidate_id = '62000000-0000-4000-8000-000000000001'
  ),
  'an active fact retains its approver and approval time'
);

select throws_ok(
  $$select public.review_knowledge_candidate(
      '22000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000001',
      'reject',
      '오래된 화면에서 보낸 요청',
      1
    )$$,
  '40001',
  'knowledge_candidate_version_conflict',
  'stale candidate reviews fail closed'
);

insert into public.knowledge_candidates (
  id, workspace_id, knowledge_source_id, category, content, confidence,
  status, conflicts_with_fact_id, created_by_user_id
)
select
  '62000000-0000-4000-8000-000000000002',
  '22000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  'operation_policy',
  '예약과 게시 전에는 각각 사용자의 최종 확인이 필요하다.',
  0.99,
  'conflict',
  id,
  '12000000-0000-4000-8000-000000000001'
from public.knowledge_facts
where source_candidate_id = '62000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.resolve_knowledge_conflict(
      '22000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000002',
      'replace',
      '더 구체적인 승인 정책으로 교체합니다.',
      1
    )$$,
  'an owner can resolve a conflict with a replacement fact'
);
select is(
  (
    select status from public.knowledge_facts
    where source_candidate_id = '62000000-0000-4000-8000-000000000001'
  ),
  'superseded',
  'the replaced fact remains as superseded history'
);
select is(
  (
    select status from public.knowledge_facts
    where source_candidate_id = '62000000-0000-4000-8000-000000000002'
  ),
  'active',
  'the conflict resolution creates the new active fact'
);

insert into public.harness_rules (
  id, workspace_id, rule_key, rule_type, title, description, structured_rule,
  applies_to_channels, status, source_message_id, source_knowledge_fact_ids,
  created_by_user_id
)
select
  '72000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'approval-before-publish',
  'approval_boundary',
  '게시 전 최종 확인',
  '게시 요청을 바로 실행하지 않고 확인 단계로 연결한다.',
  '{"action":"request_confirmation","appliesBefore":"publish"}'::jsonb,
  array['instagram', 'threads']::text[],
  'review_required',
  '42000000-0000-4000-8000-000000000001',
  array[id]::uuid[],
  '12000000-0000-4000-8000-000000000001'
from public.knowledge_facts
where source_candidate_id = '62000000-0000-4000-8000-000000000002';

select lives_ok(
  $$select public.review_harness_rule(
      '22000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      'approve',
      '승인 경계가 설계와 일치합니다.',
      1
    )$$,
  'an owner can activate a reviewed harness rule'
);
select ok(
  (
    select status = 'active'
      and approved_by_user_id = '12000000-0000-4000-8000-000000000001'
      and approved_at is not null
    from public.harness_rules
    where id = '72000000-0000-4000-8000-000000000001'
  ),
  'an active harness rule always records approval evidence'
);
select lives_ok(
  $$select public.pause_harness_rule(
      '22000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      'pause',
      '정책 재검토 동안 일시 중지합니다.',
      2
    )$$,
  'an owner can pause an active harness rule'
);
select is(
  (
    select status from public.harness_rules
    where id = '72000000-0000-4000-8000-000000000001'
  ),
  'paused',
  'a paused harness rule is no longer active'
);

select lives_ok(
  $$insert into public.customer_conversations (
      workspace_id, channel, external_subject_reference_hash, display_label,
      status, intent, summary, latest_message_at, requires_human_review,
      created_by_user_id
    ) values (
      '22000000-0000-4000-8000-000000000001',
      'instagram',
      repeat('a', 64),
      '인스타그램 고객 01',
      'needs_attention',
      'booking_inquiry',
      '다음 주 예약 가능 시간을 문의했습니다.',
      statement_timestamp(),
      true,
      '12000000-0000-4000-8000-000000000001'
    )$$,
  'a customer summary accepts only a non-identifying reference hash'
);

select throws_ok(
  $$insert into public.customer_conversations (
      workspace_id, channel, external_subject_reference_hash, display_label,
      status, summary, created_by_user_id
    ) values (
      '22000000-0000-4000-8000-000000000001',
      'instagram',
      'raw-customer-id',
      '원본 식별자',
      'open',
      '원본 식별자는 저장하면 안 됩니다.',
      '12000000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  'new row for relation "customer_conversations" violates check constraint "customer_conversations_subject_hash_check"',
  'a raw external customer identifier is rejected'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);

insert into public.workspaces (id, name, created_by)
values (
  '22000000-0000-4000-8000-000000000002',
  '지식 작업공간 B',
  '12000000-0000-4000-8000-000000000002'
);

insert into public.knowledge_sources (
  id, workspace_id, source_type, provider_mode, uri, display_name, status, created_by_user_id
)
values (
  '52000000-0000-4000-8000-000000000002',
  '22000000-0000-4000-8000-000000000002',
  'url',
  'mock',
  'https://example.invalid/knowledge',
  '다른 작업공간 출처',
  'registered',
  '12000000-0000-4000-8000-000000000002'
);

select is(
  (
    select count(*)::integer from public.knowledge_sources
    where workspace_id = '22000000-0000-4000-8000-000000000001'
  ),
  0,
  'another workspace owner cannot read foreign sources'
);
select is(
  (
    select count(*)::integer from public.harness_rules
    where workspace_id = '22000000-0000-4000-8000-000000000001'
  ),
  0,
  'another workspace owner cannot read foreign harness rules'
);
select is(
  (
    select count(*)::integer from public.customer_conversations
    where workspace_id = '22000000-0000-4000-8000-000000000001'
  ),
  0,
  'another workspace owner cannot read foreign customer summaries'
);

reset role;

select throws_ok(
  $$insert into public.knowledge_candidates (
      workspace_id, knowledge_source_id, category, content, confidence,
      status, created_by_user_id
    ) values (
      '22000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000002',
      'foreign_source',
      '다른 작업공간 출처를 연결하면 안 됩니다.',
      0.5,
      'review_required',
      '12000000-0000-4000-8000-000000000001'
    )$$,
  '23503',
  'insert or update on table "knowledge_candidates" violates foreign key constraint "knowledge_candidates_source_fkey"',
  'a candidate cannot connect to a source in another workspace'
);

select * from finish();
rollback;
