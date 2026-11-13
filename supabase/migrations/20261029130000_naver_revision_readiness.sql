-- Read-only capability probe for the three pinned Naver revision commands.
-- No tenant data, history repair, or mutation is performed by this function.
create function public.naver_revision_readiness()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'naver-revision-v1',
    'ready',
    to_regprocedure('private.has_workspace_role(uuid,text[])') is not null
    and to_regprocedure('private.create_content_version_internal(uuid,uuid,text,text[],text,jsonb)') is not null
    and (select bool_and(coalesce(
      p.oid is not null
      and not p.prosecdef and not p.proretset
      and p.prorettype = 'uuid'::regtype
      and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
      and p.provolatile = 'v'
      and p.proargnames = expected.names
      and p.pronargdefaults = 0
      and p.proconfig = array['search_path=""']::text[]
      and md5(p.prosrc) = expected.body_md5
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
      and (select count(*) from pg_proc other where other.pronamespace = p.pronamespace and other.proname = p.proname) = 1,
      false))
    from (values
      ('public.create_naver_block_revision(uuid,uuid,uuid,text,integer,text)',
        array['p_workspace_id','p_content_id','p_expected_base_version_id','p_expected_base_fingerprint','p_block_index','p_replacement_text']::text[],
        '130f5ca5b6019464d06f017796518562'),
      ('public.restore_naver_version(uuid,uuid,uuid,text,uuid)',
        array['p_workspace_id','p_content_id','p_expected_base_version_id','p_expected_base_fingerprint','p_source_version_id']::text[],
        'cd253b0a87efaf855aa1a3915cf9d5d2'),
      ('public.create_naver_meta_revision(uuid,uuid,uuid,text,text,text[],text[])',
        array['p_workspace_id','p_content_id','p_expected_base_version_id','p_expected_base_fingerprint','p_title','p_keywords','p_hashtags']::text[],
        'f476f19125b7e0fbbd610546d54d1c4e')
    ) expected(signature, names, body_md5)
    left join pg_proc p on p.oid = to_regprocedure(expected.signature))
  );
$$;

revoke all on function public.naver_revision_readiness() from public, anon, authenticated, service_role;
grant execute on function public.naver_revision_readiness() to authenticated, service_role;
