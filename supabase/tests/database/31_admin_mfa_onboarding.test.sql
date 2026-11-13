begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

select has_column('public', 'platform_admin_members', 'password_set_at', 'password setup timestamp exists');
select has_column('public', 'platform_admin_members', 'activated_at', 'activation timestamp exists');
select has_function('public', 'get_current_operator_setup_context', array[]::text[]);
select has_function('public', 'record_current_invited_operator_password_set', array[]::text[]);
select has_function('public', 'activate_current_invited_operator', array[]::text[]);
select ok(
  to_regprocedure('public.activate_current_invited_operator()') is null
    or not has_function_privilege('anon', 'public.activate_current_invited_operator()', 'EXECUTE')
);
select ok(
  to_regprocedure('public.activate_current_invited_operator()') is not null
    and has_function_privilege('authenticated', 'public.activate_current_invited_operator()', 'EXECUTE')
);
select ok(has_function_privilege('authenticated', 'public.get_current_operator_setup_context()', 'EXECUTE'));
select ok(has_function_privilege('authenticated', 'public.record_current_invited_operator_password_set()', 'EXECUTE'));
select ok(not has_function_privilege('anon', 'public.get_current_operator_setup_context()', 'EXECUTE'));
select ok(not has_function_privilege('anon', 'public.record_current_invited_operator_password_set()', 'EXECUTE'));
select ok(not has_function_privilege('anon', 'public.activate_current_invited_operator()', 'EXECUTE'));
select ok(not has_function_privilege('service_role', 'public.get_current_operator_setup_context()', 'EXECUTE'));
select ok(not has_function_privilege('service_role', 'public.record_current_invited_operator_password_set()', 'EXECUTE'));
select ok(not has_function_privilege('service_role', 'public.activate_current_invited_operator()', 'EXECUTE'));

insert into auth.users (id, email, email_confirmed_at)
values
  ('31000000-0000-4000-8000-000000000001', 'mfa-invited@sohee.test.invalid', null),
  ('31000000-0000-4000-8000-000000000002', 'mfa-confirmed@sohee.test.invalid', now()),
  ('31000000-0000-4000-8000-000000000003', 'mfa-active@sohee.test.invalid', now()),
  ('31000000-0000-4000-8000-000000000004', 'mfa-no-role@sohee.test.invalid', now()),
  ('31000000-0000-4000-8000-000000000005', 'mfa-confirmed-no-role@sohee.test.invalid', now()),
  ('31000000-0000-4000-8000-000000000006', 'mfa-disabled-required@sohee.test.invalid', now());

insert into public.platform_admin_members (user_id, status)
values
  ('31000000-0000-4000-8000-000000000001', 'invited'),
  ('31000000-0000-4000-8000-000000000002', 'invited'),
  ('31000000-0000-4000-8000-000000000003', 'active'),
  ('31000000-0000-4000-8000-000000000005', 'invited'),
  ('31000000-0000-4000-8000-000000000006', 'invited');

insert into public.platform_admin_role_assignments (user_id, role_key)
values
  ('31000000-0000-4000-8000-000000000002', 'operations_admin'),
  ('31000000-0000-4000-8000-000000000003', 'operations_admin'),
  ('31000000-0000-4000-8000-000000000006', 'operations_admin');

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000004', true);
select is(
  public.get_current_operator_setup_context(),
  jsonb_build_object('status', 'not_invited', 'emailConfirmed', true, 'passwordSet', false, 'hasVerifiedTotp', false, 'hasRole', false, 'currentAal', 'aal1'),
  'a user without an admin membership receives only the minimal not_invited context'
);

select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select is(
  public.get_current_operator_setup_context() ->> 'status', 'invited',
  'an invited user receives invited setup status'
);
select throws_ok(
  $$select public.record_current_invited_operator_password_set()$$,
  'P0001', 'ADMIN_SETUP_NOT_ALLOWED', 'unconfirmed invited users cannot record password setup'
);
select throws_ok(
  $$select public.activate_current_invited_operator()$$,
  'P0001', 'ADMIN_ACTIVATION_FAILED', 'an invited user without password or MFA cannot activate'
);

