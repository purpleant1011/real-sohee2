-- The report-only automation runtime uses this SECURITY INVOKER wrapper with a
-- service-role client. Both functions are read-only; keep anonymous execution
-- revoked while preserving the existing authenticated access.
revoke all on function private.list_social_post_reports_internal(
  uuid, timestamptz, timestamptz, uuid
) from anon;
revoke all on function public.list_social_post_reports(
  uuid, timestamptz, timestamptz, uuid
) from anon;

grant execute on function private.list_social_post_reports_internal(
  uuid, timestamptz, timestamptz, uuid
) to service_role;
grant execute on function public.list_social_post_reports(
  uuid, timestamptz, timestamptz, uuid
) to service_role;
