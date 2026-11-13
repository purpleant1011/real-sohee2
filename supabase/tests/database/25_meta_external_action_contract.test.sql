begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- 1. Verify covering indexes exist
select has_index('public', 'external_action_requests', 'idx_external_action_requests_ws_channel_status', 'covering index on requests(workspace_id, channel, status, created_at desc) exists');
select has_index('public', 'external_action_attempts', 'idx_external_action_attempts_ws_request_status', 'covering index on attempts(workspace_id, action_request_id, status) exists');
select has_index('public', 'external_action_receipts', 'idx_external_action_receipts_ws_request_kind', 'covering index on receipts(workspace_id, action_request_id, receipt_kind, recorded_at desc) exists');

-- 2. Verify constraints
select col_has_check('public', 'external_action_requests', 'channel', 'external_action_requests.channel has check constraint');
select col_has_check('public', 'external_action_requests', 'action_kind', 'external_action_requests.action_kind has check constraint');
select col_has_check('public', 'external_action_requests', 'exact_payload', 'external_action_requests.exact_payload has check constraint');
select col_has_check('public', 'external_action_receipts', 'observed_payload', 'external_action_receipts.observed_payload has check constraint');

select * from finish();
rollback;
