create index approvals_workspace_version_idx
  on public.approvals (workspace_id, version_id);

create index content_items_workspace_current_version_idx
  on public.content_items (workspace_id, current_version_id);

create index knowledge_items_workspace_media_idx
  on public.knowledge_items (workspace_id, media_asset_id);

create index schedules_workspace_content_idx
  on public.schedules (workspace_id, content_id);

create index schedules_workspace_version_idx
  on public.schedules (workspace_id, version_id);
