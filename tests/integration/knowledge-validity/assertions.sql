grant all on all tables in schema public to service_role;
set role service_role;
select public.decide_studio_proposal_with_validity(
 '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'confirm',
 '20000000-0000-4000-8000-000000000001', null, '2026-11-01T00:00:00+09:00', '2026-12-01T00:00:00+09:00');
do $$
begin
 if not exists(select 1 from public.knowledge_facts where valid_from = '2026-10-31T15:00:00Z' and valid_until = '2026-11-30T15:00:00Z' and content = '서비스 50,000원') then raise exception 'effective date was not persisted'; end if;
 if (select count(*) from public.knowledge_facts) <> 1 then raise exception 'expected one fact'; end if;
 if (select total_amount from public.reservations limit 1) <> 40000 then raise exception 'past booking amount changed'; end if;
end $$;
-- Exact retry creates no additional revision.
select public.decide_studio_proposal_with_validity(
 '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'confirm',
 '20000000-0000-4000-8000-000000000001', null, '2026-11-01T00:00:00+09:00', '2026-12-01T00:00:00+09:00');
do $$
begin
 begin
  perform public.decide_studio_proposal_with_validity('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','confirm','20000000-0000-4000-8000-000000000001',null,'2026-12-01T00:00:00+09:00',null);
  raise exception 'changed retry unexpectedly accepted';
 exception when unique_violation then null; end;
 begin
  perform public.decide_studio_proposal_with_validity('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','confirm','20000000-0000-4000-8000-000000000002',null,'2026-11-01T00:00:00+09:00',null);
  raise exception 'nonmember unexpectedly accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.decide_studio_proposal_with_validity('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','confirm','20000000-0000-4000-8000-000000000001',null,'2026-12-01T00:00:00+09:00','2026-11-01T00:00:00+09:00');
  raise exception 'inverted validity unexpectedly accepted';
 exception when invalid_parameter_value then null; end;
 if (select count(*) from public.knowledge_facts) <> 1 then raise exception 'duplicate fact'; end if;
end $$;
reset role;
do $$
begin
 if has_function_privilege('anon', 'public.decide_studio_proposal_with_validity(uuid,uuid,text,uuid,text,timestamptz,timestamptz)', 'execute') then raise exception 'anon execute grant'; end if;
 if has_function_privilege('authenticated', 'public.decide_studio_proposal_with_validity(uuid,uuid,text,uuid,text,timestamptz,timestamptz)', 'execute') then raise exception 'authenticated execute grant'; end if;
end $$;
select 'knowledge validity assertions passed' as result;
