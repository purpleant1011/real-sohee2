begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email) values
  ('81000000-0000-4000-8000-000000000001', 'learning-owner@sohee.test.invalid'),
  ('81000000-0000-4000-8000-000000000002', 'learning-spoofed@sohee.test.invalid'),
  ('81000000-0000-4000-8000-000000000003', 'learning-outsider@sohee.test.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);

insert into public.workspaces (id, name, created_by)
values ('82000000-0000-4000-8000-000000000001', '학습 actor 검증', '81000000-0000-4000-8000-000000000001');

select throws_ok(
  $$select public.create_performance_learning_candidate(
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000002',
    '{"metric":"saved"}'::jsonb, '{"hypothesis":"first-line"}'::jsonb,
    '{"impact":"hook"}'::jsonb, '{"stop":"two-weeks"}'::jsonb
  )$$,
  '42501', 'performance_learning_candidate_forbidden',
  'an authenticated actor cannot spoof another candidate creator'
);

create temporary table learning_actor_fixture (candidate_id uuid primary key);
insert into learning_actor_fixture (candidate_id)
select public.create_performance_learning_candidate(
  '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '{"metric":"saved"}'::jsonb, '{"hypothesis":"first-line"}'::jsonb,
  '{"impact":"hook"}'::jsonb, '{"stop":"two-weeks"}'::jsonb
);

select is(
  (select status from public.performance_learning_candidates where id = (select candidate_id from learning_actor_fixture)),
  'review_required',
  'the authenticated owner can create only a review-required candidate'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.create_performance_learning_candidate(
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000003',
    '{"metric":"saved"}'::jsonb, '{"hypothesis":"first-line"}'::jsonb,
    '{"impact":"hook"}'::jsonb, '{"stop":"two-weeks"}'::jsonb
  )$$,
  '42501', 'performance_learning_candidate_forbidden',
  'an outsider cannot create a learning candidate'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select ok(
  public.review_performance_learning_candidate(
    '82000000-0000-4000-8000-000000000001',
    (select candidate_id from learning_actor_fixture),
    'approved', 'owner reviewed the evidence', 1
  ),
  'the authenticated owner can review the self-created candidate'
);
select is(
  (select status from public.performance_learning_candidates where id = (select candidate_id from learning_actor_fixture)),
  'approved',
  'review persists the approved decision'
);
select is(
  (select decided_by from public.performance_learning_candidates where id = (select candidate_id from learning_actor_fixture)),
  '81000000-0000-4000-8000-000000000001'::uuid,
  'review retains the authenticated owner identity'
);

reset role;

select * from finish();
rollback;
