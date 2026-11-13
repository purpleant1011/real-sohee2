begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

-- 1. Check RPC exists
select has_function(
  'public',
  'complete_channel_verification_v12',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text', 'uuid'],
  'evidence-gated verification RPC v12 exists'
);

select has_function(
  'public',
  'complete_channel_verification_v11',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text', 'uuid'],
  'backward-compatible verification RPC v11 exists'
);

-- 2. Check Index exists
select has_index(
  'public',
  'channel_verification_runs',
  'idx_channel_verification_runs_ws_request',
  'covering index on channel_verification_runs(workspace_id, action_request_id, status) exists'
);

-- 3. Check Foreign Key constraint exists
select fk_ok(
  'public', 'channel_verification_runs', array['workspace_id', 'action_request_id'],
  'public', 'external_action_requests', array['workspace_id', 'id'],
  'foreign key from channel_verification_runs to external_action_requests exists'
);

-- 4. Test Fail-Closed on missing action_request
select throws_ok(
  format(
    'select public.complete_channel_verification_v12(%L::uuid, %L, %L::uuid, %L, %L, %L, %L::uuid)',
    '10000000-0000-4000-8000-000000000001',
    'instagram',
    '99999999-9999-4999-8999-999999999999',
    'TESTCODE',
    'post_123',
    'https://instagram.com/p/123',
    '00000000-0000-4000-8000-000000000001'
  ),
  'CANONICAL_ACTION_REQUEST_NOT_FOUND',
  'RPC rejects orphan action_request_id'
);

select * from finish();
rollback;
