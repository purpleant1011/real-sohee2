create function private.bind_local_publish_visibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  approved_visibility text;
begin
  if new.channel <> 'naver_blog' then return new; end if;

  select version.structured_payload ->> 'visibility'
  into approved_visibility
  from public.content_versions as version
  where version.workspace_id = new.workspace_id
    and version.id = new.content_version_id;

  if approved_visibility not in ('private', 'public') then
    raise exception 'LOCAL_PUBLISH_VISIBILITY_INVALID';
  end if;

  new.exact_payload := pg_catalog.jsonb_set(
    coalesce(new.exact_payload, '{}'::jsonb),
    '{visibility}',
    pg_catalog.to_jsonb(approved_visibility),
    true
  );
  return new;
end;
$$;

revoke all on function private.bind_local_publish_visibility()
from public, anon, authenticated, service_role;

create trigger external_action_requests_bind_local_visibility
before insert or update of content_version_id, exact_payload
on public.external_action_requests
for each row execute function private.bind_local_publish_visibility();

update public.external_action_requests as request
set exact_payload = pg_catalog.jsonb_set(
  request.exact_payload,
  '{visibility}',
  pg_catalog.to_jsonb(version.structured_payload ->> 'visibility'),
  true
)
from public.content_versions as version
where request.channel = 'naver_blog'
  and request.workspace_id = version.workspace_id
  and request.content_version_id = version.id
  and version.structured_payload ->> 'visibility' in ('private', 'public')
  and request.exact_payload ->> 'visibility'
    is distinct from version.structured_payload ->> 'visibility';

comment on function private.bind_local_publish_visibility()
is 'Binds every Naver action request visibility to its immutable content version and repairs stale audit payloads.';
