-- The public service-role-only wrapper is SECURITY INVOKER, so its caller must
-- be able to execute the checked private implementation it delegates to.
revoke all on function private.load_meta_channel_credential_internal(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function private.load_meta_channel_credential_internal(
  uuid, uuid
) to service_role;
