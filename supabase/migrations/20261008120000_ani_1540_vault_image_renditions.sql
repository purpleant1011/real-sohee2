-- ANI-1540 additive vault rendition metadata. Signed URLs are created at read time only.
-- Distinct from publish_renditions: those are provider-facing and currently have authenticated write policies.
create table public.vault_image_renditions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  vault_item_id uuid not null,
  source_media_asset_id uuid not null,
  channel text not null check (channel in ('instagram', 'threads', 'naver_blog', 'daangn_business')),
  spec_version text not null check (char_length(spec_version) between 1 and 120),
  storage_bucket text not null default 'content-media' check (storage_bucket = 'content-media'),
  object_path text not null,
  format text not null check (format in ('jpeg', 'png')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  rendition_content_digest text not null check (rendition_content_digest ~ '^[a-f0-9]{64}$'),
  rights_expires_at timestamptz,
  qc_expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint vault_image_renditions_item_fk foreign key (workspace_id, vault_item_id)
    references public.vault_items(workspace_id, id) on delete cascade,
  constraint vault_image_renditions_asset_fk foreign key (workspace_id, source_media_asset_id)
    references public.media_assets(workspace_id, id) on delete restrict,
  constraint vault_image_renditions_object_path_check check (
    object_path = 'vault-renditions/' || workspace_id::text || '/' || rendition_content_digest ||
      case format when 'jpeg' then '.jpg' else '.png' end
  ),
  constraint vault_image_renditions_unique unique (workspace_id, vault_item_id, source_media_asset_id)
);
create index vault_image_renditions_preflight_idx on public.vault_image_renditions(workspace_id, vault_item_id);
alter table public.vault_image_renditions enable row level security;
revoke all on public.vault_image_renditions from public, anon, authenticated;
grant select on public.vault_image_renditions to authenticated;
grant select, insert, update, delete on public.vault_image_renditions to service_role;
create policy vault_image_renditions_members_select on public.vault_image_renditions
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy vault_image_renditions_service_write on public.vault_image_renditions
  for all to service_role using (true) with check (true);

-- Rollback in an isolated environment only (do not run against live data):
-- drop table if exists public.vault_image_renditions;
