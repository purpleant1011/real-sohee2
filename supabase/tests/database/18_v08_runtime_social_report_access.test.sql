begin;

select plan(6);

select ok(has_function_privilege('service_role', 'private.list_social_post_reports_internal(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE'), 'service role may call the private read-only social report function');
select ok(has_function_privilege('service_role', 'public.list_social_post_reports(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE'), 'service role may call the public social report wrapper');
select ok(not has_function_privilege('anon', 'private.list_social_post_reports_internal(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE'), 'anonymous clients cannot call the private social report function');
select ok(not has_function_privilege('anon', 'public.list_social_post_reports(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE'), 'anonymous clients cannot call the public social report wrapper');
select ok(has_function_privilege('authenticated', 'private.list_social_post_reports_internal(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE'), 'authenticated access to the private social report function is preserved');
select ok(has_function_privilege('authenticated', 'public.list_social_post_reports(uuid,timestamptz,timestamptz,uuid)', 'EXECUTE'), 'authenticated access to the public social report wrapper is preserved');

select * from finish();

rollback;
