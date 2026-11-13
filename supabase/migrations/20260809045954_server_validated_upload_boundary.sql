revoke insert on public.media_assets from authenticated;
drop policy if exists "content editors can insert media" on public.media_assets;
drop policy if exists "workspace reviewers can upload private objects" on storage.objects;

revoke insert, update on public.knowledge_items from authenticated;
drop policy if exists "content editors can insert knowledge" on public.knowledge_items;
drop policy if exists "content editors can update knowledge" on public.knowledge_items;

alter table public.knowledge_items
  drop constraint if exists knowledge_items_status_check;
alter table public.knowledge_items
  add constraint knowledge_items_status_check
  check (status in (
    'uploading', 'checking', 'review_required', 'approved', 'rejected', 'disabled'
  ));

create or replace function private.is_content_version_publishable(
  p_workspace_id uuid,
  p_version_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  media_count integer;
  valid_media_count integer;
  storage_object_count integer;
  knowledge_count integer;
  valid_knowledge_count integer;
  knowledge_storage_count integer;
begin
  perform 1
  from public.content_versions as version
  where version.workspace_id = p_workspace_id
    and version.id = p_version_id
    and version.rights -> 'confirmed' = 'true'::jsonb
    and version.generation_evidence -> 'confirmed' = 'true'::jsonb
  for share of version;

  if not found then return false; end if;

  select count(*)::integer into media_count
  from public.content_version_media as link
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id;

  if media_count not between 1 and 10 then return false; end if;

  perform asset.id
  from public.content_version_media as link
  join public.media_assets as asset
    on asset.workspace_id = link.workspace_id
   and asset.id = link.media_asset_id
   and asset.bucket_id = 'content-media'
   and asset.kind = 'content'
   and asset.rights_status = 'confirmed'
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id
  order by asset.id
  for share of asset;
  get diagnostics valid_media_count = row_count;

  if valid_media_count <> media_count then return false; end if;

  perform object.id
  from public.content_version_media as link
  join public.media_assets as asset
    on asset.workspace_id = link.workspace_id
   and asset.id = link.media_asset_id
  join storage.objects as object
    on object.bucket_id = asset.bucket_id
   and object.name = asset.object_path
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id
  order by object.id
  for share of object;
  get diagnostics storage_object_count = row_count;

  if storage_object_count <> media_count then return false; end if;

  select count(*)::integer into knowledge_count
  from public.content_version_knowledge as link
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id;

  perform knowledge.id
  from public.content_version_knowledge as link
  join public.knowledge_items as knowledge
    on knowledge.workspace_id = link.workspace_id
   and knowledge.id = link.knowledge_item_id
   and knowledge.status = 'approved'
   and knowledge.evidence -> 'fileValidated' = 'true'::jsonb
   and knowledge.evidence -> 'reviewed' = 'true'::jsonb
  join public.media_assets as asset
    on asset.workspace_id = knowledge.workspace_id
   and asset.id = knowledge.media_asset_id
   and asset.bucket_id = 'knowledge-files'
   and asset.kind = 'knowledge'
   and asset.rights_status = 'confirmed'
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id
  order by knowledge.id, asset.id
  for share of knowledge, asset;
  get diagnostics valid_knowledge_count = row_count;

  if valid_knowledge_count <> knowledge_count then return false; end if;

  perform object.id
  from public.content_version_knowledge as link
  join public.knowledge_items as knowledge
    on knowledge.workspace_id = link.workspace_id
   and knowledge.id = link.knowledge_item_id
  join public.media_assets as asset
    on asset.workspace_id = knowledge.workspace_id
   and asset.id = knowledge.media_asset_id
  join storage.objects as object
    on object.bucket_id = asset.bucket_id
   and object.name = asset.object_path
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id
  order by object.id
  for share of object;
  get diagnostics knowledge_storage_count = row_count;

  return knowledge_storage_count = knowledge_count;
end;
$$;

revoke execute on function private.is_content_version_publishable(uuid, uuid)
  from public, anon, authenticated;
