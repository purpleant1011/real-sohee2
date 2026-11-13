begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select has_function('public', 'register_browser_channel_connection', array['uuid','uuid','text','text','text','text','text','text'], 'device connection registration RPC exists');
select function_returns('public', 'register_browser_channel_connection', array['uuid','uuid','text','text','text','text','text','text'], 'uuid', 'registration returns the connection id');
select ok(not has_function_privilege('authenticated', 'public.register_browser_channel_connection(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE'), 'authenticated users cannot bypass device verification');
select ok(has_function_privilege('service_role', 'public.register_browser_channel_connection(uuid,uuid,text,text,text,text,text,text)', 'EXECUTE'), 'service role can register a verified device target');

select * from finish();
rollback;
