begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'platform_audit_events', 'platform audit ledger exists');
select has_table('public', 'admin_approval_requests', 'administrator approval requests exist');
select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('public.platform_audit_events')),
  'platform audit ledger has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('public.admin_approval_requests')),
  'administrator approval requests have RLS enabled'
);

select has_function(
  'public', 'request_admin_approval',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'jsonb'],
  'request RPC has the exact eight argument signature'
);
select ok(
  not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'request_admin_approval'
      and pronargs <> 8
  ),
  'request RPC has no legacy expiry overload'
);
select function_returns(
  'public', 'request_admin_approval',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'jsonb'],
  'jsonb', 'request RPC returns jsonb'
);
select function_returns(
  'public', 'approve_admin_approval_request', array['uuid'], 'jsonb',
  'approve RPC has the exact uuid to jsonb contract'
);
select has_function(
  'private', 'require_current_operator_aal2_actor', array[]::text[],
  'private current actor and AAL2 helper exists'
);
select has_function(
  'private', 'append_platform_audit_event',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'jsonb', 'text', 'text', 'uuid', 'jsonb'],
  'private audit append helper has the fixed signature'
);
select has_function(
  'private', 'mark_admin_approval_applied', array['uuid', 'jsonb', 'text'],
  'private applied marker has the fixed signature'
);
select has_function(
  'private', 'lock_platform_owner_quorum', array[]::text[],
  'private owner quorum lock helper exists for request, approve, and later role mutations'
);
select hasnt_function(
  'public', 'apply_admin_approval', array['uuid'],
  'no public generic approval apply function exists'
);
select hasnt_function(
  'public', 'execute_admin_action', array['uuid', 'jsonb'],
  'no public generic JSON interpreter exists'
);

select function_privs_are(
  'public', 'request_admin_approval',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'jsonb'],
  'authenticated', array['EXECUTE'],
  'authenticated operators may call request RPC'
);
select function_privs_are(
  'public', 'request_admin_approval',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'jsonb'],
  'public', array[]::text[], 'PUBLIC cannot call request RPC'
);
select function_privs_are(
  'public', 'request_admin_approval',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'jsonb'],
  'anon', array[]::text[], 'anonymous users cannot call request RPC'
);
select function_privs_are(
  'public', 'approve_admin_approval_request', array['uuid'],
  'authenticated', array['EXECUTE'],
  'authenticated operators may call approve RPC'
);
select function_privs_are(
  'public', 'approve_admin_approval_request', array['uuid'],
  'public', array[]::text[], 'PUBLIC cannot call approve RPC'
);
select function_privs_are(
  'public', 'approve_admin_approval_request', array['uuid'],
  'anon', array[]::text[], 'anonymous users cannot call approve RPC'
);
select function_privs_are(
  'public', 'approve_admin_approval_request', array['uuid'],
  'service_role', array[]::text[], 'service role cannot call approve RPC'
);
select function_privs_are(
  'public', 'request_admin_approval',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'bigint', 'jsonb'],
  'service_role', array[]::text[],
  'service role cannot call the authenticated request wrapper'
);
select function_privs_are(
  'private', 'require_current_operator_aal2_actor', array[]::text[],
  'service_role', array[]::text[],
  'service role cannot call the private AAL2 helper directly'
);
select function_privs_are(
  'private', 'append_platform_audit_event',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'jsonb', 'text', 'text', 'uuid', 'jsonb'],
  'service_role', array[]::text[],
  'service role cannot call the private audit helper directly'
);
select function_privs_are(
  'private', 'mark_admin_approval_applied', array['uuid', 'jsonb', 'text'],
  'service_role', array[]::text[],
  'service role cannot call the private applied marker directly'
);
select function_privs_are(
  'private', 'lock_platform_owner_quorum', array[]::text[],
  'service_role', array[]::text[],
  'service role cannot call the private owner quorum lock helper directly'
);
select ok(
  not exists (
    select 1
    from (
      values
        ('require_current_operator_aal2_actor', array[]::text[]),
        ('append_platform_audit_event', array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'jsonb', 'text', 'text', 'uuid', 'jsonb']::text[]),
        ('mark_admin_approval_applied', array['uuid', 'jsonb', 'text']::text[]),
        ('lock_platform_owner_quorum', array[]::text[])
    ) as helpers(function_name, argument_types),
    (values ('public'), ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
    where has_function_privilege(
      roles.role_name,
      format('private.%I(%s)', helpers.function_name, array_to_string(helpers.argument_types, ',')),
      'EXECUTE'
    )
  ),
  'every fixed private helper denies direct execute to all session roles'
);
select ok(
  not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname ~* '(apply|execute|mutate).*(admin|approval)|(admin|approval).*(apply|execute|mutate)'
  ),
  'pg_proc contains no public generic apply, execute, or mutate overload'
);
select ok(
  not exists (
    select 1
    from pg_proc
    where oid in (
      'public.request_admin_approval(uuid,text,text,text,text,text,bigint,jsonb)'::regprocedure,
      'public.approve_admin_approval_request(uuid)'::regprocedure,
      'private.require_current_operator_aal2_actor()'::regprocedure,
      'private.append_platform_audit_event(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb,text,text,uuid,jsonb)'::regprocedure,
      'private.mark_admin_approval_applied(uuid,jsonb,text)'::regprocedure,
      'private.lock_platform_owner_quorum()'::regprocedure
    )
      and (not prosecdef or not coalesce(proconfig, '{}'::text[]) @> array['search_path=""'])
  ),
  'every Task 3 definer function has an empty search path'
);

