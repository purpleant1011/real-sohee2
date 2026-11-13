alter function public.create_content_version(uuid, uuid, text, text[], text, jsonb)
  set schema private;
alter function private.create_content_version(uuid, uuid, text, text[], text, jsonb)
  rename to create_content_version_internal;
alter function private.create_content_version_internal(uuid, uuid, text, text[], text, jsonb)
  security definer;

alter function public.approve_content_version(uuid, uuid, uuid, text, boolean, boolean, text)
  set schema private;
alter function private.approve_content_version(uuid, uuid, uuid, text, boolean, boolean, text)
  rename to approve_content_version_internal;
alter function private.approve_content_version_internal(uuid, uuid, uuid, text, boolean, boolean, text)
  security definer;

alter function public.schedule_approved_content(uuid, uuid, timestamptz, text, uuid)
  set schema private;
alter function private.schedule_approved_content(uuid, uuid, timestamptz, text, uuid)
  rename to schedule_approved_content_internal;
alter function private.schedule_approved_content_internal(uuid, uuid, timestamptz, text, uuid)
  security definer;

alter function public.record_publish_attempt(uuid, uuid, text, text, text, text)
  set schema private;
alter function private.record_publish_attempt(uuid, uuid, text, text, text, text)
  rename to record_publish_attempt_internal;
alter function private.record_publish_attempt_internal(uuid, uuid, text, text, text, text)
  security definer;

alter function public.retry_publish_attempt(uuid, uuid, text)
  set schema private;
alter function private.retry_publish_attempt(uuid, uuid, text)
  rename to retry_publish_attempt_internal;
alter function private.retry_publish_attempt_internal(uuid, uuid, text)
  security definer;

create function public.create_content_version(
  p_workspace_id uuid,
  p_content_id uuid,
  p_caption text,
  p_hashtags text[],
  p_disclosure text,
  p_metadata jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_content_version_internal(
    p_workspace_id, p_content_id, p_caption, p_hashtags, p_disclosure, p_metadata
  );
$$;

create function public.approve_content_version(
  p_workspace_id uuid,
  p_content_id uuid,
  p_version_id uuid,
  p_expected_fingerprint text,
  p_disclosure_confirmed boolean,
  p_rights_confirmed boolean,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.approve_content_version_internal(
    p_workspace_id, p_content_id, p_version_id, p_expected_fingerprint,
    p_disclosure_confirmed, p_rights_confirmed, p_reason
  );
$$;

create function public.schedule_approved_content(
  p_workspace_id uuid,
  p_approval_id uuid,
  p_publish_at timestamptz,
  p_timezone text,
  p_channel_connection_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.schedule_approved_content_internal(
    p_workspace_id, p_approval_id, p_publish_at, p_timezone, p_channel_connection_id
  );
$$;

create function public.record_publish_attempt(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_idempotency_key text,
  p_status text,
  p_provider_reference text,
  p_error_code text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.record_publish_attempt_internal(
    p_workspace_id, p_schedule_id, p_idempotency_key, p_status,
    p_provider_reference, p_error_code
  );
$$;

create function public.retry_publish_attempt(
  p_workspace_id uuid,
  p_failed_attempt_id uuid,
  p_new_idempotency_key text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.retry_publish_attempt_internal(
    p_workspace_id, p_failed_attempt_id, p_new_idempotency_key
  );
$$;

revoke execute on function private.create_content_version_internal(uuid, uuid, text, text[], text, jsonb)
  from public, anon;
revoke execute on function private.approve_content_version_internal(uuid, uuid, uuid, text, boolean, boolean, text)
  from public, anon;
revoke execute on function private.schedule_approved_content_internal(uuid, uuid, timestamptz, text, uuid)
  from public, anon;
revoke execute on function private.record_publish_attempt_internal(uuid, uuid, text, text, text, text)
  from public, anon;
revoke execute on function private.retry_publish_attempt_internal(uuid, uuid, text)
  from public, anon;

grant execute on function private.create_content_version_internal(uuid, uuid, text, text[], text, jsonb)
  to authenticated;
grant execute on function private.approve_content_version_internal(uuid, uuid, uuid, text, boolean, boolean, text)
  to authenticated;
grant execute on function private.schedule_approved_content_internal(uuid, uuid, timestamptz, text, uuid)
  to authenticated;
grant execute on function private.record_publish_attempt_internal(uuid, uuid, text, text, text, text)
  to authenticated;
grant execute on function private.retry_publish_attempt_internal(uuid, uuid, text)
  to authenticated;

revoke execute on function public.create_content_version(uuid, uuid, text, text[], text, jsonb)
  from public, anon;
revoke execute on function public.approve_content_version(uuid, uuid, uuid, text, boolean, boolean, text)
  from public, anon;
revoke execute on function public.schedule_approved_content(uuid, uuid, timestamptz, text, uuid)
  from public, anon;
revoke execute on function public.record_publish_attempt(uuid, uuid, text, text, text, text)
  from public, anon;
revoke execute on function public.retry_publish_attempt(uuid, uuid, text)
  from public, anon;

grant execute on function public.create_content_version(uuid, uuid, text, text[], text, jsonb)
  to authenticated;
grant execute on function public.approve_content_version(uuid, uuid, uuid, text, boolean, boolean, text)
  to authenticated;
grant execute on function public.schedule_approved_content(uuid, uuid, timestamptz, text, uuid)
  to authenticated;
grant execute on function public.record_publish_attempt(uuid, uuid, text, text, text, text)
  to authenticated;
grant execute on function public.retry_publish_attempt(uuid, uuid, text)
  to authenticated;

revoke insert on public.content_versions from authenticated;
revoke insert on public.approvals from authenticated;
revoke insert, update on public.schedules from authenticated;
revoke insert, update on public.publish_attempts from authenticated;
revoke insert, delete on public.content_version_media from authenticated;
revoke insert, delete on public.content_version_knowledge from authenticated;
revoke update (status, current_version_id) on public.content_items from authenticated;

drop policy if exists "content editors can insert versions" on public.content_versions;
drop policy if exists "reviewers can insert approvals" on public.approvals;
drop policy if exists "reviewers can insert schedules" on public.schedules;
drop policy if exists "managers can update schedules" on public.schedules;
drop policy if exists "managers can insert publish attempts" on public.publish_attempts;
drop policy if exists "managers can update publish attempts" on public.publish_attempts;
drop policy if exists "content editors can link version media" on public.content_version_media;
drop policy if exists "content editors can unlink version media" on public.content_version_media;
drop policy if exists "content editors can link version knowledge" on public.content_version_knowledge;
drop policy if exists "content editors can unlink version knowledge" on public.content_version_knowledge;

alter table public.channel_connections
  add constraint channel_connections_workspace_id_id_key unique (workspace_id, id);

alter table public.schedules
  drop constraint schedules_channel_connection_id_fkey;

alter table public.schedules
  add constraint schedules_workspace_channel_connection_fkey
  foreign key (workspace_id, channel_connection_id)
  references public.channel_connections (workspace_id, id)
  on delete restrict;

create index schedules_workspace_channel_idx
  on public.schedules (workspace_id, channel_connection_id);
