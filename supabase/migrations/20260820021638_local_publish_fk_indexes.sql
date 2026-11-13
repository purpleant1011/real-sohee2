create index connector_pairing_codes_workspace_idx
  on private.connector_pairing_codes (workspace_id);
create index connector_pairing_codes_created_by_idx
  on private.connector_pairing_codes (created_by);
create index local_publish_leases_attempt_idx
  on private.local_publish_leases (workspace_id, attempt_id);
create index local_publish_leases_device_idx
  on private.local_publish_leases (workspace_id, device_id);
create index browser_channel_connections_device_idx
  on public.browser_channel_connections (workspace_id, device_id);
create index connector_devices_created_by_idx
  on public.connector_devices (created_by);
