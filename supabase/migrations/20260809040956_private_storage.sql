insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'content-media',
    'content-media',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'knowledge-files',
    'knowledge-files',
    false,
    8388608,
    array['application/pdf', 'text/plain', 'image/jpeg', 'image/png']::text[]
  )
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.is_valid_storage_object_path(p_name text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$';
$$;

create or replace function private.storage_path_workspace(p_name text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when private.is_valid_storage_object_path(p_name)
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

revoke execute on function private.is_valid_storage_object_path(text) from public, anon;
revoke execute on function private.storage_path_workspace(text) from public, anon;
grant execute on function private.is_valid_storage_object_path(text) to authenticated;
grant execute on function private.storage_path_workspace(text) to authenticated;

create policy "workspace members can read private objects"
on storage.objects for select
to authenticated
using (
  bucket_id in ('content-media', 'knowledge-files')
  and private.is_valid_storage_object_path(name)
  and (select private.is_workspace_member(private.storage_path_workspace(name)))
);

create policy "workspace reviewers can upload private objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('content-media', 'knowledge-files')
  and private.is_valid_storage_object_path(name)
  and split_part(name, '/', 2) = (select auth.uid())::text
  and (select private.has_workspace_role(
    private.storage_path_workspace(name),
    array['owner', 'manager', 'reviewer']::text[]
  ))
);

create policy "workspace managers can delete private objects"
on storage.objects for delete
to authenticated
using (
  bucket_id in ('content-media', 'knowledge-files')
  and private.is_valid_storage_object_path(name)
  and (select private.has_workspace_role(
    private.storage_path_workspace(name),
    array['owner', 'manager']::text[]
  ))
);
