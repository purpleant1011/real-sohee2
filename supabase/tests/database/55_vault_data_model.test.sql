-- ANI-1525: execute after the full migration replay, in one rollback-only transaction.
\set ON_ERROR_STOP on
begin;

create temporary table vault_assertions (name text primary key, passed boolean not null);

-- Missing tables or a changed queue definition must fail before the fixtures run.
insert into vault_assertions values
('four vault tables with RLS', (
  select count(*) = 4 from pg_class
  where relnamespace = 'public'::regnamespace and relname in
    ('vault_items', 'vault_variant_payloads', 'vault_events', 'preflight_runs')
    and relrowsecurity
)),
('due queue depends on schedules only, never vault', (
  select pg_get_functiondef('public.list_due_publish_schedules(timestamptz,integer)'::regprocedure)
    not ilike '%vault_items%'
)),
('no public write grants', (
  select count(*) = 0 from information_schema.role_table_grants
  where table_schema = 'public' and table_name in
    ('vault_items', 'vault_variant_payloads', 'vault_events', 'preflight_runs')
    and grantee in ('anon', 'authenticated', 'PUBLIC')
    and privilege_type in ('INSERT','UPDATE','DELETE')
));

do $$ begin
 if (select not bool_and(passed) from vault_assertions) then
   raise exception 'vault assertions failed: %', (select string_agg(name, ', ') from vault_assertions where not passed);
 end if;
end $$;

insert into auth.users(id,email) values
 ('e1111111-1111-4111-8111-111111111111','vault-a@test.invalid'),
 ('e2222222-2222-4222-8222-222222222222','vault-b@test.invalid');
insert into public.workspaces(id,name,created_by) values
 ('a1111111-1111-4111-8111-111111111111','Vault A','e1111111-1111-4111-8111-111111111111'),
 ('a2222222-2222-4222-8222-222222222222','Vault B','e2222222-2222-4222-8222-222222222222');
insert into public.content_items(id,workspace_id,channel,title,created_by) values
 ('b1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','instagram','Vault content','e1111111-1111-4111-8111-111111111111');
insert into public.content_versions(id,workspace_id,content_id,version_number,caption,fingerprint,created_by) values
 ('c1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',1,'Vault caption',repeat('a',64),'e1111111-1111-4111-8111-111111111111');
insert into public.vault_items(id,workspace_id,content_id,version_id,channel,release_gate,hold_reason,held_at,approved_fingerprint,fingerprint_schema_version,policy_version,spec_version,approval_state,idempotency_key)
values ('d1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','instagram','HELD_USER','USER_HELD',now(),repeat('b',64),3,'v1','v1','APPROVED','vault-a');
insert into public.vault_variant_payloads(workspace_id,vault_item_id,payload,preview_artifacts)
values ('a1111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','{"blocks":[]}','{}');
insert into public.vault_events(workspace_id,vault_item_id,event_type,payload)
values ('a1111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','HELD','{}');
insert into public.preflight_runs(workspace_id,vault_item_id,overall,items,triggered_by)
values ('a1111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','UNKNOWN','[]','e1111111-1111-4111-8111-111111111111');

-- Run negative SQL through a sandbox so expected errors do not abort the test transaction.
create function pg_temp.vault_rejected(query text) returns boolean language plpgsql as $$
begin execute query; return false;
exception when insufficient_privilege or check_violation or foreign_key_violation or unique_violation or raise_exception then return true;
end $$;

insert into vault_assertions values
('cross-workspace content FK denied', pg_temp.vault_rejected($q$
 insert into public.vault_items(workspace_id,content_id,version_id,channel,approved_fingerprint,fingerprint_schema_version,policy_version,spec_version,approval_state,idempotency_key)
 values ('a2222222-2222-4222-8222-222222222222','b1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','threads',repeat('c',64),3,'v1','v1','APPROVED','invalid')$q$)),
('idempotency unique per workspace', pg_temp.vault_rejected($q$
 insert into public.vault_items(workspace_id,content_id,version_id,channel,approved_fingerprint,fingerprint_schema_version,policy_version,spec_version,approval_state,idempotency_key)
 values ('a1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','threads',repeat('c',64),3,'v1','v1','APPROVED','vault-a')$q$)),
('append-only event update blocked', pg_temp.vault_rejected($q$update public.vault_events set event_type='TAMPERED'$q$)),
('append-only event delete blocked', pg_temp.vault_rejected($q$delete from public.vault_events$q$)),
('invalid sha rejected', pg_temp.vault_rejected($q$update public.vault_items set approved_fingerprint='bad' $q$)),
('bad channel rejected', pg_temp.vault_rejected($q$update public.vault_items set channel='daangn' $q$));

set local role authenticated;
select set_config('request.jwt.claim.sub','e2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claim.role','authenticated',true);
-- Can't write assertions as authenticated: test via anonymous DO exception checks and count in a session setting.
do $$
declare t text; n integer;
begin
 foreach t in array array['vault_items','vault_variant_payloads','vault_events','preflight_runs'] loop
  execute format('select count(*) from public.%I',t) into n;
  if n <> 0 then raise exception 'cross-workspace SELECT leaked %',t; end if;
  begin execute format('delete from public.%I',t); raise exception 'DELETE allowed %',t;
  exception when insufficient_privilege then null; end;
  begin execute format('update public.%I set workspace_id = workspace_id',t); raise exception 'UPDATE allowed %',t;
  exception when insufficient_privilege then null; end;
 end loop;
 begin
   insert into public.vault_items(workspace_id,content_id,version_id,channel,approved_fingerprint,fingerprint_schema_version,policy_version,spec_version,approval_state,idempotency_key)
   values ('a1111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','instagram',repeat('b',64),3,'v1','v1','APPROVED','token-forgery');
   raise exception 'INSERT allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$ declare t text; n integer;
begin
 foreach t in array array['vault_items','vault_variant_payloads','vault_events','preflight_runs'] loop
  execute format('select count(*) from public.%I',t) into n;
  if n <> 1 then raise exception 'owner SELECT % expected one, got %',t,n; end if;
 end loop;
end $$;
reset role;
-- Item alone must not enqueue a publish schedule or an external action.
do $$ begin
 if exists(select 1 from public.list_due_publish_schedules(now(),10)) then
   raise exception 'vault item entered due publish queue'; end if;
 if (select count(*) from public.external_action_requests where workspace_id='a1111111-1111-4111-8111-111111111111') <> 0 then
   raise exception 'vault item created external action'; end if;
 if (select not bool_and(passed) from vault_assertions) then
   raise exception 'vault checks failed: %', (select string_agg(name, ', ') from vault_assertions where not passed);
 end if;
end $$;
select count(*) as vault_assertions_passed from vault_assertions;
rollback;
