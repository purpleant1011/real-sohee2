begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

select has_table('public', 'connector_devices', 'connector devices exist');
select has_table('private', 'connector_pairing_codes', 'pairing codes stay private');
select has_table('public', 'browser_channel_connections', 'browser channel connections exist');
select has_table('private', 'local_publish_leases', 'local publish leases stay private');

select ok((select relrowsecurity from pg_class where oid = 'public.connector_devices'::regclass), 'connector device RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.browser_channel_connections'::regclass), 'browser connection RLS is enabled');

select hasnt_column('public', 'connector_devices', 'password', 'devices never store a password');
select hasnt_column('public', 'connector_devices', 'cookie', 'devices never store a cookie');
select hasnt_column('public', 'browser_channel_connections', 'password', 'browser connections never store a password');
select hasnt_column('public', 'browser_channel_connections', 'cookie', 'browser connections never store a cookie');
select hasnt_column('private', 'local_publish_leases', 'plaintext_permit', 'leases never store a plaintext submit permit');

select ok(not has_table_privilege('anon', 'public.connector_devices', 'SELECT'), 'anonymous users cannot read devices');
select ok(has_table_privilege('authenticated', 'public.connector_devices', 'SELECT'), 'authenticated members may read devices through RLS');
select ok(not has_table_privilege('authenticated', 'public.connector_devices', 'INSERT'), 'authenticated clients cannot insert devices');
select ok(not has_table_privilege('authenticated', 'private.connector_pairing_codes', 'SELECT'), 'authenticated clients cannot read pairing codes');
select ok(not has_table_privilege('authenticated', 'private.local_publish_leases', 'SELECT'), 'authenticated clients cannot read leases');

select has_function('public', 'create_connector_pairing_code', array['uuid', 'uuid', 'text', 'timestamptz'], 'pairing creation RPC exists');
select has_function('public', 'consume_connector_pairing_code', array['text', 'text', 'text', 'text', 'text'], 'pairing consumption RPC exists');
select has_function('public', 'authenticate_connector_device', array['text'], 'device authentication RPC exists');
select has_function('public', 'heartbeat_connector_device', array['uuid', 'text'], 'device heartbeat RPC exists');
select has_function('public', 'claim_local_publish_job', array['uuid', 'uuid', 'text'], 'local publish claim RPC exists');
select has_function('public', 'record_local_publish_checkpoint', array['uuid', 'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text'], 'checkpoint RPC exists');
select has_function('public', 'issue_local_submit_permit', array['uuid', 'uuid', 'uuid', 'uuid', 'text'], 'submit permit RPC exists');
select has_function('public', 'complete_local_publish_job', array['uuid', 'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text'], 'completion RPC exists');

select ok(not has_function_privilege('authenticated', 'public.claim_local_publish_job(uuid,uuid,text)', 'EXECUTE'), 'authenticated clients cannot claim jobs');
select ok(not has_function_privilege('authenticated', 'public.issue_local_submit_permit(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), 'authenticated clients cannot issue submit permits');
select ok(has_function_privilege('service_role', 'public.claim_local_publish_job(uuid,uuid,text)', 'EXECUTE'), 'service role may claim jobs');
select has_function('public', 'revoke_connector_device', array['uuid', 'uuid', 'uuid'], 'device revoke RPC exists');
select ok(not has_function_privilege('authenticated', 'public.revoke_connector_device(uuid,uuid,uuid)', 'EXECUTE'), 'authenticated clients cannot revoke through service RPC');
select has_function(
  'public', 'recover_expired_local_publish_before_submit', array['uuid', 'uuid', 'uuid'],
  'expired pre-submit local jobs have a guarded recovery RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.recover_expired_local_publish_before_submit(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated clients cannot recover connector jobs directly'
);
select ok(
  has_function_privilege('service_role', 'public.recover_expired_local_publish_before_submit(uuid,uuid,uuid)', 'EXECUTE'),
  'service role may recover an expired pre-submit connector job'
);
select has_function(
  'public', 'recover_expired_local_publish_jobs', array['uuid', 'uuid'],
  'connector polling can recover its own expired pre-submit jobs'
);
select ok(
  not has_function_privilege('authenticated', 'public.recover_expired_local_publish_jobs(uuid,uuid)', 'EXECUTE'),
  'authenticated clients cannot run connector recovery'
);
select ok(
  has_function_privilege('service_role', 'public.recover_expired_local_publish_jobs(uuid,uuid)', 'EXECUTE'),
  'service role may recover expired connector jobs before polling'
);
select ok(
  pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid = 'public.content_version_media'::regclass
      and conname = 'content_version_media_position_check'
  )) like '%position%<= 19%',
  'content version media positions support twenty ordered Naver images'
);
select ok(
  pg_get_functiondef('private.create_content_version_internal(uuid,uuid,text,text[],text,jsonb)'::regprocedure)
    like '%content_channel = ''naver_blog'' then 20 else 10%',
  'content version creation keeps twenty images specific to Naver Blog'
);
select ok(
  pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid = 'public.content_plan_entries'::regclass
      and conname = 'content_plan_entries_images_per_post_check'
  )) like '%naver_blog%20%10%',
  'period plans allow twenty images only for Naver Blog entries'
);

select * from finish();

rollback;
