begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_function(
  'public', 'release_unstarted_conversation_job_credit',
  array['uuid', 'uuid', 'text'],
  'unstarted provider credit release RPC exists'
);
select ok(
  has_function_privilege('service_role', 'public.release_unstarted_conversation_job_credit(uuid,uuid,text)', 'EXECUTE'),
  'service role may release an unstarted job reservation'
);
select ok(
  not has_function_privilege('authenticated', 'public.release_unstarted_conversation_job_credit(uuid,uuid,text)', 'EXECUTE'),
  'authenticated callers cannot release job reservations directly'
);

insert into auth.users (id, email)
values ('26000000-0000-4000-8000-000000000001', 'release-owner@sohee.test.invalid');
insert into public.workspaces (id, name, created_by)
values (
  '36000000-0000-4000-8000-000000000001',
  '공급자 시작 전 반환 검증',
  '26000000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (workspace_id, user_id, role, status)
values (
  '36000000-0000-4000-8000-000000000001',
  '26000000-0000-4000-8000-000000000001',
  'owner', 'active'
)
on conflict (workspace_id, user_id) do update
set role = excluded.role, status = excluded.status;
insert into public.conversation_threads (id, workspace_id, kind, title, status, last_message_at)
values (
  '46000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000001',
  'operations', '반환 검증 대화', 'active', statement_timestamp()
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select public.enqueue_conversation_job(
    '36000000-0000-4000-8000-000000000001',
    '46000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001',
    '56000000-0000-4000-8000-000000000001',
    '표시 요청', '실행 요청', 'chat', 20,
    '66000000-0000-4000-8000-000000000001'
  )$$,
  'a job reserves credits before provider execution'
);
select is(
  public.claim_conversation_job(
    (select id from public.conversation_jobs where reservation_id = '66000000-0000-4000-8000-000000000001'),
    '76000000-0000-4000-8000-000000000001', statement_timestamp()
  ) ->> 'state',
  'claimed',
  'the worker claims the prepared job'
);
select is(
  public.release_unstarted_conversation_job_credit(
    (select id from public.conversation_jobs where reservation_id = '66000000-0000-4000-8000-000000000001'),
    '76000000-0000-4000-8000-000000000001',
    'CHAT_UNAVAILABLE'
  ),
  true,
  'a definite pre-provider failure releases the remaining reservation'
);
select is(
  (select state from public.credit_reservations where id = '66000000-0000-4000-8000-000000000001'),
  'released',
  'the reservation becomes released'
);
select is(
  (public.get_workspace_credit_balance('36000000-0000-4000-8000-000000000001') ->> 'available')::integer,
  2000,
  'all 2000 weekly credits are available after release'
);

select * from finish();
rollback;
