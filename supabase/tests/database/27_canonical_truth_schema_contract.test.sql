-- Migration Contract Test: 27_canonical_truth_schema_contract.test.sql
-- linear issue: ANI-1015, ANI-1016, ANI-1028

begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

-- 1. Verify agent_sessions relation and essential columns
select has_table('public', 'agent_sessions', 'public.agent_sessions exists');
select has_column('public', 'agent_sessions', 'session_id', 'agent_sessions.session_id exists');
select has_column('public', 'agent_sessions', 'workspace_id', 'agent_sessions.workspace_id exists');
select has_column('public', 'agent_sessions', 'thread_id', 'agent_sessions.thread_id exists');

-- 2. Verify conversation_threads model_profile column
select has_column('public', 'conversation_threads', 'model_profile', 'conversation_threads.model_profile exists');

-- 3. Verify agent_runs, agent_run_steps, agent_memories tables
select has_table('public', 'agent_runs', 'public.agent_runs exists');
select has_table('public', 'agent_run_steps', 'public.agent_run_steps exists');
select has_table('public', 'agent_memories', 'public.agent_memories exists');

-- 4. Verify external_action_requests constraints accept Meta channels and actions
select col_has_check('public', 'external_action_requests', 'channel', 'external_action_requests.channel check constraint exists');
select col_has_check('public', 'external_action_requests', 'action_kind', 'external_action_requests.action_kind check constraint exists');

-- 5. Test inserting instagram and threads channels into external_action_requests (rolled back)
prepare test_action_req_meta as
  insert into public.external_action_requests (
    workspace_id,
    channel,
    action_kind,
    exact_payload,
    status
  ) values (
    '00000000-0000-0000-0000-000000000000'::uuid,
    'instagram',
    'feed_publish',
    '{"test": true}'::jsonb,
    'REQUESTED'
  );
select lives_ok('test_action_req_meta', 'external_action_requests accepts channel=instagram and action_kind=feed_publish');

prepare test_action_req_threads as
  insert into public.external_action_requests (
    workspace_id,
    channel,
    action_kind,
    exact_payload,
    status
  ) values (
    '00000000-0000-0000-0000-000000000000'::uuid,
    'threads',
    'thread_publish',
    '{"test": true}'::jsonb,
    'REQUESTED'
  );
select lives_ok('test_action_req_threads', 'external_action_requests accepts channel=threads and action_kind=thread_publish');

select * from finish();
rollback;
