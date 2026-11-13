-- Actual minimal-schema PostgreSQL assertions. Not a full historical migration replay.
-- Structural assertions precede behavioral tenant/role/revoke checks.
DO $$
DECLARE table_count integer;
BEGIN
  SELECT count(*) INTO table_count FROM pg_tables
  WHERE schemaname = 'public' AND tablename LIKE 'marketing_connector_%';
  IF table_count < 3 THEN RAISE EXCEPTION 'Expected connector foundation tables, found %', table_count; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE 'marketing_connector_%'
      AND c.relkind='r' AND NOT c.relrowsecurity
  ) THEN RAISE EXCEPTION 'Connector table without RLS'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'marketing_connector_%'
      AND (has_table_privilege('anon', format('public.%I', tablename), 'SELECT')
        OR has_table_privilege('anon', format('public.%I', tablename), 'INSERT')
        OR has_table_privilege('anon', format('public.%I', tablename), 'UPDATE')
        OR has_table_privilege('anon', format('public.%I', tablename), 'DELETE'))
  ) THEN RAISE EXCEPTION 'Anonymous connector access'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'marketing_connector_%'
      AND (has_table_privilege('authenticated', format('public.%I', tablename), 'INSERT')
        OR has_table_privilege('authenticated', format('public.%I', tablename), 'UPDATE')
        OR has_table_privilege('authenticated', format('public.%I', tablename), 'DELETE'))
  ) THEN RAISE EXCEPTION 'Direct authenticated mutation bypasses command boundary'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name LIKE 'marketing_connector_%'
      AND column_name IN ('access_token','refresh_token','password','raw_content','email_body')
  ) THEN RAISE EXCEPTION 'Unencrypted secret/raw-content field'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'marketing_connector_evidence'
      AND indexname = 'marketing_connector_evidence_latest_lookup_idx'
  ) THEN RAISE EXCEPTION 'Missing latest lookup index on marketing_connector_evidence'; END IF;
  RAISE NOTICE 'Structural connector RLS/anonymous/secret/index checks passed';
END $$;

insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000003'),
 ('00000000-0000-4000-8000-000000000004');
insert into public.workspaces(id, created_by) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role,status) values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','owner','active'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','manager','active'),
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','viewer','active'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','owner','active');
insert into public.marketing_connector_connections(workspace_id,connector_id,status,consent_generation,encrypted_credential_ref)
 values
 ('10000000-0000-4000-8000-000000000001','google_calendar','connected',1,'vault:private-ref'),
 ('10000000-0000-4000-8000-000000000001','gmail','connected',2,'vault:private-ref-gmail');