select ok(
  not exists (
    select 1
    from (values ('platform_audit_events'), ('admin_approval_requests')) as tables(name),
         (values ('INSERT'), ('UPDATE'), ('DELETE')) as privileges(name)
    where has_table_privilege('authenticated', 'public.' || tables.name, privileges.name)
       or has_table_privilege('anon', 'public.' || tables.name, privileges.name)
  ),
  'anon and authenticated have no direct write privilege on Task 3 tables'
);
select col_is_unique(
  'public', 'platform_audit_events', array['idempotency_key'],
  'audit idempotency keys are globally unique'
);
select col_is_unique(
  'public', 'admin_approval_requests', array['idempotency_key'],
  'approval request idempotency keys are globally unique'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.platform_audit_events'::regclass
      and contype = 'f'
      and confrelid = 'public.admin_approval_requests'::regclass
      and confdeltype <> 'c'
  ),
  'audit approval foreign key never cascades deletion'
);
select ok(
  not has_table_privilege('service_role', 'public.platform_audit_events', 'INSERT'),
  'service role cannot insert audit rows directly'
);

insert into auth.users (id, email)
values
  ('93000000-0000-4000-8000-000000000001', 'task3-owner-one@sohee.test.invalid'),
  ('93000000-0000-4000-8000-000000000002', 'task3-owner-two@sohee.test.invalid'),
  ('93000000-0000-4000-8000-000000000003', 'task3-scoped-requester@sohee.test.invalid'),
  ('93000000-0000-4000-8000-000000000004', 'task3-disabled@sohee.test.invalid'),
  ('93000000-0000-4000-8000-000000000005', 'task3-outsider@sohee.test.invalid'),
  ('93000000-0000-4000-8000-000000000006', 'task3-billing@sohee.test.invalid'),
  ('93000000-0000-4000-8000-000000000007', 'task3-auditor@sohee.test.invalid'),
  ('93000000-0000-4000-8000-000000000008', 'task3-scoped-owner@sohee.test.invalid'),
  ('93000000-0000-4000-8000-000000000009', 'task3-owner-three@sohee.test.invalid');

insert into public.workspaces (id, name, created_by)
values
  ('93000000-0000-4000-8000-000000000101', 'Task 3 workspace A', '93000000-0000-4000-8000-000000000001'),
  ('93000000-0000-4000-8000-000000000102', 'Task 3 workspace B', '93000000-0000-4000-8000-000000000001');

