begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_table('public', 'operation_events', 'operation event outbox exists');
select has_column('public', 'operation_events', 'workspace_id', 'events are workspace bound');
select has_column('public', 'operation_events', 'event_type', 'event type is stored');
select has_column('public', 'operation_events', 'event_key', 'idempotency key is stored');
select has_column('public', 'operation_events', 'processed_at', 'processing checkpoint is stored');
select has_index(
  'public', 'operation_events', 'operation_events_workspace_id_event_key_key',
  'event keys are unique per workspace'
);
select has_index(
  'public', 'operation_events', 'operation_events_workspace_unprocessed_idx',
  'unprocessed events have a workspace outbox index'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.operation_events'::regclass),
  'operation event RLS is enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.operation_events', 'SELECT'),
  'authenticated members can read events through RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.operation_events', 'INSERT'),
  'authenticated users cannot forge operation events'
);
select ok(
  not has_table_privilege('anon', 'public.operation_events', 'SELECT'),
  'anonymous users cannot read operation events'
);

insert into auth.users (id, email)
values
  ('13000000-0000-4000-8000-000000000001', 'event-owner-a@sohee.test.invalid'),
  ('13000000-0000-4000-8000-000000000002', 'event-owner-b@sohee.test.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-4000-8000-000000000001', true);
insert into public.workspaces (id, name, created_by)
values (
  '23000000-0000-4000-8000-000000000001',
  '이벤트 작업공간 A',
  '13000000-0000-4000-8000-000000000001'
);

reset role;
insert into public.operation_events (
  id, workspace_id, event_type, event_key, subject_type, subject_id, payload
)
values (
  '33000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  'content.plan.created',
  'work-item:43000000-0000-4000-8000-000000000001:planned',
  'work_item',
  '43000000-0000-4000-8000-000000000001',
  '{"workItemId":"43000000-0000-4000-8000-000000000001"}'::jsonb
);

select throws_ok(
  $$insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload
    ) values (
      '23000000-0000-4000-8000-000000000001',
      'content.plan.created',
      'work-item:43000000-0000-4000-8000-000000000001:planned',
      'work_item',
      '43000000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )$$,
  '23505',
  'duplicate key value violates unique constraint "operation_events_workspace_id_event_key_key"',
  'a duplicate workspace event key is rejected'
);

select throws_ok(
  $$insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id
    ) values (
      '23000000-0000-4000-8000-000000000001',
      'unknown.event',
      'unknown:1',
      'work_item',
      '43000000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  'new row for relation "operation_events" violates check constraint "operation_events_event_type_check"',
  'an unknown event type is rejected by the database'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-4000-8000-000000000002', true);
insert into public.workspaces (id, name, created_by)
values (
  '23000000-0000-4000-8000-000000000002',
  '이벤트 작업공간 B',
  '13000000-0000-4000-8000-000000000002'
);

select is(
  (
    select count(*)::integer from public.operation_events
    where workspace_id = '23000000-0000-4000-8000-000000000001'
  ),
  0,
  'another workspace owner cannot read foreign events'
);

reset role;

insert into public.operation_events (
  workspace_id, event_type, event_key, subject_type, subject_id, payload
)
values (
  '23000000-0000-4000-8000-000000000002',
  'content.plan.created',
  'work-item:43000000-0000-4000-8000-000000000001:planned',
  'work_item',
  '43000000-0000-4000-8000-000000000001',
  '{"workItemId":"43000000-0000-4000-8000-000000000001"}'::jsonb
);

select is(
  (
    select count(*)::integer from public.operation_events
    where event_key = 'work-item:43000000-0000-4000-8000-000000000001:planned'
  ),
  2,
  'the same event key may exist independently in two workspaces'
);

select is(
  (
    select count(*)::integer
    from public.operation_events
    where processed_at is null
      and workspace_id in (
        '23000000-0000-4000-8000-000000000001',
        '23000000-0000-4000-8000-000000000002'
      )
  ),
  2,
  'new events remain available for outbox processing'
);

select * from finish();
rollback;
