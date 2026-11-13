-- The public service-role-only wrapper is SECURITY INVOKER, so its caller must
-- be able to execute the checked private implementation it delegates to.
revoke all on function private.save_meta_channel_connection_internal(
  uuid, uuid, text, text, text, text, text, text[], timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function private.save_meta_channel_connection_internal(
  uuid, uuid, text, text, text, text, text, text[], timestamptz, timestamptz
) to service_role;