insert into public.platform_admin_members (user_id, status, mfa_required)
values
  ('93000000-0000-4000-8000-000000000001', 'active', true),
  ('93000000-0000-4000-8000-000000000002', 'active', true),
  ('93000000-0000-4000-8000-000000000003', 'active', true),
  ('93000000-0000-4000-8000-000000000004', 'disabled', true),
  ('93000000-0000-4000-8000-000000000006', 'active', true),
  ('93000000-0000-4000-8000-000000000007', 'active', true),
  ('93000000-0000-4000-8000-000000000008', 'active', true),
  ('93000000-0000-4000-8000-000000000009', 'active', true);

insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id)
values
  ('93000000-0000-4000-8000-000000000001', 'platform_owner', null),
  ('93000000-0000-4000-8000-000000000003', 'operations_admin', '93000000-0000-4000-8000-000000000101'),
  ('93000000-0000-4000-8000-000000000004', 'platform_owner', null),
  ('93000000-0000-4000-8000-000000000006', 'billing_admin', '93000000-0000-4000-8000-000000000101'),
  ('93000000-0000-4000-8000-000000000007', 'audit_viewer', null),
  ('93000000-0000-4000-8000-000000000008', 'platform_owner', '93000000-0000-4000-8000-000000000101');

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'verify agreement', repeat('1', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'OWNER_QUORUM_REQUIRED',
  'one active all-scope owner cannot create a request'
);
reset role;
select is((select count(*)::integer from public.admin_approval_requests), 0, 'quorum denial leaves request rows unchanged');
select is((select count(*)::integer from public.platform_audit_events), 0, 'quorum denial leaves audit rows unchanged');

insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id)
values
  ('93000000-0000-4000-8000-000000000002', 'platform_owner', null),
  ('93000000-0000-4000-8000-000000000009', 'platform_owner', null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'verify agreement', repeat('2', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'MFA_REQUIRED', 'aal1 is rejected'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"AAL2"}',
  true
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'verify agreement', repeat('3', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'MFA_REQUIRED', 'uppercase AAL2 is rejected'
);
select set_config('request.jwt.claim.aal', 'aal2', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'verify agreement', repeat('4', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'MFA_REQUIRED', 'a separate aal setting is not AAL2 evidence'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'verify agreement', repeat('5', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'AUTH_REQUIRED', 'claims subject mismatch is mapped to a safe auth error'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

create temporary table task3_first_result(result jsonb) on commit drop;
insert into task3_first_result(result)
select public.request_admin_approval(
  '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
  '93000000-0000-4000-8000-000000000401', '  verify agreement  ', repeat('a', 64), 1, '{}'::jsonb
);

reset role;
select is((select count(*)::integer from public.admin_approval_requests), 1, 'a valid request inserts one pending row');
select is((select count(*)::integer from public.platform_audit_events), 1, 'a valid request inserts one requested audit row');
select is(
  (select status from public.admin_approval_requests where id = ((select result ->> 'approval_request_id' from task3_first_result)::uuid)),
  'pending', 'request stores pending status'
);
select is(
  (select expires_at - requested_at from public.admin_approval_requests where id = ((select result ->> 'approval_request_id' from task3_first_result)::uuid)),
  interval '24 hours', 'the database stores an exact 24 hour immutable expiry'
);
set local role authenticated;
select is(
  public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'verify agreement', repeat('a', 64), 1, '{}'::jsonb
  ),
  (select result from task3_first_result),
  'same key and semantic request returns the first result exactly'
);
reset role;
select is((select count(*)::integer from public.admin_approval_requests), 1, 'identical retry leaves one request row');
select is((select count(*)::integer from public.platform_audit_events), 1, 'identical retry leaves one audit row');
select ok(
  exists (
    select 1
    from pg_locks,
    lateral (
      select pg_catalog.hashtextextended('admin-approval:' || repeat('a', 64), 0)::bigint as lock_key
    ) as expected
    where locktype = 'advisory'
      and pid = pg_backend_pid()
      and classid = ((expected.lock_key >> 32) & 4294967295)::oid
      and objid = (expected.lock_key & 4294967295)::oid
      and objsubid = 1
  ),
  'idempotent requests hold the exact key-specific transaction advisory lock'
);
select ok(
  exists (
    select 1
    from pg_locks,
    lateral (
      select pg_catalog.hashtextextended('platform-owner-quorum', 0)::bigint as lock_key
    ) as expected
    where locktype = 'advisory'
      and pid = pg_backend_pid()
      and classid = ((expected.lock_key >> 32) & 4294967295)::oid
      and objid = (expected.lock_key & 4294967295)::oid
      and objsubid = 1
  ),
  'request holds the exact shared owner quorum transaction advisory lock'
);
set local role authenticated;
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'different meaning', repeat('a', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_CONFLICT',
  'same key with different semantics conflicts without mutation'
);
reset role;
select is((select count(*)::integer from public.admin_approval_requests), 1, 'idempotency conflict preserves the original row');
select is((select count(*)::integer from public.platform_audit_events), 1, 'idempotency conflict preserves the original audit');

savepoint task3_audit_append_failure;
create or replace function private.append_platform_audit_event(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_request_id text,
  p_result text,
  p_before jsonb,
  p_after jsonb,
  p_idempotency_key text,
  p_fact_kind text,
  p_approval_request_id uuid,
  p_actor_role_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'INJECTED_AUDIT_APPEND_FAILURE';
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000405', 'rollback on audit failure', repeat('4', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'AUDIT_WRITE_UNAVAILABLE',
  'injected audit append failure returns a safe error'
);
reset role;
select is((select count(*)::integer from public.admin_approval_requests), 1, 'audit append failure rolls back the pending request');
select is((select count(*)::integer from public.platform_audit_events), 1, 'audit append failure leaves the audit ledger unchanged');
rollback to savepoint task3_audit_append_failure;

set local role authenticated;
savepoint task3_semantic_fingerprint_tests;
create temporary table task3_credit_result(result jsonb) on commit drop;
insert into task3_credit_result(result)
select public.request_admin_approval(
  '93000000-0000-4000-8000-000000000101', 'credit.adjust', 'credit_account',
  '93000000-0000-4000-8000-000000000403', 'credit correction', repeat('9', 64), 3,
  '{"direction":"credit","amount":10,"reason_code":"service_recovery"}'::jsonb
);
select is(
  public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'credit.adjust', 'credit_account',
    '93000000-0000-4000-8000-000000000403', 'credit correction', repeat('9', 64), 3,
    '{"reason_code":"service_recovery","amount":10,"direction":"credit"}'::jsonb
  ),
  (select result from task3_credit_result),
  'JSON key order replays the same semantic request'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000102', 'credit.adjust', 'credit_account',
    '93000000-0000-4000-8000-000000000403', 'credit correction', repeat('9', 64), 3,
    '{"direction":"credit","amount":10,"reason_code":"service_recovery"}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'workspace participates in semantic fingerprint'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000403', 'credit correction', repeat('9', 64), 3, '{}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'action and catalog target type participate in semantic fingerprint'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'credit.adjust', 'credit_account',
    '93000000-0000-4000-8000-000000000404', 'credit correction', repeat('9', 64), 3,
    '{"direction":"credit","amount":10,"reason_code":"service_recovery"}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'target id participates in semantic fingerprint'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'credit.adjust', 'credit_account',
    '93000000-0000-4000-8000-000000000403', 'different reason', repeat('9', 64), 3,
    '{"direction":"credit","amount":10,"reason_code":"service_recovery"}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'normalized reason participates in semantic fingerprint'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'credit.adjust', 'credit_account',
    '93000000-0000-4000-8000-000000000403', 'credit correction', repeat('9', 64), 4,
    '{"direction":"credit","amount":10,"reason_code":"service_recovery"}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'expected version participates in semantic fingerprint'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'credit.adjust', 'credit_account',
    '93000000-0000-4000-8000-000000000403', 'credit correction', repeat('9', 64), 3,
    '{"direction":"credit","amount":11,"reason_code":"service_recovery"}'::jsonb
  )$$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'validated payload participates in semantic fingerprint'
);
rollback to savepoint task3_semantic_fingerprint_tests;

select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'unknown.action', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'invalid', repeat('b', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'unknown actions use one safe validation error'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000199', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'unknown workspace', repeat('7', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'unknown workspace input cannot expose a foreign key error'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'wrong_target',
    '93000000-0000-4000-8000-000000000401', 'invalid', repeat('c', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'target mismatch is rejected before lookup'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'publish.retry', 'publish_attempt',
    '93000000-0000-4000-8000-000000000402', 'invalid', repeat('d', 64), 1,
    '{"retry_mode":"post"}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'publish retry accepts only no_post payload'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'credit.adjust', 'credit_account',
    '93000000-0000-4000-8000-000000000403', 'invalid', repeat('e', 64), 1,
    '{"direction":"credit","amount":100001,"reason_code":"manual_promotion"}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'credit adjustment bounds are closed'
);
select throws_ok(
  $$select public.request_admin_approval(
    null, 'audit.export.global', 'platform_audit_export',
    '93000000-0000-4000-8000-000000000404', 'invalid', repeat('f', 64), 1,
    '{"from":"2026-08-01T00:00:00.000Z","to":"2026-08-02T00:00:00.000Z","format":"csv"}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'audit export rejects expected version'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'audit.export.workspace', 'platform_audit_export',
    '93000000-0000-4000-8000-000000000404', 'invalid', repeat('f', 64), 1,
    '{"from":"2026-08-01T00:00:00.000Z","to":"2026-08-02T00:00:00.000Z","format":"csv"}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'workspace audit export also requires null expected version'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'invalid', repeat('0', 64), 1,
    '{"nested":{"access-token":"secret"}}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'nested normalized sensitive keys are rejected before storage'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'sk-proj-projectsecretvalue', repeat('2', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'generic sk-proj values are rejected before persistence'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401',
    'https://example.com/invite?invite_link=private', repeat('3', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'AUDIT_INPUT_INVALID', 'invite and recovery URLs are rejected before persistence'
);
reset role;
select is(
  private.admin_audit_value_is_safe(to_jsonb('sk-proj-projectsecretvalue'::text)),
  false, 'SQL input validation rejects generic sk-proj credentials'
);
select is(
  private.admin_audit_value_is_safe(to_jsonb('sk-genericsecretvalue'::text)),
  false, 'SQL input validation rejects generic sk credentials'
);
select is(
  private.admin_audit_value_is_safe(to_jsonb('https://example.com/invite?invite_link=private'::text)),
  false, 'SQL input validation rejects invite link query credentials'
);
select is(
  private.admin_audit_value_is_safe(to_jsonb('https://example.com/recovery#recovery_code=private'::text)),
  false, 'SQL input validation rejects recovery code fragments'
);
select is(
  private.admin_audit_value_is_safe('{"token_count":3,"secretary":"active","password_policy":"strong","invite_link_status":"ready","recovery_code_count":0}'::jsonb),
  true, 'SQL input validation preserves safe-looking non-secret keys'
);
reset role;
select is((select count(*)::integer from public.admin_approval_requests), 1, 'invalid catalog inputs create no request rows');
select is((select count(*)::integer from public.platform_audit_events), 1, 'invalid catalog inputs create no audit rows');

create temporary table task3_catalog_cases (
  actor_id uuid, action_type text, workspace_id uuid, target_type text,
  expected_version bigint, payload jsonb
) on commit drop;
insert into task3_catalog_cases values
  ('93000000-0000-4000-8000-000000000003', 'agreement.verify', '93000000-0000-4000-8000-000000000101', 'agreement', 1, '{}'),
  ('93000000-0000-4000-8000-000000000003', 'channel.disconnect', '93000000-0000-4000-8000-000000000101', 'channel_connection', 1, '{}'),
  ('93000000-0000-4000-8000-000000000003', 'publish.retry', '93000000-0000-4000-8000-000000000101', 'publish_attempt', 1, '{"retry_mode":"no_post"}'),
  ('93000000-0000-4000-8000-000000000006', 'credit.adjust', '93000000-0000-4000-8000-000000000101', 'credit_account', 1, '{"direction":"credit","amount":10,"reason_code":"service_recovery"}'),
  ('93000000-0000-4000-8000-000000000001', 'admin.role.change.workspace', '93000000-0000-4000-8000-000000000101', 'platform_admin_role_assignment', 1, '{"next_role_key":"audit_viewer"}'),
  ('93000000-0000-4000-8000-000000000001', 'admin.role.change.global', null, 'platform_admin_role_assignment', 1, '{"next_role_key":"system_admin"}'),
  ('93000000-0000-4000-8000-000000000007', 'audit.export.workspace', '93000000-0000-4000-8000-000000000101', 'platform_audit_export', null, '{"from":"2026-08-01T00:00:00.000Z","to":"2026-08-02T00:00:00.000Z","format":"csv"}'),
  ('93000000-0000-4000-8000-000000000007', 'audit.export.global', null, 'platform_audit_export', null, '{"from":"2026-08-01T00:00:00.000Z","to":"2026-08-02T00:00:00.000Z","format":"csv"}');
grant select on task3_catalog_cases to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
create temporary table task3_catalog_results(result jsonb) on commit drop;
do $$
declare
  catalog record;
begin
  for catalog in select * from task3_catalog_cases order by action_type
  loop
    perform set_config('request.jwt.claim.sub', catalog.actor_id::text, true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', catalog.actor_id, 'role', 'authenticated', 'aal', 'aal2')::text,
      true
    );
    insert into task3_catalog_results(result)
    select public.request_admin_approval(
      catalog.workspace_id,
      catalog.action_type,
      catalog.target_type,
      '93000000-0000-4000-8000-000000000499',
      'catalog request ' || catalog.action_type,
      encode(extensions.digest('task3:' || catalog.action_type, 'sha256'), 'hex'),
      catalog.expected_version,
      catalog.payload
    );
  end loop;
end;
$$;
reset role;
select is((select count(*)::integer from task3_catalog_results), 8, 'all eight closed catalog actions create requests');
select is((select count(*)::integer from public.admin_approval_requests), 9, 'catalog success adds exactly eight request rows');
select is((select count(*)::integer from public.platform_audit_events), 9, 'catalog success adds exactly eight requested audits');
select is(
  (select count(*)::integer from public.platform_audit_events where result = 'succeeded'),
  9, 'Task 3 request audits use succeeded only'
);
select is(
  (select count(*)::integer from public.platform_audit_events where result in ('failed', 'denied')),
  0, 'Task 3 creates no failed or denied audits'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000102', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'foreign workspace', repeat('6', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'WORKSPACE_SCOPE_DENIED', 'request permission must pair with the exact workspace scope'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000199', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'nonexistent workspace', repeat('6', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'WORKSPACE_SCOPE_DENIED',
  'nonexistent and foreign workspaces share the same scope denial for scoped operators'
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000102', 'agreement.verify', 'wrong_target',
    'not-a-target', 'target oracle', repeat('6', 64), 1, '{"provider_body":"hidden"}'::jsonb
  )$$,
  'P0001', 'WORKSPACE_SCOPE_DENIED',
  'target and payload validation cannot reveal anything before same-permission scope authorization'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000007', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'wrong permission', repeat('6', 64), 1, '{}'::jsonb
  )$$,
  'P0001', 'PERMISSION_DENIED',
  'an all-scope permission for another action cannot replace the catalog request permission'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}'::jsonb::text, true);
select throws_ok(
  format('select public.approve_admin_approval_request(%L::uuid)', (select result ->> 'approval_request_id' from task3_first_result)),
  'P0001', 'AUTH_REQUIRED', 'approve requires a current actor'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  format('select public.approve_admin_approval_request(%L::uuid)', (select result ->> 'approval_request_id' from task3_first_result)),
  'P0001', 'MFA_REQUIRED', 'approve requires exact current AAL2'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000004', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  format('select public.approve_admin_approval_request(%L::uuid)', (select result ->> 'approval_request_id' from task3_first_result)),
  'P0001', 'OPERATOR_DISABLED', 'disabled owners cannot approve'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  format('select public.approve_admin_approval_request(%L::uuid)', (select result ->> 'approval_request_id' from task3_first_result)),
  'P0001', 'PLATFORM_OWNER_REQUIRED', 'non-owners cannot approve'
);

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000008', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  format('select public.approve_admin_approval_request(%L::uuid)', (select result ->> 'approval_request_id' from task3_first_result)),
  'P0001', 'PLATFORM_OWNER_REQUIRED', 'workspace-scoped owners cannot approve'
);

reset role;
delete from public.platform_admin_role_assignments
where user_id = '93000000-0000-4000-8000-000000000002'
  and role_key = 'platform_owner' and workspace_id is null;
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  format('select public.approve_admin_approval_request(%L::uuid)', (select result ->> 'approval_request_id' from task3_first_result)),
  'P0001', 'PLATFORM_OWNER_REQUIRED', 'a removed owner assignment cannot approve'
);
reset role;
insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id)
values ('93000000-0000-4000-8000-000000000002', 'platform_owner', null);

