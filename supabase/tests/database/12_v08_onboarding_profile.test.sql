begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

select has_table('public', 'onboarding_sessions', 'onboarding sessions exist');
select has_table('public', 'onboarding_answers', 'onboarding answers exist');
select has_table('public', 'workspace_profile_candidates', 'workspace profile candidates exist');
select has_function('public', 'start_v08_onboarding', array['uuid'], 'onboarding start RPC exists');
select has_function(
  'public',
  'save_v08_onboarding_answer',
  array['uuid', 'uuid', 'text', 'text', 'uuid', 'jsonb'],
  'onboarding answer RPC exists'
);
select has_function(
  'public',
  'review_v08_profile_candidate',
  array['uuid', 'uuid', 'text', 'text', 'integer'],
  'profile review RPC exists'
);
select has_function(
  'public',
  'restart_v08_onboarding',
  array['uuid', 'uuid', 'uuid'],
  'onboarding restart RPC exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.onboarding_sessions'::regclass),
  'onboarding session RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.onboarding_answers'::regclass),
  'onboarding answer RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspace_profile_candidates'::regclass),
  'workspace profile candidate RLS is enabled'
);
select function_privs_are(
  'public', 'start_v08_onboarding', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated users can start onboarding'
);
select function_privs_are(
  'public', 'start_v08_onboarding', array['uuid'], 'anon', array[]::text[],
  'anonymous users cannot start onboarding'
);
select function_privs_are(
  'public', 'review_v08_profile_candidate',
  array['uuid', 'uuid', 'text', 'text', 'integer'],
  'authenticated', array['EXECUTE'],
  'authenticated users can call the guarded review RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.onboarding_sessions', 'INSERT'),
  'authenticated users cannot forge onboarding sessions directly'
);

