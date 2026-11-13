begin;
select plan(11);

select has_table('public', 'signup_consent_receipts', 'signup consent receipts exists');
select col_is_pk('public', 'signup_consent_receipts', 'user_id', 'user id is the primary key');
select ok((select relrowsecurity from pg_class where oid = 'public.signup_consent_receipts'::regclass), 'RLS is enabled');
select policies_are('public', 'signup_consent_receipts', array['users can read own signup consent receipts'], 'only owner read policy exists');
select ok(has_table_privilege('authenticated', 'public.signup_consent_receipts', 'SELECT'), 'authenticated read is granted');
select ok(not has_table_privilege('authenticated', 'public.signup_consent_receipts', 'INSERT'), 'authenticated insert is denied');
select ok(not has_table_privilege('authenticated', 'public.signup_consent_receipts', 'UPDATE'), 'authenticated update is denied');
select ok(not has_table_privilege('authenticated', 'public.signup_consent_receipts', 'DELETE'), 'authenticated delete is denied');
select ok(not has_table_privilege('anon', 'public.signup_consent_receipts', 'SELECT'), 'anonymous read is denied');
select has_function('private', 'record_signup_consent_receipt', array[]::text[], 'signup receipt trigger function exists');
select is(
  (select count(*) from pg_trigger
   where tgrelid = 'auth.users'::regclass
     and tgname = 'auth_user_signup_consent_receipt'
     and tgfoid = 'private.record_signup_consent_receipt()'::regprocedure),
   1::bigint,
  'auth insert records consent receipt'
);

select * from finish();
rollback;