insert into public.marketing_connector_evidence(workspace_id,connector_id,source_id,revision,consent_generation,observed_at,expires_at,purpose,text,revoked_at) values
 ('10000000-0000-4000-8000-000000000001','google_calendar','valid','1',1,now()-interval '1 hour',now()+interval '1 day','marketing','행사 일정',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','revoked','1',1,now()-interval '1 hour',now()+interval '1 day','marketing','철회 자료',now()),
 ('10000000-0000-4000-8000-000000000001','google_calendar','expired','1',1,now()-interval '1 day',now()-interval '1 hour','marketing','만료 자료',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','wrong-generation','1',2,now()-interval '1 hour',now()+interval '1 day','marketing','다른 동의 자료',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-revoked','1',1,now()-interval '2 hours',now()+interval '1 day','marketing','이전 유효 일정',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-revoked','2',1,now()-interval '1 hour',now()+interval '1 day','marketing','최신 철회 일정',now()),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-expired','1',1,now()-interval '2 hours',now()+interval '1 day','marketing','이전 유효 일정',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-expired','2',1,now()-interval '1 hour',now()-interval '10 minutes','marketing','최신 만료 일정',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-tie','1',1,now()-interval '1 hour',now()+interval '1 day','marketing','동일시각 충돌 r1',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-tie','2',1,now()-interval '1 hour',now()+interval '1 day','marketing','동일시각 충돌 r2',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-future','1',1,now()-interval '2 hours',now()+interval '1 day','marketing','이전 유효 일정',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-future','2',1,now()+interval '2 hours',now()+interval '1 day','marketing','미래 후보 일정',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','skew-boundary-300','1',1,now()+interval '300 seconds',now()+interval '1 day','marketing','300초 스큐 허용 일정',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','skew-boundary-301','1',1,now()+interval '301 seconds',now()+interval '1 day','marketing','301초 스큐 초과 격리',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-purpose','1',1,now()-interval '2 hours',now()+interval '1 day','marketing','이전 마케팅 일정',null),
 ('10000000-0000-4000-8000-000000000001','google_calendar','same-source-purpose','2',1,now()-interval '1 hour',now()+interval '1 day','booking','최신 예약 일정',null),
 ('10000000-0000-4000-8000-000000000001','gmail','gen-mix','1',1,now()-interval '10 minutes',now()+interval '1 day','marketing','구세대 gen1 새일정',null),
 ('10000000-0000-4000-8000-000000000001','gmail','gen-mix','1',2,now()-interval '1 hour',now()+interval '1 day','marketing','활성 gen2 정상일정',null);
insert into public.marketing_connector_sync_jobs(workspace_id,connector_id,consent_generation,status)
 values ('10000000-0000-4000-8000-000000000001','google_calendar',1,'running');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
DO $$ begin
 if (select count(*) from public.marketing_connector_connections) <> 0 then raise exception 'Staff must not read owner/manager connectors'; end if;
 if (select count(*) from public.marketing_connector_evidence) <> 0 then raise exception 'Staff must not read sensitive connector evidence'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
DO $$ begin
 if (select count(*) from public.marketing_connector_connections) <> 0 then raise exception 'Cross-tenant connection leakage'; end if;
 if (select count(*) from public.marketing_connector_evidence) <> 0 then raise exception 'Cross-tenant evidence leakage'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$ begin
 if (select count(*) from public.marketing_connector_connections) <> 2 then raise exception 'Active manager cannot read own connectors'; end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'same-source-revoked') <> 0 then
   raise exception 'Older revision r1 resurrected after newer revision r2 revoked';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'same-source-expired') <> 0 then
   raise exception 'Older revision r1 resurrected after newer revision r2 expired';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'same-source-tie') <> 0 then
   raise exception 'Tied revisions on latest timestamp must fail closed';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'same-source-future') <> 0 then
   raise exception 'Future candidate must quarantine source without exposing or resurrecting past revision';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'skew-boundary-300') <> 1 then
   raise exception 'Within +300s clock skew candidate must be exposed';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'skew-boundary-301') <> 0 then
   raise exception 'Exceeding +300s clock skew (+301s) candidate must be quarantined';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'same-source-purpose' and purpose = 'marketing') <> 0 then
   raise exception 'Older marketing revision resurrected despite newer booking revision';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'same-source-purpose' and purpose = 'booking') <> 1 then
   raise exception 'Newest booking revision must be exposed';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'gen-mix' and consent_generation = 2) <> 1 then
   raise exception 'Gen2 item must be exposed in active gen2 connection';
 end if;
 if (select count(*) from public.marketing_connector_evidence where source_id = 'gen-mix' and consent_generation = 1) <> 0 then
   raise exception 'Older gen1 item must not be exposed';
 end if;
 if (select count(*) from public.marketing_connector_evidence) <> 4 then raise exception 'Evidence read count mismatch'; end if;
 begin
  perform encrypted_credential_ref from public.marketing_connector_connections;
  raise exception 'Credential refs must remain server-only';
 exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','',false);
