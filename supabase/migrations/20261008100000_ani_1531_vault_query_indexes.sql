-- ANI-1531: vault query performance indexes for listing, calendar, and summary verification
-- Additive only: optimizes target_date filtering/sorting, approval_state grouping, and external_action ledger joins.

create index if not exists vault_items_workspace_target_date_idx
  on public.vault_items(workspace_id, target_date, id)
  where deleted_at is null;

create index if not exists vault_items_workspace_approval_state_idx
  on public.vault_items(workspace_id, approval_state)
  where deleted_at is null;

create index if not exists external_action_requests_workspace_version_idx
  on public.external_action_requests(workspace_id, content_version_id);

-- Rollback SQL (isolated environment only):
-- drop index if exists public.external_action_requests_workspace_version_idx;
-- drop index if exists public.vault_items_workspace_approval_state_idx;
-- drop index if exists public.vault_items_workspace_target_date_idx;