select is((select count(*)::integer from public.platform_audit_events), 9, 'all approve denials create zero audit side effects');
select is(
  (select status from public.admin_approval_requests where id = ((select result ->> 'approval_request_id' from task3_first_result)::uuid)),
  'pending', 'all approve denials leave the request pending'
);

savepoint task3_approve_audit_failure;
create or replace function private.append_platform_audit_event(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_request_id text,
  p_result text,
  p_before jsonb,
  p_after jsonb,
  p_idempotency_key text,
  p_fact_kind text,
  p_approval_request_id uuid,
  p_actor_role_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'INJECTED_APPROVE_AUDIT_FAILURE';
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  format(
    'select public.approve_admin_approval_request(%L::uuid)',
    (select result ->> 'approval_request_id' from task3_first_result)
  ),
  'P0001', 'AUDIT_WRITE_UNAVAILABLE',
  'injected approve audit failure returns a safe error'
);
reset role;
select is(
  (
    select row(status, approved_by, approved_at)::text
    from public.admin_approval_requests
    where id = ((select result ->> 'approval_request_id' from task3_first_result)::uuid)
  ),
  row('pending'::text, null::uuid, null::timestamptz)::text,
  'approve audit failure rolls status and approval actor timestamps back to pending'
);
select is(
  (select count(*)::integer from public.platform_audit_events),
  9,
  'approve audit failure leaves the requested audit count unchanged'
);
rollback to savepoint task3_approve_audit_failure;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  format(
    'select public.approve_admin_approval_request(%L::uuid)',
    (select result ->> 'approval_request_id' from task3_first_result)
  ),
  'P0001', 'APPROVER_MUST_DIFFER', 'requesters cannot approve their own request'
);
reset role;
select is((select count(*)::integer from public.platform_audit_events), 9, 'self approval creates no audit row');

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
select lives_ok(
  format(
    'select public.approve_admin_approval_request(%L::uuid)',
    (select result ->> 'approval_request_id' from task3_first_result)
  ),
  'a distinct active all-scope owner at AAL2 can approve'
);
reset role;
select is(
  (select status from public.admin_approval_requests where id = ((select result ->> 'approval_request_id' from task3_first_result)::uuid)),
  'approved', 'approve transitions only the locked pending row to approved'
);
select is(
  (select approved_by from public.admin_approval_requests where id = ((select result ->> 'approval_request_id' from task3_first_result)::uuid)),
  '93000000-0000-4000-8000-000000000002'::uuid,
  'approve records the current JWT actor'
);
select is((select count(*)::integer from public.platform_audit_events), 10, 'approve and approval audit commit atomically');
select is(
  (select count(*)::integer from public.platform_audit_events where result in ('failed', 'denied')),
  0, 'successful approve still creates no failed or denied audit'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
select is(
  public.request_admin_approval(
    '93000000-0000-4000-8000-000000000101', 'agreement.verify', 'agreement',
    '93000000-0000-4000-8000-000000000401', 'verify agreement', repeat('a', 64), 1, '{}'::jsonb
  ),
  (select result from task3_first_result),
  'replay after approval returns the exact immutable first pending response JSON'
);
reset role;

reset role;
select throws_ok(
  format(
    'update public.admin_approval_requests set expires_at = expires_at + interval ''1 second'' where id = %L::uuid',
    (select result ->> 'approval_request_id' from task3_catalog_results limit 1)
  ),
  'P0001', 'APPROVAL_EXPIRY_IMMUTABLE',
  'a normal stored approval cannot have its immutable expiry changed'
);
insert into public.admin_approval_requests (
  id, workspace_id, action_type, target_type, target_id, reason, requested_by,
  status, expected_version, request_payload, result_summary,
  semantic_fingerprint, idempotency_key, requested_at, expires_at
) values (
  '93000000-0000-4000-8000-000000000299',
  '93000000-0000-4000-8000-000000000101',
  'agreement.verify', 'agreement', '93000000-0000-4000-8000-000000000498',
  'expired fixture', '93000000-0000-4000-8000-000000000001',
  'pending', 1, '{}'::jsonb, '{}'::jsonb, repeat('7', 64), repeat('8', 64),
  statement_timestamp() - interval '25 hours',
  statement_timestamp() - interval '1 hour'
);
create temporary table task3_expired_snapshot as
select * from public.admin_approval_requests
where id = '93000000-0000-4000-8000-000000000299';
grant select on task3_expired_snapshot to authenticated;
create temporary table task3_expired_audit_count as
select count(*)::integer as count from public.platform_audit_events;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  format(
    'select public.approve_admin_approval_request(%L::uuid)',
    (select id from task3_expired_snapshot)
  ),
  'P0001', 'APPROVAL_EXPIRED', 'now at or after immutable expiry is rejected'
);
reset role;
select is(
  (select row(current.*)::text from public.admin_approval_requests as current where current.id = (select id from task3_expired_snapshot)),
  (select row(snapshot.*)::text from task3_expired_snapshot as snapshot),
  'expiry denial leaves every stored approval field unchanged'
);
select is(
  (select count(*)::integer from public.platform_audit_events),
  (select count from task3_expired_audit_count),
  'expiry denial creates no audit row and does not materialize expired status'
);

