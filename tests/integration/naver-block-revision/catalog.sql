-- Metadata only. Safe to run as a read-only preflight; no tenant rows are returned.
-- Pin deparser search_path so auth.users/auth.uid qualification is comparable.
set search_path = pg_catalog, public;
select c.relname as name, c.relrowsecurity as rls,
  md5((select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum)::text
    from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) as columns_md5,
  md5((select jsonb_agg(jsonb_build_array(p.policyname,p.roles,p.cmd,p.qual,p.with_check) order by p.policyname)::text
    from pg_policies p where p.schemaname='public' and p.tablename=c.relname)) as policies_md5,
  md5((select jsonb_agg(jsonb_build_array(k.conname,k.contype,pg_get_constraintdef(k.oid)) order by k.conname)::text
    from pg_constraint k where k.conrelid=c.oid)) as constraints_md5
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('content_items','content_versions','content_version_media','content_version_knowledge','media_assets','workspace_members')
order by c.relname;
