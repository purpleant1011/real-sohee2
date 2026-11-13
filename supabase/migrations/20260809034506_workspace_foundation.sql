create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  timezone text not null default 'Asia/Seoul' check (char_length(timezone) between 1 and 64),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_created_by_idx on public.workspaces (created_by);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'reviewer', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx
  on public.workspace_members (user_id, status, workspace_id);

create table public.business_profiles (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  business_name text not null check (char_length(business_name) between 1 and 120),
  industry text check (industry is null or char_length(industry) <= 120),
  location text check (location is null or char_length(location) <= 200),
  summary text check (summary is null or char_length(summary) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.brand_profiles (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  voice text check (voice is null or char_length(voice) <= 2000),
  keywords text[] not null default '{}',
  prohibited_terms text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null check (channel in ('instagram', 'threads', 'naver_blog', 'naver_place')),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  account_label text check (account_label is null or char_length(account_label) <= 120),
  external_account_id text check (
    external_account_id is null or char_length(external_account_id) <= 255
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel)
);

create index channel_connections_workspace_status_idx
  on public.channel_connections (workspace_id, status, channel);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create or replace function private.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (new.id, new.created_by, 'owner', 'active');
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();

create trigger workspaces_add_owner_membership
after insert on public.workspaces
for each row execute function private.add_workspace_owner();

create trigger workspace_members_set_updated_at
before update on public.workspace_members
for each row execute function private.set_updated_at();

create trigger business_profiles_set_updated_at
before update on public.business_profiles
for each row execute function private.set_updated_at();

create trigger brand_profiles_set_updated_at
before update on public.brand_profiles
for each row execute function private.set_updated_at();

create trigger channel_connections_set_updated_at
before update on public.channel_connections
for each row execute function private.set_updated_at();

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspace_members as member
      where member.workspace_id = p_workspace_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    );
$$;

create or replace function private.has_workspace_role(
  p_workspace_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspace_members as member
      where member.workspace_id = p_workspace_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
        and member.role = any (p_roles)
    );
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated;
revoke execute on function private.add_workspace_owner() from public, anon, authenticated;
revoke execute on function private.is_workspace_member(uuid) from public, anon;
revoke execute on function private.has_workspace_role(uuid, text[]) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.business_profiles enable row level security;
alter table public.brand_profiles enable row level security;
alter table public.channel_connections enable row level security;

create policy "users can read their profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "users can create their profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "users can update their profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "workspace members can read workspaces"
on public.workspaces for select
to authenticated
using (
  (select private.is_workspace_member(id))
  or created_by = (select auth.uid())
);

create policy "authenticated users can create workspaces"
on public.workspaces for insert
to authenticated
with check ((select auth.uid()) = created_by);

create policy "workspace managers can update workspaces"
on public.workspaces for update
to authenticated
using ((select private.has_workspace_role(id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(id, array['owner', 'manager']::text[])));

create policy "workspace members can read active peers"
on public.workspace_members for select
to authenticated
using (
  status = 'active'
  and (select private.is_workspace_member(workspace_id))
);

create policy "owners can insert workspace members"
on public.workspace_members for insert
to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner']::text[])));

create policy "owners can update workspace member roles"
on public.workspace_members for update
to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner']::text[])));

create policy "owners can delete workspace members"
on public.workspace_members for delete
to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner']::text[])));

create policy "workspace members can read business profiles"
on public.business_profiles for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace managers can insert business profiles"
on public.business_profiles for insert
to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace managers can update business profiles"
on public.business_profiles for update
to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace members can read brand profiles"
on public.brand_profiles for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace managers can insert brand profiles"
on public.brand_profiles for insert
to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace managers can update brand profiles"
on public.brand_profiles for update
to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace members can read channel connections"
on public.channel_connections for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace managers can insert channel connections"
on public.channel_connections for insert
to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace managers can update channel connections"
on public.channel_connections for update
to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace owners can delete channel connections"
on public.channel_connections for delete
to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner']::text[])));

revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.workspaces to authenticated;
grant update (name, timezone) on public.workspaces to authenticated;
grant select, insert, delete on public.workspace_members to authenticated;
grant update (role, status) on public.workspace_members to authenticated;
grant select, insert on public.business_profiles to authenticated;
grant update (business_name, industry, location, summary) on public.business_profiles to authenticated;
grant select, insert on public.brand_profiles to authenticated;
grant update (voice, keywords, prohibited_terms) on public.brand_profiles to authenticated;
grant select, insert, delete on public.channel_connections to authenticated;
grant update (channel, status, account_label, external_account_id) on public.channel_connections to authenticated;
