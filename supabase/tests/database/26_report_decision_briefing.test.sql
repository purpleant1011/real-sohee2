begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_table('public', 'report_decisions', 'report decisions exist');
select has_table('public', 'report_decision_evidence', 'report decision exact-version evidence exists');
select has_table('public', 'report_experiments', 'report experiments exist');
select ok((select relrowsecurity from pg_class where oid = 'public.report_decisions'::regclass), 'report decision RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.report_decision_evidence'::regclass), 'report decision evidence RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.report_experiments'::regclass), 'report experiment RLS is enabled');
select has_index('public', 'report_decisions', 'report_decisions_workspace_created_idx', 'workspace decision timeline index exists');
select has_index('public', 'report_decision_evidence', 'report_decision_evidence_version_idx', 'exact-version evidence lookup index exists');
select has_index('public', 'report_experiments', 'report_experiments_workspace_status_idx', 'workspace experiment status index exists');
select has_index('public', 'report_decisions', 'report_decisions_created_by_idx', 'decision creator foreign key index exists');
select has_index('public', 'report_decisions', 'report_decisions_conversation_thread_idx', 'decision conversation foreign key index exists');
select has_index('public', 'report_experiments', 'report_experiments_created_by_idx', 'experiment creator foreign key index exists');
select has_function(
  'public',
  'create_report_decision_with_evidence',
  array['uuid', 'text', 'timestamptz', 'timestamptz', 'jsonb', 'text', 'text', 'jsonb', 'jsonb', 'text', 'uuid[]'],
  'atomic report decision function exists'
);
select ok(
  not has_function_privilege('anon', 'public.create_report_decision_with_evidence(uuid,text,timestamptz,timestamptz,jsonb,text,text,jsonb,jsonb,text,uuid[])', 'EXECUTE'),
  'anonymous callers cannot create report decisions'
);
select ok(
  has_function_privilege('authenticated', 'public.create_report_decision_with_evidence(uuid,text,timestamptz,timestamptz,jsonb,text,text,jsonb,jsonb,text,uuid[])', 'EXECUTE'),
  'authenticated callers may use atomic report persistence through RLS'
);
select ok(
  exists (
    select 1 from pg_proc
    where oid = 'public.create_report_decision_with_evidence(uuid,text,timestamptz,timestamptz,jsonb,text,text,jsonb,jsonb,text,uuid[])'::regprocedure
      and not prosecdef
  ),
  'atomic report persistence remains security invoker'
);
select ok(not has_table_privilege('anon', 'public.report_decisions', 'SELECT'), 'anonymous role cannot read report decisions');
select ok(not has_table_privilege('anon', 'public.report_experiments', 'SELECT'), 'anonymous role cannot read report experiments');
select ok(has_table_privilege('authenticated', 'public.report_decisions', 'SELECT'), 'authenticated role can read decisions through RLS');
select ok(has_table_privilege('authenticated', 'public.report_experiments', 'SELECT'), 'authenticated role can read experiments through RLS');
select policies_are(
  'public',
  'report_decisions',
  array[
    'workspace managers create report decisions',
    'workspace managers update report decisions',
    'workspace members read report decisions'
  ],
  'report decision policies are exact'
);
select policies_are(
  'public',
  'report_experiments',
  array[
    'workspace managers create report experiments',
    'workspace managers update report experiments',
    'workspace members read report experiments'
  ],
  'report experiment policies are exact'
);

select * from finish();
rollback;
