-- Covering indexes for foreign keys flagged by the Supabase performance advisor on the V0.92 tables.
-- Additive only; `if not exists` keeps replays idempotent.
create index if not exists vault_items_version_fk_idx on public.vault_items (workspace_id, content_id, version_id);
create index if not exists vault_items_approved_by_idx on public.vault_items (approved_by) where approved_by is not null;
create index if not exists vault_items_held_by_idx on public.vault_items (held_by) where held_by is not null;
create index if not exists vault_events_actor_id_idx on public.vault_events (actor_id) where actor_id is not null;
create index if not exists preflight_runs_triggered_by_idx on public.preflight_runs (triggered_by) where triggered_by is not null;
create index if not exists vault_image_renditions_asset_fk_idx on public.vault_image_renditions (workspace_id, source_media_asset_id);
create index if not exists vault_published_urls_registered_by_idx on public.vault_published_urls (registered_by) where registered_by is not null;
create index if not exists safety_intervention_executions_actor_idx on public.safety_intervention_executions (actor_id);
create index if not exists safety_intervention_executions_audit_idx on public.safety_intervention_executions (audit_event_id);

-- Rollback (manual only): drop index if exists public.<name>; for each index above.
