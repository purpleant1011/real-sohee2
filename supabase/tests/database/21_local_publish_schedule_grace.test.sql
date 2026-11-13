begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_column('public', 'external_action_requests', 'scheduled_at', 'local actions store the scheduled time');
select has_column('public', 'external_action_requests', 'auto_execute_until', 'local actions store the automatic deadline');
select has_column('public', 'external_action_requests', 'reconfirmed_at', 'late execution confirmation is recorded');
select has_function('private', 'local_publish_schedule_state', array['timestamptz', 'timestamptz'], 'deterministic schedule classifier exists');
select is(private.local_publish_schedule_state('2026-08-19T05:00:00Z', '2026-08-19T05:30:00Z'), 'auto_execute', 'exactly thirty minutes still auto executes');
select is(private.local_publish_schedule_state('2026-08-19T05:00:00Z', '2026-08-19T05:30:00.001Z'), 'reconfirmation_required', 'over thirty minutes requires confirmation');
select is(private.local_publish_schedule_state('2026-08-19T05:00:00Z', '2026-08-19T04:59:59Z'), 'not_due', 'future schedules are not due');
select has_function('public', 'reconfirm_local_publish', array['uuid', 'uuid', 'uuid'], 'late publish confirmation RPC exists');

select * from finish();
rollback;