insert into auth.users (id, email)
values
  ('18000000-0000-4000-8000-000000000001', 'v08-onboarding-a@sohee.test.invalid'),
  ('18000000-0000-4000-8000-000000000002', 'v08-onboarding-b@sohee.test.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);

insert into public.workspaces (id, name, created_by)
values (
  '28000000-0000-4000-8000-000000000001',
  '가입 작업공간 A',
  '18000000-0000-4000-8000-000000000001'
);

select lives_ok(
  $$select public.start_v08_onboarding('38000000-0000-4000-8000-000000000001')$$,
  'an authenticated owner can start onboarding'
);
select is(
  (
    select count(*)::integer
    from public.onboarding_sessions
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and user_id = '18000000-0000-4000-8000-000000000001'
  ),
  1,
  'start reuses the active workspace and creates one session'
);
select is(
  (
    select count(*)::integer
    from public.conversation_threads
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and kind = 'onboarding'
  ),
  1,
  'start creates a preserved onboarding thread'
);
select lives_ok(
  $$select public.start_v08_onboarding('38000000-0000-4000-8000-000000000002')$$,
  'starting again is idempotent for the authenticated user'
);
select is(
  (
    select count(*)::integer
    from public.onboarding_sessions
    where user_id = '18000000-0000-4000-8000-000000000001'
  ),
  1,
  'an idempotent start does not duplicate the session'
);

select lives_ok(
  $$select public.save_v08_onboarding_answer(
      '28000000-0000-4000-8000-000000000001',
      (select id from public.onboarding_sessions where user_id = '18000000-0000-4000-8000-000000000001'),
      'business_identity',
      '청라에서 자연눈썹 시술을 운영해요.',
      '48000000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )$$,
  'the answer can be persisted before extraction succeeds'
);
select lives_ok(
  $$select public.save_v08_onboarding_answer(
      '28000000-0000-4000-8000-000000000001',
      (select id from public.onboarding_sessions where user_id = '18000000-0000-4000-8000-000000000001'),
      'business_identity',
      '청라에서 자연눈썹 시술을 운영해요.',
      '48000000-0000-4000-8000-000000000001',
      '{"key":"business_identity","value":"청라 지역 자연눈썹 시술 서비스","confidence":0.92,"evidenceQuote":"청라에서 자연눈썹 시술을 운영해요.","source":"onboarding_answer"}'::jsonb
    )$$,
  'the idempotent answer can receive a later extraction candidate'
);
select is(
  (select count(*)::integer from public.onboarding_answers where workspace_id = '28000000-0000-4000-8000-000000000001'),
  1,
  'a retried answer request stores one answer'
);
select is(
  (
    select count(*)::integer
    from public.workspace_profile_candidates
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and status = 'review_required'
  ),
  1,
  'extraction creates one review candidate'
);
select is(
  (select count(*)::integer from public.workspace_profile_candidates where status = 'active'),
  0,
  'unreviewed candidates are never active'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$select public.start_v08_onboarding('38000000-0000-4000-8000-000000000003')$$,
  'a new user can atomically provision a placeholder workspace and onboarding'
);
select is(
  (
    select count(*)::integer
    from public.workspace_members
    where user_id = '18000000-0000-4000-8000-000000000002'
      and role = 'owner'
      and status = 'active'
  ),
  1,
  'placeholder provisioning makes the new user its owner'
);
select is(
  (select count(*)::integer from public.onboarding_sessions),
  1,
  'user B can read only their own onboarding session'
);
select is(
  (select count(*)::integer from public.workspace_profile_candidates),
  0,
  'user B cannot read user A profile candidates'
);
select throws_ok(
  $$select public.review_v08_profile_candidate(
      '28000000-0000-4000-8000-000000000001',
      '58000000-0000-4000-8000-000000000001',
      'approved',
      '다른 사용자의 값',
      0
    )$$,
  '42501',
  'WORKSPACE_ROLE_REQUIRED',
  'another workspace user cannot review the candidate'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.review_v08_profile_candidate(
      '28000000-0000-4000-8000-000000000001',
      (
        select id from public.workspace_profile_candidates
        where workspace_id = '28000000-0000-4000-8000-000000000001'
          and profile_key = 'business_identity'
      ),
      'approved',
      '청라 지역 자연눈썹 시술 서비스',
      0
    )$$,
  'an owner can activate the reviewed profile value'
);
select is(
  (
    select count(*)::integer
    from public.knowledge_facts
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and category = 'business_identity'
      and status = 'active'
  ),
  1,
  'approved profile value becomes one active knowledge fact'
);
select throws_ok(
  $$select public.review_v08_profile_candidate(
      '28000000-0000-4000-8000-000000000001',
      (
        select id from public.workspace_profile_candidates
        where workspace_id = '28000000-0000-4000-8000-000000000001'
          and profile_key = 'business_identity'
      ),
      'approved',
      '오래된 확정값',
      0
    )$$,
  '40001',
  'STALE_PROFILE_CANDIDATE',
  'a stale expected version cannot overwrite an approved profile value'
);

select lives_ok(
  $$do $complete$
    declare
      v_profile_key text;
      request_id uuid;
      candidate_id uuid;
    begin
      foreach v_profile_key in array array[
        'primary_offering', 'primary_audience', 'marketing_goal',
        'approval_policy', 'channel_presence'
      ] loop
        request_id := gen_random_uuid();
        perform public.save_v08_onboarding_answer(
          '28000000-0000-4000-8000-000000000001',
          (select id from public.onboarding_sessions where user_id = '18000000-0000-4000-8000-000000000001'),
          v_profile_key,
          v_profile_key || ' 사용자 원문',
          request_id,
          jsonb_build_object(
            'key', v_profile_key,
            'value', v_profile_key || ' 확정 값',
            'confidence', 0.9,
            'evidenceQuote', v_profile_key || ' 사용자 원문',
            'source', 'onboarding_answer'
          )
        );
        select id into candidate_id
        from public.workspace_profile_candidates
        where workspace_id = '28000000-0000-4000-8000-000000000001'
          and profile_key = v_profile_key
          and status = 'review_required'
        order by created_at desc
        limit 1;
        perform public.review_v08_profile_candidate(
          '28000000-0000-4000-8000-000000000001',
          candidate_id,
          'approved',
          v_profile_key || ' 확정 값',
          0
        );
      end loop;
    end
  $complete$;$$,
  'approving all remaining required profile keys completes onboarding'
);
select is(
  (
    select status
    from public.onboarding_sessions
    where workspace_id = '28000000-0000-4000-8000-000000000001'
  ),
  'completed',
  'the session completes only after all required profile keys are active'
);
select is(
  (
    select count(*)::integer
    from public.workspace_profile_candidates
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  6,
  'all six approved profile candidates remain active'
);
select is(
  (
    select count(*)::integer
    from public.knowledge_facts
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and category in (
        'business_identity', 'primary_offering', 'primary_audience',
        'marketing_goal', 'approval_policy', 'channel_presence'
      )
      and status = 'active'
  ),
  6,
  'all six approved profile values are active knowledge facts'
);
select is(
  (
    select count(*)::integer
    from public.operation_events
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and event_type in (
        'onboarding.started', 'onboarding.profile_reviewed', 'onboarding.completed'
      )
  ),
  8,
  'start, six reviews, and completion emit idempotent operation events'
);

select lives_ok(
  $$select public.restart_v08_onboarding(
      '28000000-0000-4000-8000-000000000001',
      (select id from public.onboarding_sessions where workspace_id = '28000000-0000-4000-8000-000000000001'),
      '68000000-0000-4000-8000-000000000001'
    )$$,
  'an owner can restart the review without deleting approved knowledge'
);
select is(
  (
    select status || ':' || active_step
    from public.onboarding_sessions
    where workspace_id = '28000000-0000-4000-8000-000000000001'
  ),
  'in_progress:business_identity',
  'restart returns the session to the first question'
);
select is(
  (
    select count(*)::integer
    from public.workspace_profile_candidates
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  0,
  'restart moves prior profile candidates out of the active review cycle'
);
select is(
  (
    select count(*)::integer
    from public.knowledge_facts
    where workspace_id = '28000000-0000-4000-8000-000000000001'
      and category in (
        'business_identity', 'primary_offering', 'primary_audience',
        'marketing_goal', 'approval_policy', 'channel_presence'
      )
      and status = 'active'
  ),
  6,
  'restart preserves all approved knowledge facts until replacements are approved'
);

select * from finish();
rollback;
