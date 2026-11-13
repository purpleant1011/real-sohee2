begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select has_function(
  'private', 'refund_interview_estimated_usage', array[]::text[],
  'interview estimated usage recovery function exists'
);

insert into auth.users (id, email) values
  ('1d000000-0000-4000-8000-000000000001', 'interview-refund-owner@sohee.test.invalid');
insert into public.workspaces (id, name, created_by)
values ('2d000000-0000-4000-8000-000000000001', '인터뷰 환불 검증', '1d000000-0000-4000-8000-000000000001');
insert into public.conversation_threads (id, workspace_id, kind, title, status, last_message_at)
values ('3d000000-0000-4000-8000-000000000001', '2d000000-0000-4000-8000-000000000001', 'operations', '인터뷰 환불', 'active', statement_timestamp());

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.messages (
  workspace_id, thread_id, role, content, status, client_message_id, created_by_user_id, completed_at
) values (
  '2d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
  'user', '캠페인을 만들어줘', 'completed', '4d000000-0000-4000-8000-000000000001',
  '1d000000-0000-4000-8000-000000000001', statement_timestamp()
);
select lives_ok(
  $$select public.enqueue_conversation_job(
    '2d000000-0000-4000-8000-000000000001', '3d000000-0000-4000-8000-000000000001',
    '1d000000-0000-4000-8000-000000000001', '4d000000-0000-4000-8000-000000000001',
    '캠페인을 만들어줘', '캠페인을 만들어줘', 'content_generation', 210,
    '5d000000-0000-4000-8000-000000000001'
  )$$,
  'fixture creates the original content-generation reservation'
);

reset role;
update public.messages message
set status = 'completed',
    content = '1 / 4 이번 게시물에서 가장 중요하게 얻고 싶은 결과는 무엇인가요?',
    completed_at = statement_timestamp(),
    usage_metadata = jsonb_build_object(
      'soheeConversationInterview', jsonb_build_object(
        'kind', 'content_interview', 'status', 'ready_to_generate', 'step', 4,
        'originalPrompt', '캠페인을 만들어줘', 'channels', jsonb_build_array('instagram'),
        'requestedImageCounts', jsonb_build_object('instagram', 3), 'answers', '{}'::jsonb,
        'referenceMediaIds', '[]'::jsonb
      )
    )
from public.conversation_jobs job
where job.id = (select id from public.conversation_jobs where workspace_id = '2d000000-0000-4000-8000-000000000001')
  and message.id = job.assistant_message_id;

update public.conversation_jobs
set status = 'succeeded', completed_at = statement_timestamp()
where workspace_id = '2d000000-0000-4000-8000-000000000001';

insert into public.ai_usage_events (
  workspace_id, job_id, message_id, provider, model, operation, provider_call_key,
  text_input_tokens, cached_text_input_tokens, text_output_tokens, image_input_tokens,
  image_output_tokens, provider_total_tokens, usage_source, policy_version, computed_credits
) select
  job.workspace_id, job.id, job.assistant_message_id, 'openai', 'gpt-image-2', 'image_generation',
  'interview-estimated-usage', 1000, 0, 0, 0, 4160, 5160,
  'estimated_missing_usage', 'v08-test-2000-1', 27
from public.conversation_jobs job
where job.workspace_id = '2d000000-0000-4000-8000-000000000001';

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select public.settle_credit_reservation(
    '2d000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000001', 27,
    '6d000000-0000-4000-8000-000000000001'
  )$$,
  'fixture reproduces the incorrect estimated settlement'
);

reset role;
select is(private.refund_interview_estimated_usage(), 1, 'recovery adjusts one matching interview job');
select is(private.refund_interview_estimated_usage(), 0, 'recovery is idempotent');
select is(
  (select amount from public.credit_ledger_entries where idempotency_key like 'v08-interview-estimate-refund:%'),
  27,
  'recovery restores the exact estimated credits'
);
select is(
  (select count(*)::integer from public.credit_ledger_entries where idempotency_key like 'v08-interview-estimate-refund:%'),
  1,
  'recovery writes one append-only adjustment row'
);
select is(
  (select count(*)::integer from public.ai_usage_events where workspace_id = '2d000000-0000-4000-8000-000000000001'),
  1,
  'recovery preserves the historical usage event'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '1d000000-0000-4000-8000-000000000001', true);

select is(
  (public.get_workspace_credit_balance('2d000000-0000-4000-8000-000000000001') ->> 'available')::integer,
  2000,
  'recovery restores the weekly ledger total without rewriting history'
);

select * from finish();
rollback;
