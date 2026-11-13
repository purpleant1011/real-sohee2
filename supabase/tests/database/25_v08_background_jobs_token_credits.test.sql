begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

select has_table('public', 'conversation_jobs', 'conversation jobs table exists');
select has_table('public', 'conversation_job_steps', 'conversation job steps table exists');
select has_table('public', 'ai_usage_events', 'AI usage event ledger exists');
select has_function(
  'public', 'enqueue_conversation_job',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'integer', 'uuid'],
  'enqueue conversation job RPC exists'
);
select has_function(
  'public', 'claim_conversation_job',
  array['uuid', 'uuid', 'timestamp with time zone'],
  'claim conversation job RPC exists'
);
select has_function(
  'public', 'complete_conversation_job',
  array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone'],
  'complete conversation job RPC exists'
);
select has_function(
  'public', 'get_conversation_work_status',
  array['uuid'],
  'conversation work status RPC exists'
);
select has_function(
  'public', 'record_ai_usage_event',
  array[
    'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text',
    'integer', 'integer', 'integer', 'integer', 'integer', 'integer',
    'text', 'text', 'integer'
  ],
  'record AI usage RPC exists'
);
select has_function('public', 'persist_conversation_job_request', array['uuid', 'uuid', 'jsonb'], 'persist job request metadata RPC exists');
select has_function('public', 'mark_conversation_job_dispatched', array['uuid', 'uuid', 'timestamp with time zone'], 'mark Queue dispatch RPC exists');
select has_function('public', 'fail_conversation_job_dispatch', array['uuid', 'uuid', 'timestamp with time zone'], 'fail Queue dispatch RPC exists');
select ok(
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.conversation_jobs')), false),
  'conversation job RLS is enabled'
);
select ok(
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.ai_usage_events')), false),
  'AI usage RLS is enabled'
);
select ok(
  case when to_regclass('public.conversation_jobs') is null then false
    else not has_table_privilege('authenticated', 'public.conversation_jobs', 'INSERT') end,
  'authenticated callers cannot insert conversation jobs'
);
select ok(
  case when to_regclass('public.conversation_jobs') is null then false
    else not has_table_privilege('authenticated', 'public.conversation_jobs', 'UPDATE') end,
  'authenticated callers cannot update conversation jobs'
);
select ok(
  case when to_regclass('public.ai_usage_events') is null then false
    else not has_table_privilege('authenticated', 'public.ai_usage_events', 'INSERT') end,
  'authenticated callers cannot insert AI usage'
);
select ok(
  case when to_regclass('public.ai_usage_events') is null then false
    else not has_table_privilege('authenticated', 'public.ai_usage_events', 'UPDATE') end,
  'authenticated callers cannot update AI usage'
);
select is(
  (select rates ->> 'policyVersion' from public.credit_rate_versions where catalog_version = 8002),
  'v08-test-2000-1',
  'credit catalog records the token policy version'
);
select is(
  (select (rates ->> 'weeklyPreviewAllowanceCredits')::integer from public.credit_rate_versions where catalog_version = 8002),
  2000,
  'token policy grants 2000 weekly test credits'
);

select has_function(
  'public', 'request_conversation_job_cancel',
  array['uuid', 'uuid', 'uuid'],
  'conversation job cancel RPC exists'
);
select has_function(
  'public', 'resolve_conversation_job_attention',
  array['uuid', 'uuid', 'uuid', 'text'],
  'conversation attention resolution RPC exists'
);

insert into auth.users (id, email) values
  ('25000000-0000-4000-8000-000000000001', 'job-owner@sohee.test.invalid'),
  ('25000000-0000-4000-8000-000000000002', 'job-outsider@sohee.test.invalid');

