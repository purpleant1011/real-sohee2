-- V0.9 Content Drafts Table & Durable Storage (ANI-977)
-- Supports durable persistence of real AI-generated content drafts across sessions and workbenches.

create table public.content_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 500),
  channel text not null check (char_length(channel) between 1 and 50),
  tone text check (tone is null or char_length(tone) <= 100),
  content text not null check (char_length(content) >= 1),
  revisions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(revisions) = 'array'),
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_drafts_workspace_draft_id_key unique (workspace_id, draft_id)
);

create index content_drafts_workspace_created_idx
  on public.content_drafts (workspace_id, created_at desc);

create index content_drafts_workspace_status_idx
  on public.content_drafts (workspace_id, status, updated_at desc);

create trigger content_drafts_set_updated_at
before update on public.content_drafts
for each row execute function private.set_updated_at();

alter table public.content_drafts enable row level security;

create policy "workspace members can read content drafts"
on public.content_drafts for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace collaborators can insert content drafts"
on public.content_drafts for insert to authenticated
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

create policy "workspace collaborators can update content drafts"
on public.content_drafts for update to authenticated
using ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)))
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

revoke all on public.content_drafts from anon, authenticated;

grant select, insert, update on public.content_drafts to authenticated;
grant select, insert, update, delete on public.content_drafts to service_role;
