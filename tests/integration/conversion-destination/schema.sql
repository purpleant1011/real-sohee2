begin;

do $$ begin
  if to_regclass('public.workspace_conversion_versions') is null then
    raise exception 'W7 conversion version ledger is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.workspace_conversion_versions'::regclass) then
    raise exception 'RLS must be enabled';
  end if;
  if has_table_privilege('anon', 'public.workspace_conversion_versions', 'SELECT')
     or has_table_privilege('authenticated', 'public.workspace_conversion_versions', 'SELECT')
     or has_table_privilege('authenticated', 'public.workspace_conversion_versions', 'INSERT') then
    raise exception 'Conversion settings are server-command-only';
  end if;
end $$;

insert into auth.users(id, email) values
 ('a7000000-0000-4000-8000-000000000001', 'w7-owner-a@example.invalid'),
 ('a7000000-0000-4000-8000-000000000002', 'w7-owner-b@example.invalid');
insert into public.workspaces(id, name, created_by) values
 ('b7000000-0000-4000-8000-000000000001', 'W7 TEST 가게 A', 'a7000000-0000-4000-8000-000000000001'),
 ('b7000000-0000-4000-8000-000000000002', 'W7 TEST 가게 B', 'a7000000-0000-4000-8000-000000000002');

set local role service_role;
insert into public.workspace_conversion_versions(workspace_id,dataset_mode,revision,command_id,command_digest,booking_url,confirmed_at,confirmed_by) values
 ('b7000000-0000-4000-8000-000000000001','TEST',1,'c7000000-0000-4000-8000-000000000001',repeat('a',64),'https://booking.example.com/a',now(),'a7000000-0000-4000-8000-000000000001'),
 ('b7000000-0000-4000-8000-000000000002','TEST',1,'c7000000-0000-4000-8000-000000000002',repeat('b',64),'https://booking.example.com/b',now(),'a7000000-0000-4000-8000-000000000002');

do $$ begin
  begin
    insert into public.workspace_conversion_versions(workspace_id,dataset_mode,revision,command_id,command_digest,confirmed_at) values
    ('b7000000-0000-4000-8000-000000000001','TEST',1,'c7000000-0000-4000-8000-000000000003',repeat('c',64),now());
    raise exception 'Competing revision was accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.workspace_conversion_versions(workspace_id,dataset_mode,revision,command_id,command_digest,confirmed_at) values
    ('b7000000-0000-4000-8000-000000000001','TEST',2,'c7000000-0000-4000-8000-000000000001',repeat('c',64),now());
    raise exception 'Command ID was reused';
  exception when unique_violation then null; end;
  begin
    update public.workspace_conversion_versions set booking_url='https://booking.example.com/changed' where workspace_id='b7000000-0000-4000-8000-000000000001';
    raise exception 'Immutable version was updated';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.workspace_conversion_versions where workspace_id='b7000000-0000-4000-8000-000000000001';
    raise exception 'Immutable version was deleted';
  exception when insufficient_privilege then null; end;
end $$;

insert into public.workspace_conversion_versions(workspace_id,dataset_mode,revision,command_id,command_digest,booking_url,confirmed_at,confirmed_by) values
 ('b7000000-0000-4000-8000-000000000001','TEST',2,'c7000000-0000-4000-8000-000000000004',repeat('d',64),'https://booking.example.com/a-v2',now(),'a7000000-0000-4000-8000-000000000001'),
 ('b7000000-0000-4000-8000-000000000001','ACTUAL',1,'c7000000-0000-4000-8000-000000000005',repeat('e',64),'https://booking.example.com/a-actual',now(),'a7000000-0000-4000-8000-000000000001');

do $$ begin
  if (select count(*) from public.workspace_conversion_versions where workspace_id='b7000000-0000-4000-8000-000000000001' and dataset_mode='ACTUAL') <> 1 then
    raise exception 'ACTUAL and TEST isolation failed';
  end if;
  if (select booking_url from public.workspace_conversion_versions where workspace_id='b7000000-0000-4000-8000-000000000001' and dataset_mode='TEST' and revision=1) <> 'https://booking.example.com/a' then
    raise exception 'Old version was not preserved';
  end if;
  begin
    insert into public.workspace_conversion_versions(workspace_id,dataset_mode,revision,command_id,command_digest,confirmed_at) values
    ('b7000000-0000-4000-8000-000000000001','UNTRUSTED',3,'c7000000-0000-4000-8000-000000000006',repeat('f',64),now());
    raise exception 'Invalid dataset mode was accepted';
  exception when check_violation then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
  begin
    perform * from public.workspace_conversion_versions where workspace_id='b7000000-0000-4000-8000-000000000002';
    raise exception 'Account A read account B through the Data API';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
  begin
    perform * from public.workspace_conversion_versions where workspace_id='b7000000-0000-4000-8000-000000000001';
    raise exception 'Account B read account A through the Data API';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform * from public.workspace_conversion_versions;
    raise exception 'Anonymous conversion data access was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'W7 conversion schema, immutable history, dataset and two-account boundaries PASSED'
