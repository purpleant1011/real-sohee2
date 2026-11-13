-- Naver blog categories synced from the connected Chrome extension.
-- Stores category trees up to 200 items per browser channel connection.

create table public.naver_blog_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  browser_channel_connection_id uuid not null unique references public.browser_channel_connections(id) on delete cascade,
  categories jsonb not null default '[]'::jsonb check (
    jsonb_typeof(categories) = 'array'
    and jsonb_array_length(categories) <= 200
  ),
  synced_at timestamptz not null default now(),
  source_device_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index naver_blog_categories_workspace_id_idx
  on public.naver_blog_categories(workspace_id);

create index naver_blog_categories_workspace_synced_idx
  on public.naver_blog_categories(workspace_id, synced_at desc);

create trigger naver_blog_categories_set_updated_at
  before update on public.naver_blog_categories
  for each row execute function private.set_updated_at();

alter table public.naver_blog_categories enable row level security;
revoke all on table public.naver_blog_categories from public, anon, authenticated;
grant select on table public.naver_blog_categories to authenticated;
grant select, insert, update, delete on table public.naver_blog_categories to service_role;

-- RLS: only active workspace members with role owner, manager, or reviewer can select
create policy naver_blog_categories_select on public.naver_blog_categories
  for select to authenticated
  using ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])));

create policy naver_blog_categories_service_write on public.naver_blog_categories
  for all to service_role
  using (true)
  with check (true);