DO $$ begin
 begin
  perform public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','google_calendar','00000000-0000-4000-8000-000000000001');
  raise exception 'Caller-controlled actor must not replace missing auth.uid';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$ declare receipt jsonb; begin
 begin
  perform public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','google_calendar','00000000-0000-4000-8000-000000000003');
  raise exception 'Actor parameter mismatch must be rejected';
 exception when insufficient_privilege then null; end;
 receipt := public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','google_calendar','00000000-0000-4000-8000-000000000001');
 if receipt->>'status' <> 'revoked' or (receipt->>'consent_generation')::integer <> 2 or (receipt->>'pending_deletion')::boolean <> true then
  raise exception 'Invalid revocation receipt %', receipt;
 end if;
 if (select count(*) from public.marketing_connector_evidence where connector_id = 'google_calendar') <> 0 then raise exception 'Evidence remains readable after revocation'; end if;
 receipt := public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','google_calendar','00000000-0000-4000-8000-000000000001');
 if (receipt->>'consent_generation')::integer <> 2 then raise exception 'Duplicate disconnect changed consent generation'; end if;
 begin
  perform public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','google_docs','00000000-0000-4000-8000-000000000001');
  raise exception 'Disconnect must not fabricate a never-connected account';
 exception when no_data_found then null; end;
end $$;
reset role;
DO $$ begin
 if (select count(*) from public.marketing_connector_sync_jobs where status='blocked') <> 1 then raise exception 'Running job not blocked'; end if;
 if (select count(*) from public.marketing_connector_evidence where revoked_at is not null) <> 16 then raise exception 'Evidence revocation not atomic'; end if;
 if (select count(*) from public.marketing_connector_deletion_jobs where status='pending') <> 1 then raise exception 'Durable deletion job not queued exactly once'; end if;
 if exists (select 1 from public.marketing_connector_connections where connector_id = 'google_calendar' and encrypted_credential_ref is not null) then raise exception 'Revoked connection still holds active credential reference'; end if;
 if (select encrypted_credential_ref from public.marketing_connector_deletion_jobs where connector_id='google_calendar') is distinct from 'vault:private-ref' then raise exception 'Deletion job must pin the revoked generation credential reference'; end if;
end $$;

-- A failed cleanup is still outstanding and must never read as complete.
update public.marketing_connector_deletion_jobs set status='failed' where connector_id='google_calendar';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$ declare receipt jsonb; begin
 receipt := public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','google_calendar','00000000-0000-4000-8000-000000000001');
 if (receipt->>'pending_deletion')::boolean is distinct from true then raise exception 'Failed cleanup falsely reported complete %', receipt; end if;
end $$;
reset role;

-- Cleanup completion must be reflected honestly on an idempotent repeat.
update public.marketing_connector_deletion_jobs set status='completed' where connector_id='google_calendar';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$ declare receipt jsonb; begin
 begin
  perform encrypted_credential_ref from public.marketing_connector_deletion_jobs;
  raise exception 'Deletion credential reference must remain server-only';
 exception when insufficient_privilege then null; end;
 receipt := public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','google_calendar','00000000-0000-4000-8000-000000000001');
 if (receipt->>'pending_deletion')::boolean <> false then raise exception 'Completed cleanup falsely reported pending'; end if;
end $$;
reset role;

-- A workspace creator is not an eternal authorization bypass after demotion.
update public.workspace_members set role='viewer', status='disabled'
 where workspace_id='10000000-0000-4000-8000-000000000001' and user_id='00000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$ begin
 if (select count(*) from public.marketing_connector_connections) <> 0 then raise exception 'Inactive creator bypasses connector RLS'; end if;
 begin
  perform public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','google_calendar','00000000-0000-4000-8000-000000000001');
  raise exception 'Inactive creator bypasses disconnect role guard';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Pending deletion duties outlive the requesting manager account.
insert into public.marketing_connector_connections(workspace_id,connector_id,status,consent_generation)
 values ('10000000-0000-4000-8000-000000000001','outlook_mail','connected',1);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select public.disconnect_marketing_connector('10000000-0000-4000-8000-000000000001','outlook_mail','00000000-0000-4000-8000-000000000002');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000002';
DO $$ begin
 if (select count(*) from public.marketing_connector_deletion_jobs) <> 2 or (select count(*) from public.marketing_connector_deletion_jobs where connector_id='outlook_mail' and status='pending') <> 1 then raise exception 'Account deletion erased durable cleanup duty'; end if;
end $$;