insert into public.workspaces (id, name, created_by)
values ('35000000-0000-4000-8000-000000000001', '백그라운드 작업 검증', '25000000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('35000000-0000-4000-8000-000000000001', '25000000-0000-4000-8000-000000000001', 'owner', 'active')
on conflict (workspace_id, user_id) do update
set role = excluded.role, status = excluded.status;

insert into public.conversation_threads (id, workspace_id, kind, title, status, last_message_at)
values (
  '45000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'operations', '병렬 작업 대화', 'active', statement_timestamp()
);

select is(
  (public.get_workspace_credit_balance('35000000-0000-4000-8000-000000000001') ->> 'available')::integer,
  2000,
  'a new weekly test account starts with 2000 available credits'
);
select is(
  (select count(*)::integer from public.credit_ledger_entries
   where workspace_id = '35000000-0000-4000-8000-000000000001' and kind = 'grant'),
  1,
  'the weekly allowance is granted exactly once'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.messages (
  workspace_id, thread_id, role, content, status, client_message_id,
  created_by_user_id, completed_at
) values (
  '35000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000001',
  'user', '첫 번째 요청', 'completed',
  '55000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001', statement_timestamp()
);

select is(
  (public.enqueue_conversation_job(
    '35000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001',
    '첫 번째 요청', '첫 번째 실행 요청', 'chat', 20,
    '65000000-0000-4000-8000-000000000001'
  ) #>> '{job,status}'),
  'queued',
  'enqueue creates a queued conversation job'
);
select is(
  (select count(*)::integer from public.conversation_jobs
   where workspace_id = '35000000-0000-4000-8000-000000000001'),
  1,
  'the first enqueue creates one job'
);
select is(
  (select count(*)::integer from public.messages
   where workspace_id = '35000000-0000-4000-8000-000000000001'
     and client_message_id = '55000000-0000-4000-8000-000000000001'),
  1,
  'enqueue reuses the first message created by atomic conversation start'
);
select is(
  (public.enqueue_conversation_job(
    '35000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000001',
    '첫 번째 요청', '첫 번째 실행 요청', 'chat', 20,
    '65000000-0000-4000-8000-000000000001'
  ) #>> '{job,id}'),
  (select id::text from public.conversation_jobs where sequence_number = 1),
  'duplicate enqueue returns the original job'
);
select is(
  (select count(*)::integer from public.credit_reservations
   where workspace_id = '35000000-0000-4000-8000-000000000001'),
  1,
  'duplicate enqueue creates one credit reservation'
);

select lives_ok(
  $$select public.enqueue_conversation_job(
    '35000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000002',
    '둘째 요청', '둘째 실행 요청', 'chat', 20,
    '65000000-0000-4000-8000-000000000002'
  )$$,
  'a second request can queue in the same thread'
);
select is(
  (select sequence_number from public.conversation_jobs
   where workspace_id = '35000000-0000-4000-8000-000000000001'
   order by sequence_number desc limit 1),
  2::bigint,
  'same-thread jobs receive ascending sequence numbers'
);
select is(
  public.claim_conversation_job(
    (select id from public.conversation_jobs where sequence_number = 2),
    '75000000-0000-4000-8000-000000000001', statement_timestamp()
  ) ->> 'state',
  'blocked_by_predecessor',
  'the second same-thread job cannot pass its predecessor'
);
select is(
  public.claim_conversation_job(
    (select id from public.conversation_jobs where sequence_number = 1),
    '75000000-0000-4000-8000-000000000001', statement_timestamp()
  ) ->> 'state',
  'claimed',
  'the first same-thread job is claimable'
);
select is(
  public.complete_conversation_job(
    (select id from public.conversation_jobs where sequence_number = 1),
    '75000000-0000-4000-8000-000000000001', 'succeeded', null, statement_timestamp()
  ) #>> '{job,status}',
  'succeeded',
  'the worker can complete its claimed job'
);
select is(
  public.claim_conversation_job(
    (select id from public.conversation_jobs where sequence_number = 2),
    '75000000-0000-4000-8000-000000000001', statement_timestamp()
  ) ->> 'state',
  'claimed',
  'the second job becomes claimable after its predecessor completes'
);

insert into public.ai_usage_events (
  workspace_id, job_id, message_id, provider, model, operation,
  provider_request_id, provider_call_key, text_input_tokens,
  cached_text_input_tokens, text_output_tokens, image_input_tokens,
  image_output_tokens, provider_total_tokens, usage_source,
  policy_version, computed_credits
) select
  job.workspace_id, job.id, job.assistant_message_id, 'openai', 'gpt-5.6-luna',
  'text_response', 'resp_test', 'job-1:text-1', 1000, 0, 500, 0, 0, 1500,
  'actual', 'v08-test-2000-1', 1
from public.conversation_jobs job where job.sequence_number = 1;

reset role;
select throws_ok(
  $$update public.ai_usage_events set computed_credits = 9 where provider_call_key = 'job-1:text-1'$$,
  'P0001', 'AI_USAGE_APPEND_ONLY',
  'AI usage rows are append only'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000001', true);
select is(
  public.request_conversation_job_cancel(
    '35000000-0000-4000-8000-000000000001',
    (select id from public.conversation_jobs where sequence_number = 2),
    '25000000-0000-4000-8000-000000000001'
  ) #>> '{job,status}',
  'cancel_requested',
  'a running job records a cancellation request without pretending the provider stopped'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.claim_conversation_job(
    (select id from public.conversation_jobs where sequence_number = 2),
    '75000000-0000-4000-8000-000000000002', statement_timestamp() + interval '16 minutes'
  ) #>> '{job,status}',
  'needs_attention',
  'a redelivered in-flight cancellation becomes explicit unknown outcome instead of repeating the provider call'
);
select is(
  (select state from public.credit_reservations where id = '65000000-0000-4000-8000-000000000002'),
  'reserved',
  'unknown provider outcome keeps credit reserved for reconciliation'
);
select lives_ok(
  $$select public.enqueue_conversation_job(
    '35000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001',
    '55000000-0000-4000-8000-000000000003',
    '취소할 요청', '취소할 실행 요청', 'chat', 20,
    '65000000-0000-4000-8000-000000000003'
  )$$,
  'a queued job is available for cancellation verification'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000001', true);
select is(
  public.request_conversation_job_cancel(
    '35000000-0000-4000-8000-000000000001',
    (select id from public.conversation_jobs where sequence_number = 3),
    '25000000-0000-4000-8000-000000000001'
  ) #>> '{job,status}',
  'cancelled',
  'a queued job cancels immediately and releases its reservation'
);
select is(
  (select state from public.credit_reservations where id = '65000000-0000-4000-8000-000000000003'),
  'released',
  'queued cancellation returns all reserved credit'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '25000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.conversation_jobs
   where workspace_id = '35000000-0000-4000-8000-000000000001'),
  0,
  'an outsider cannot read conversation jobs'
);

select * from finish();
rollback;