reset role;
set local role service_role;
select throws_ok(
  $$insert into public.platform_audit_events (
      actor_user_id, workspace_id, action, target_type, target_id, reason,
      request_id, result, fact_kind, before, after, idempotency_key,
      approval_request_id, actor_role_snapshot
    ) values (
      '93000000-0000-4000-8000-000000000001', null,
      'agreement.verify.requested', 'agreement',
      '93000000-0000-4000-8000-000000000401', 'direct insert',
      'direct', 'succeeded', 'observed', '{}', '{}', repeat('6', 64),
      null, '{}'
    )$$,
  '42501', 'permission denied for table platform_audit_events',
  'service role cannot insert audit rows directly'
);
select throws_ok(
  $$update public.platform_audit_events set reason = 'mutated' where id = (select id from public.platform_audit_events limit 1)$$,
  '42501', 'permission denied for table platform_audit_events',
  'service role cannot update audit rows directly'
);
select throws_ok(
  $$delete from public.platform_audit_events where id = (select id from public.platform_audit_events limit 1)$$,
  '42501', 'permission denied for table platform_audit_events',
  'service role cannot delete audit rows directly'
);

reset role;
select throws_ok(
  $$update public.platform_audit_events set reason = 'mutated' where id = (select id from public.platform_audit_events limit 1)$$,
  'P0001', 'PLATFORM_AUDIT_IMMUTABLE',
  'database owner cannot update the append-only audit ledger'
);
select throws_ok(
  $$delete from public.platform_audit_events where id = (select id from public.platform_audit_events limit 1)$$,
  'P0001', 'PLATFORM_AUDIT_IMMUTABLE',
  'database owner cannot delete the append-only audit ledger'
);
select ok(
  not exists (
    select 1 from public.platform_audit_events
    where before::text ~* 'password|bearer|token|provider_body'
       or after::text ~* 'password|bearer|token|provider_body'
       or octet_length(before::text) > 16000
       or octet_length(after::text) > 16000
  ),
  'persisted audit values remain redacted and within the SQL size limit'
);

select * from finish();
rollback;
