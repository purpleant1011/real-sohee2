begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select has_index('private', 'connector_pairing_codes', 'connector_pairing_codes_workspace_idx', 'pairing workspace foreign key is indexed');
select has_index('private', 'connector_pairing_codes', 'connector_pairing_codes_created_by_idx', 'pairing creator foreign key is indexed');
select has_index('private', 'local_publish_leases', 'local_publish_leases_attempt_idx', 'lease attempt foreign key is indexed');
select has_index('private', 'local_publish_leases', 'local_publish_leases_device_idx', 'lease device foreign key is indexed');
select has_index('public', 'browser_channel_connections', 'browser_channel_connections_device_idx', 'browser connection device foreign key is indexed');
select has_index('public', 'connector_devices', 'connector_devices_created_by_idx', 'connector device creator foreign key is indexed');

select * from finish();
rollback;
