create or replace function private.write_audit_event(
  p_workspace_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_type not in (
    'content.version_created', 'content.approved', 'content.rejected',
    'content.scheduled', 'content.rescheduled', 'content.schedule_cancelled',
    'publish.recorded', 'publish.retry_requested'
  )
    or p_entity_type not in ('content_version', 'approval', 'schedule', 'publish_attempt')
    or p_metadata is null
    or jsonb_typeof(p_metadata) <> 'object'
    or octet_length(p_metadata::text) > 2000 then
    raise exception '감사 이벤트 입력이 올바르지 않습니다.';
  end if;

  insert into public.audit_events (
    workspace_id, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace_id, (select auth.uid()), p_event_type, p_entity_type, p_entity_id, p_metadata
  );
end;
$$;

revoke all on function private.write_audit_event(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
