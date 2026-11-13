create or replace function private.is_registered_storage_object(
  p_bucket_id text,
  p_name text,
  p_actor_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_workspace_id uuid;
  path_resource_id uuid;
begin
  if p_bucket_id not in ('content-media', 'knowledge-files')
    or not private.is_valid_storage_object_path(p_name) then
    return false;
  end if;

  path_workspace_id := split_part(p_name, '/', 1)::uuid;
  path_resource_id := split_part(p_name, '/', 3)::uuid;

  return exists (
    select 1
    from public.media_assets as asset
    where asset.workspace_id = path_workspace_id
      and asset.id = path_resource_id
      and asset.bucket_id = p_bucket_id
      and asset.object_path = p_name
      and (p_actor_id is null or asset.created_by = p_actor_id)
  );
exception
  when others then
    return false;
end;
$$;

revoke execute on function private.is_registered_storage_object(text, text, uuid)
  from public, anon;
grant execute on function private.is_registered_storage_object(text, text, uuid)
  to authenticated;

alter policy "workspace members can read private objects"
on storage.objects
using (
  bucket_id in ('content-media', 'knowledge-files')
  and private.is_valid_storage_object_path(name)
  and private.is_registered_storage_object(bucket_id, name, null)
  and (select private.is_workspace_member(private.storage_path_workspace(name)))
);

alter policy "workspace reviewers can upload private objects"
on storage.objects
with check (
  bucket_id in ('content-media', 'knowledge-files')
  and private.is_valid_storage_object_path(name)
  and split_part(name, '/', 2) = (select auth.uid())::text
  and private.is_registered_storage_object(bucket_id, name, (select auth.uid()))
  and (select private.has_workspace_role(
    private.storage_path_workspace(name),
    array['owner', 'manager', 'reviewer']::text[]
  ))
);

alter policy "workspace managers can delete private objects"
on storage.objects
using (
  bucket_id in ('content-media', 'knowledge-files')
  and private.is_valid_storage_object_path(name)
  and private.is_registered_storage_object(bucket_id, name, null)
  and (select private.has_workspace_role(
    private.storage_path_workspace(name),
    array['owner', 'manager']::text[]
  ))
);
