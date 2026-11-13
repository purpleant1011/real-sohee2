create or replace function private.schedule_approved_content_once_internal(
  p_workspace_id uuid,
  p_approval_id uuid,
  p_publish_at timestamptz,
  p_timezone text,
  p_channel_connection_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_schedule_id uuid;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '콘텐츠를 예약할 권한이 없습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_approval_id::text, 0)
  );

  select id into existing_schedule_id
  from public.schedules
  where workspace_id = p_workspace_id
    and approval_id = p_approval_id
    and status in ('scheduled', 'publishing')
  order by created_at
  limit 1;

  if existing_schedule_id is not null then
    return existing_schedule_id;
  end if;

  return private.schedule_approved_content_internal(
    p_workspace_id, p_approval_id, p_publish_at, p_timezone, p_channel_connection_id
  );
end;
$$;

revoke all on function private.schedule_approved_content_once_internal(uuid, uuid, timestamptz, text, uuid)
  from public, anon;
grant execute on function private.schedule_approved_content_once_internal(uuid, uuid, timestamptz, text, uuid)
  to authenticated;
