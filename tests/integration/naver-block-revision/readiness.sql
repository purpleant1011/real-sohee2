do $$ begin
  if public.naver_revision_readiness() <> '{"contract":"naver-revision-v1","ready":true}'::jsonb then
    raise exception 'Pinned commands should be ready';
  end if;
end $$;

begin;
revoke execute on function public.restore_naver_version(uuid,uuid,uuid,text,uuid) from authenticated;
do $$ begin
  if (public.naver_revision_readiness()->>'ready')::boolean then raise exception 'Missing authenticated grant accepted'; end if;
end $$;
rollback;

begin;
grant execute on function public.restore_naver_version(uuid,uuid,uuid,text,uuid) to public;
do $$ begin
  if (public.naver_revision_readiness()->>'ready')::boolean then raise exception 'Public write grant accepted'; end if;
end $$;
rollback;

begin;
alter function public.restore_naver_version(uuid,uuid,uuid,text,uuid) security definer;
do $$ begin
  if (public.naver_revision_readiness()->>'ready')::boolean then raise exception 'Security mode drift accepted'; end if;
end $$;
rollback;

begin;
create or replace function public.restore_naver_version(
  p_workspace_id uuid, p_content_id uuid, p_expected_base_version_id uuid,
  p_expected_base_fingerprint text, p_source_version_id uuid
) returns uuid language plpgsql security invoker set search_path = '' as $$
begin return p_source_version_id; end;
$$;
do $$ begin
  if (public.naver_revision_readiness()->>'ready')::boolean then raise exception 'Changed command body accepted'; end if;
end $$;
rollback;

begin;
drop function public.restore_naver_version(uuid,uuid,uuid,text,uuid);
do $$ begin
  if (public.naver_revision_readiness()->>'ready')::boolean then raise exception 'Dropped command accepted'; end if;
end $$;
rollback;