select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.record_current_invited_operator_password_set()$$,
  'a confirmed invited user with a role can record password setup'
);
select throws_ok(
  $$select public.activate_current_invited_operator()$$,
  'P0001', 'ADMIN_ACTIVATION_FAILED', 'AAL1 cannot activate an invited operator'
);

select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.activate_current_invited_operator()$$,
  'P0001', 'ADMIN_ACTIVATION_FAILED', 'AAL2 without a verified factor cannot activate'
);

reset role;
set local role service_role;
select ok(
  (select count(*) = 0 from public.platform_audit_events where action = 'admin.account.activated'),
  'failed activation creates no activation audit row'
);

reset role;
create function public.test_insert_verified_mfa_factor()
returns void language sql security definer set search_path = ''
as $$
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values
    ('31000000-0000-4000-8000-000000000201', '31000000-0000-4000-8000-000000000002', 'test totp', 'totp', 'verified', now(), now(), 'fixture-secret'),
    ('31000000-0000-4000-8000-000000000205', '31000000-0000-4000-8000-000000000005', 'test totp', 'totp', 'verified', now(), now(), 'fixture-secret'),
    ('31000000-0000-4000-8000-000000000206', '31000000-0000-4000-8000-000000000006', 'test totp', 'totp', 'verified', now(), now(), 'fixture-secret');
$$;
select public.test_insert_verified_mfa_factor();
drop function public.test_insert_verified_mfa_factor();

reset role;
update public.platform_admin_members set password_set_at = now()
where user_id = '31000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
select is(public.get_current_operator_setup_context(), jsonb_build_object('status', 'invited', 'emailConfirmed', true, 'passwordSet', true, 'hasVerifiedTotp', true, 'hasRole', false, 'currentAal', 'aal2'), 'confirmed invited no-role context exposes only its exact setup facts');
select is((public.get_current_operator_setup_context() ->> 'hasRole')::boolean, false, 'confirmed invited no-role context hasRole is false');
select throws_ok($$select public.record_current_invited_operator_password_set()$$, 'P0001', 'ADMIN_SETUP_NOT_ALLOWED', 'confirmed invited user without role cannot record password setup');
select throws_ok($$select public.activate_current_invited_operator()$$, 'P0001', 'ADMIN_ACTIVATION_FAILED', 'confirmed invited user with every gate except role cannot activate');

reset role;
update public.platform_admin_members set password_set_at = now(), mfa_required = false
where user_id = '31000000-0000-4000-8000-000000000006';
set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
select is(public.get_current_operator_setup_context(), jsonb_build_object('status', 'invited', 'emailConfirmed', true, 'passwordSet', true, 'hasVerifiedTotp', true, 'hasRole', true, 'currentAal', 'aal2'), 'mfa_required false fixture has every other setup fact');
select throws_ok($$select public.activate_current_invited_operator()$$, 'P0001', 'ADMIN_ACTIVATION_FAILED', 'invited operator with mfa_required false and every other gate cannot activate');

select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select throws_ok($$select public.activate_current_invited_operator()$$, 'P0001', 'ADMIN_ACTIVATION_FAILED', 'active operator still requires a verified factor and AAL2 posture');

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
select is(public.activate_current_invited_operator(), 'activated', 'AAL2 with a verified factor activates the invited operator');
select is(public.activate_current_invited_operator(), 'active', 'second activation is idempotent');
reset role;
select is(
  (select count(*)::integer from public.platform_audit_events where action = 'admin.account.activated' and target_id = '31000000-0000-4000-8000-000000000002'),
  1,
  'idempotent activation writes exactly one activation audit row'
);
set local role authenticated;

select throws_ok(
  $$update public.platform_admin_members set status = 'active' where user_id = '31000000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table platform_admin_members',
  'authenticated users cannot update admin membership directly'
);

reset role;
select ok(
  to_regprocedure('public.activate_current_invited_operator()') is null
    or not has_function_privilege('anon', 'public.activate_current_invited_operator()', 'EXECUTE'),
  'anonymous users cannot activate operators'
);

rollback;
