-- Forward-only migration: Workspace Structured Products & Services Grounding (ANI-1055)
-- Production schema introspection & forward-only DDL.

create table if not exists public.workspace_products_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  price integer check (price is null or price >= 0),
  price_formatted text,
  description text,
  key_benefits text[] not null default '{}',
  priority integer not null default 1,
  is_signature boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_products_services_workspace_id_id_key unique (workspace_id, id)
);

create index if not exists workspace_products_services_ws_idx
  on public.workspace_products_services (workspace_id, active, priority);

alter table public.workspace_products_services enable row level security;

create policy "authenticated_users_can_select_products_services"
  on public.workspace_products_services for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members
      where workspace_members.workspace_id = workspace_products_services.workspace_id
        and workspace_members.user_id = auth.uid()
    )
  );

create policy "authenticated_users_can_insert_products_services"
  on public.workspace_products_services for insert to authenticated
  with check (
    exists (
      select 1 from public.workspace_members
      where workspace_members.workspace_id = workspace_products_services.workspace_id
        and workspace_members.user_id = auth.uid()
        and workspace_members.role in ('owner', 'manager')
    )
  );

create policy "authenticated_users_can_update_products_services"
  on public.workspace_products_services for update to authenticated
  using (
    exists (
      select 1 from public.workspace_members
      where workspace_members.workspace_id = workspace_products_services.workspace_id
        and workspace_members.user_id = auth.uid()
        and workspace_members.role in ('owner', 'manager')
    )
  );

grant select, insert, update on public.workspace_products_services to authenticated;
grant select, insert, update, delete on public.workspace_products_services to service_role;
