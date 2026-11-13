create or replace function private.create_initial_workspace_internal(
  p_display_name text,
  p_workspace_name text,
  p_timezone text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  existing_workspace_id uuid;
  created_workspace_id uuid;
  normalized_display_name text := pg_catalog.btrim(p_display_name);
  normalized_workspace_name text := pg_catalog.btrim(p_workspace_name);
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if normalized_display_name is null
    or pg_catalog.char_length(normalized_display_name) not between 1 and 80
    or normalized_workspace_name is null
    or pg_catalog.char_length(normalized_workspace_name) not between 1 and 80
    or p_timezone is distinct from 'Asia/Seoul'
  then
    raise exception 'INVALID_WORKSPACE_INPUT' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text, 534845::bigint)
  );

  select member.workspace_id
  into existing_workspace_id
  from public.workspace_members as member
  where member.user_id = actor_id
    and member.status = 'active'
  order by member.created_at, member.workspace_id
  limit 1;

  if existing_workspace_id is not null then
    return existing_workspace_id;
  end if;

  insert into public.profiles (id, display_name)
  values (actor_id, normalized_display_name)
  on conflict (id) do update
    set display_name = excluded.display_name;

  insert into public.workspaces (name, timezone, created_by)
  values (normalized_workspace_name, p_timezone, actor_id)
  returning id into created_workspace_id;

  return created_workspace_id;
end;
$$;

revoke execute on function private.create_initial_workspace_internal(text, text, text)
from public, anon;
grant execute on function private.create_initial_workspace_internal(text, text, text)
to authenticated;

create or replace function public.create_initial_workspace(
  p_display_name text,
  p_workspace_name text,
  p_timezone text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_initial_workspace_internal(
    p_display_name,
    p_workspace_name,
    p_timezone
  );
$$;

revoke all on function public.create_initial_workspace(text, text, text) from public, anon;
grant execute on function public.create_initial_workspace(text, text, text) to authenticated;
