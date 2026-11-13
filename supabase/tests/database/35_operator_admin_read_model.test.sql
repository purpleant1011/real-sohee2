begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

select has_function(
  'public', 'list_operator_admins', array['text', 'text', 'text', 'timestamptz', 'uuid', 'integer'],
  'operator administrator read RPC exists'
);
select ok(
  to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)') is not null
    and has_function_privilege('authenticated', 'public.list_operator_admins(text,text,text,timestamptz,uuid,integer)', 'EXECUTE'),
  'authenticated operators can execute the read RPC'
);
select ok(
  to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)') is null
    or not has_function_privilege('anon', 'public.list_operator_admins(text,text,text,timestamptz,uuid,integer)', 'EXECUTE'),
  'anonymous users cannot execute the read RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.platform_admin_members', 'SELECT'),
  'authenticated users cannot read administrator members directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.platform_admin_role_assignments', 'SELECT'),
  'authenticated users cannot read role assignments directly'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_admin_members'::regclass),
  'administrator members retain RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_admin_role_assignments'::regclass),
  'role assignments retain RLS'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%admin.read%',
  'read RPC enforces the dedicated admin.read permission'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%aal2%',
  'read RPC enforces the MFA assurance level'
);
select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    not like '%mfa_secret%'
    and pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
      not like '%refresh_token%',
  'read RPC does not project secrets or tokens'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%session_state%'
    and pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
      like '%unknown%',
  'session state remains an explicit unknown without a source-backed session read model'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%platform_roles%'
    and pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
      like '%role_data%',
  'read RPC derives roles through the platform role tables'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%auth.mfa_factors%',
  'read RPC derives MFA enrollment only from verified factors'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%platform_admin_members%',
  'read RPC reads administrator membership state'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%platform_admin_role_assignments%',
  'read RPC reads administrator scope assignments'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%limit%',
  'read RPC has a bounded page size'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%auth.uid()%',
  'read RPC is bound to the current authenticated actor'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%status = ''active''%',
  'read RPC rejects inactive operators'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%email_confirmed_at%',
  'read RPC only projects confirmed account identities'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    not like '%raw_user_meta_data%'
    and pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
      not like '%raw_app_meta_data%',
  'read RPC does not expose raw auth metadata'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%next_cursor%',
  'read RPC returns a stable pagination cursor'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%mfa_required%',
  'read RPC returns the configured MFA requirement'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.list_operator_admins(text,text,text,timestamptz,uuid,integer)'))
    like '%data_freshness%',
  'read RPC returns freshness metadata'
);

insert into auth.users (id, email, email_confirmed_at)
values
  ('35000000-0000-4000-8000-000000000001', 'operator-ani88@example.com', now()),
  ('35000000-0000-4000-8000-000000000002', 'unconfirmed-ani88@example.com', null),
  ('35000000-0000-4000-8000-000000000003', 'customer-ani88@example.com', now());

set local role service_role;
insert into public.platform_admin_members (user_id, status, mfa_required)
values
  ('35000000-0000-4000-8000-000000000001', 'active', true),
  ('35000000-0000-4000-8000-000000000002', 'invited', true);
update public.platform_admin_members
set created_at = statement_timestamp() + interval '1 second', updated_at = statement_timestamp() + interval '1 second'
where user_id = '35000000-0000-4000-8000-000000000001';
insert into public.platform_admin_role_assignments (user_id, role_key)
values ('35000000-0000-4000-8000-000000000001', 'platform_owner');
reset role;
create function public.test_insert_ani88_mfa()
returns void language sql security definer set search_path = ''
as $$
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values ('35000000-0000-4000-8000-000000000101', '35000000-0000-4000-8000-000000000001', 'ANI-88 fixture', 'totp', 'verified', now(), now(), 'fixture-secret');
$$;
select public.test_insert_ani88_mfa();
drop function public.test_insert_ani88_mfa();

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"35000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select is(
  jsonb_array_length(public.list_operator_admins()->'items'),
  2,
  'an admin.read operator receives the scoped administrator rows'
);
select is(
  (public.list_operator_admins()->'items'->0->>'email'),
  'o***@example.com',
  'administrator email is masked and confirmed identities are safe-projected'
);
select is(
  (public.list_operator_admins()->'items'->0->>'mfa_enrolled')::boolean,
  true,
  'verified TOTP enrollment is reflected without exposing the factor'
);
select is(
  public.list_operator_admins()->'items'->0->>'session_state',
  'unknown',
  'session state remains unknown without a session source'
);
select is(
  public.list_operator_admins()->'items'->0->>'last_login_at',
  null,
  'last login remains null without a login source'
);
select set_config('request.jwt.claims', '{"sub":"35000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.list_operator_admins()$$,
  'P0001', 'MFA_REQUIRED',
  'AAL1 cannot read administrator accounts'
);

select set_config('request.jwt.claims', '{"sub":"35000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.list_operator_admins()$$,
  'P0001', 'OPERATOR_DISABLED',
  'a non-operator cannot read administrator accounts'
);

rollback;
