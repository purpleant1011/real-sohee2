-- ANI-1538: idempotent four-channel previews; publishing/external action tables are untouched.
create table public.channel_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_key uuid not null,
  topic text not null check (char_length(topic) between 1 and 300),
  knowledge_version integer not null check (knowledge_version >= 0),
  basis_notes jsonb not null default '[]'::jsonb check (jsonb_typeof(basis_notes) = 'array'),
  image_notice text,
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint channel_drafts_workspace_request_key unique (workspace_id, request_key)
);
create index channel_drafts_workspace_recent_idx on public.channel_drafts (workspace_id, created_at desc, id);

alter table public.channel_drafts enable row level security;
revoke all on table public.channel_drafts from public, anon, authenticated;
grant select on table public.channel_drafts to authenticated;
grant select, insert, update, delete on table public.channel_drafts to service_role;
create policy channel_drafts_members_select on public.channel_drafts
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));
create policy channel_drafts_service_write on public.channel_drafts
  for all to service_role using (true) with check (true);

-- Manual rollback (isolated empty environments only; never run against customer drafts):
-- drop table if exists public.channel_drafts;
