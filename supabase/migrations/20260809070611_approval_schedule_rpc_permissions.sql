grant execute on function private.reject_content_version_internal(uuid, uuid, uuid, text, text)
  to authenticated;
grant execute on function private.schedule_approved_content_once_internal(uuid, uuid, timestamptz, text, uuid)
  to authenticated;
grant execute on function private.reschedule_content_internal(uuid, uuid, timestamptz, text)
  to authenticated;
grant execute on function private.cancel_schedule_internal(uuid, uuid)
  to authenticated;

revoke all on function private.reject_content_version_internal(uuid, uuid, uuid, text, text)
  from public, anon;
revoke all on function private.schedule_approved_content_once_internal(uuid, uuid, timestamptz, text, uuid)
  from public, anon;
revoke all on function private.reschedule_content_internal(uuid, uuid, timestamptz, text)
  from public, anon;
revoke all on function private.cancel_schedule_internal(uuid, uuid)
  from public, anon;
