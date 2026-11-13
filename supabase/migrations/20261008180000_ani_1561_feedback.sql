-- ANI-1561: user feedback & support hub. Additive only.
-- Users (workspace members) may INSERT / SELECT feedback of their own workspace.
-- Triage fields (status, tags, links, admin_note) are written only through the service-role server path.
-- Attachments (screenshots) are intentionally NOT part of this migration (see docs/v092/feedback-privacy.md).
create table public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  screen text not null check (char_length(screen) between 1 and 200),
  kind text not null default 'GENERAL'
    check (kind in ('GENERAL', 'PREVIEW_MISMATCH', 'PROBLEM', 'IDEA')),
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(message) between 1 and 2000),
  tags text[] not null default '{}'::text[]
    check (tags <@ array['PREVIEW_MISMATCH', 'SPEC', 'CONNECTION', 'SPEED', 'OTHER']::text[]),
  status text not null default 'NEW' check (status in ('NEW', 'REVIEWING', 'APPLIED', 'ON_HOLD')),
  content_id uuid,
  run_id uuid,
  admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index user_feedback_workspace_created_idx on public.user_feedback (workspace_id, created_at desc);
create index user_feedback_open_idx on public.user_feedback (status, created_at desc) where deleted_at is null;
create index user_feedback_purge_idx on public.user_feedback (deleted_at) where deleted_at is not null;

alter table public.user_feedback enable row level security;
revoke all on public.user_feedback from public, anon, authenticated;
-- Members can only write the fields a user fills in, and cannot read the operator memo.
grant insert (workspace_id, screen, kind, rating, message, created_by) on public.user_feedback to authenticated;
grant select (id, workspace_id, screen, kind, rating, message, status, created_by, created_at, deleted_at)
  on public.user_feedback to authenticated;
grant select, insert, update, delete on public.user_feedback to service_role;

create policy user_feedback_members_select on public.user_feedback
  for select to authenticated
  using (deleted_at is null and (select private.is_workspace_member(workspace_id)));
create policy user_feedback_members_insert on public.user_feedback
  for insert to authenticated
  with check (created_by = (select auth.uid()) and (select private.is_workspace_member(workspace_id)));
create policy user_feedback_service_all on public.user_feedback
  for all to service_role using (true) with check (true);

-- Hard delete of feedback whose soft-delete is older than the retention window (default 30 days).
-- Service role only. Returns the number of rows removed.
create function public.purge_deleted_user_feedback(p_retention_days integer default 30)
returns integer language plpgsql security invoker set search_path = '' as $$
declare removed integer;
begin
  if p_retention_days is null or p_retention_days < 0 then
    raise exception 'FEEDBACK_RETENTION_INVALID';
  end if;
  delete from public.user_feedback
   where deleted_at is not null
     and deleted_at <= now() - make_interval(days => p_retention_days);
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.purge_deleted_user_feedback(integer) from public, anon, authenticated;
grant execute on function public.purge_deleted_user_feedback(integer) to service_role;

-- Rollback (isolated environment only, after exporting rows if any):
-- drop function if exists public.purge_deleted_user_feedback(integer);
-- drop table if exists public.user_feedback;
