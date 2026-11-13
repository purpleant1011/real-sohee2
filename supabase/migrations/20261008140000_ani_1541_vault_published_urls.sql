-- ANI-1541: additive manual publish URL registration for vault items.
-- Allows store owners to record external publication URLs (naver_blog, daangn_business, instagram, threads).
-- External HTTP probe/verification is strictly prohibited (stored as UNVERIFIED).

create table public.vault_published_urls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vault_item_id uuid not null,
  channel text not null check (channel in ('instagram', 'threads', 'naver_blog', 'daangn_business')),
  published_url text not null check (published_url ~ '^https://[^\s]+$'),
  verification_status text not null default 'UNVERIFIED' check (verification_status in ('UNVERIFIED')),
  registered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vault_published_urls_item_fk foreign key (workspace_id, vault_item_id)
    references public.vault_items(workspace_id, id) on delete cascade,
  constraint vault_published_urls_unique unique (workspace_id, vault_item_id)
);

create index vault_published_urls_workspace_item_idx
  on public.vault_published_urls(workspace_id, vault_item_id);

create trigger vault_published_urls_set_updated_at before update on public.vault_published_urls
  for each row execute function private.set_updated_at();

alter table public.vault_published_urls enable row level security;
revoke all on public.vault_published_urls from public, anon, authenticated;
grant select on public.vault_published_urls to authenticated;
grant select, insert, update, delete on public.vault_published_urls to service_role;

create policy vault_published_urls_members_select on public.vault_published_urls
  for select to authenticated using ((select private.is_workspace_member(workspace_id)));

create policy vault_published_urls_service_write on public.vault_published_urls
  for all to service_role using (true) with check (true);

-- Rollback in an isolated environment only (do not run against live data):
-- drop table if exists public.vault_published_urls;
