begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

select has_function(
  'public', 'get_workspace_credit_usage_detail', array['uuid', 'integer'],
  'workspace credit usage detail RPC exists'
);
select ok(has_function_privilege('authenticated', 'public.get_workspace_credit_usage_detail(uuid,integer)', 'EXECUTE'), 'authenticated can read authorized usage detail');
select ok(not has_function_privilege('anon', 'public.get_workspace_credit_usage_detail(uuid,integer)', 'EXECUTE'), 'anonymous users cannot read usage detail');

insert into auth.users (id, email) values
  ('1c000000-0000-4000-8000-000000000001', 'usage-owner@sohee.test.invalid'),
  ('1c000000-0000-4000-8000-000000000002', 'usage-outsider@sohee.test.invalid');

insert into public.workspaces (id, name, created_by)
values ('2c000000-0000-4000-8000-000000000001', '사용량 상세 검증', '1c000000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('2c000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'owner', 'active')
on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status;

insert into public.conversation_threads (id, workspace_id, kind, title, status, last_message_at)
values ('3c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-000000000001', 'operations', '사용량 상세', 'active', statement_timestamp());

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.messages (
  workspace_id, thread_id, role, content, status, client_message_id, created_by_user_id, completed_at
) values (
  '2c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000001',
  'user', '이미지 한 장 생성', 'completed', '4c000000-0000-4000-8000-000000000001',
  '1c000000-0000-4000-8000-000000000001', statement_timestamp()
);

select lives_ok(
  $$select public.enqueue_conversation_job(
    '2c000000-0000-4000-8000-000000000001',
    '3c000000-0000-4000-8000-000000000001',
    '1c000000-0000-4000-8000-000000000001',
    '4c000000-0000-4000-8000-000000000001',
    '이미지 한 장 생성', '이미지 한 장 생성', 'image_generation', 45,
    '5c000000-0000-4000-8000-000000000001'
  )$$,
  'usage fixture reserves credits through the authoritative queue path'
);

insert into public.ai_usage_events (
  workspace_id, job_id, message_id, provider, model, operation,
  provider_request_id, provider_call_key, text_input_tokens,
  cached_text_input_tokens, text_output_tokens, image_input_tokens,
  image_output_tokens, provider_total_tokens, usage_source,
  policy_version, computed_credits
) select
  job.workspace_id, job.id, job.assistant_message_id, 'openai', 'gpt-image-2',
  'image_generation', 'img_usage_detail', 'usage-detail:image:1', 1438, 0, 0, 0, 1372, 3689,
  'actual', 'v08-test-2000-1', 11
from public.conversation_jobs job
where job.workspace_id = '2c000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.settle_credit_reservation(
    '2c000000-0000-4000-8000-000000000001',
    '5c000000-0000-4000-8000-000000000001',
    11,
    '6c000000-0000-4000-8000-000000000001'
  )$$,
  'usage fixture settles actual credits and releases the unused reservation'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '1c000000-0000-4000-8000-000000000001', true);

select is((select operation from public.get_workspace_credit_usage_detail('2c000000-0000-4000-8000-000000000001', 20)), 'image_generation', 'detail returns the provider operation');
select is((select image_output_tokens from public.get_workspace_credit_usage_detail('2c000000-0000-4000-8000-000000000001', 20)), 1372, 'detail returns actual image output tokens');
select is((select requested_credits from public.get_workspace_credit_usage_detail('2c000000-0000-4000-8000-000000000001', 20)), 45, 'detail returns the reserved amount');
select is((select settled_credits from public.get_workspace_credit_usage_detail('2c000000-0000-4000-8000-000000000001', 20)), 11, 'detail returns the settled amount');
select is((select released_credits from public.get_workspace_credit_usage_detail('2c000000-0000-4000-8000-000000000001', 20)), 34, 'detail returns the released amount');

select set_config('request.jwt.claim.sub', '1c000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select * from public.get_workspace_credit_usage_detail('2c000000-0000-4000-8000-000000000001', 20)$$,
  'P0001', 'CREDIT_FORBIDDEN',
  'outsider cannot read workspace usage detail'
);

select * from finish();
rollback;
