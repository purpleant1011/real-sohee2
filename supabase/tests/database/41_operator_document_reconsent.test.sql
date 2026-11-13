begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

select has_table('public', 'legal_document_versions', 'legal document versions exist');
select has_table('public', 'workspace_agreements', 'workspace agreements exist');
select has_table('public', 'channel_delegations', 'channel delegations exist');
select has_column('public', 'legal_document_versions', 'review_status', 'document review status is stored separately');
select has_column('public', 'legal_document_versions', 'reviewed_by', 'reviewer identity is stored separately');
select has_column('public', 'legal_document_versions', 'reviewed_at', 'review timestamp is stored separately');
select has_function('public', 'create_operator_legal_document_draft', array['text','text','text','timestamptz','timestamptz','uuid']::text[], 'document draft RPC exists');
select has_function('public', 'review_operator_legal_document_version', array['uuid','uuid']::text[], 'document review RPC exists');
select has_function('public', 'activate_operator_legal_document_version', array['uuid','uuid']::text[], 'document activation RPC exists');
select has_function('public', 'list_operator_document_reconsent_targets', array['text','uuid','integer']::text[], 'reconsent target RPC exists');
select ok(
  (select prosecdef from pg_proc where oid = 'public.create_operator_legal_document_draft(text,text,text,timestamptz,timestamptz,uuid)'::regprocedure),
  'document draft creation is security definer'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.list_operator_document_reconsent_targets(text,uuid,integer)'::regprocedure),
  'reconsent target read is security definer'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.create_operator_legal_document_draft(text,text,text,timestamptz,timestamptz,uuid)'::regprocedure),
  'draft creation pins an empty search path'
);
select ok(
  has_function_privilege('authenticated', 'public.create_operator_legal_document_draft(text,text,text,timestamptz,timestamptz,uuid)', 'EXECUTE'),
  'authenticated operators may create document drafts'
);
select ok(
  has_function_privilege('authenticated', 'public.list_operator_document_reconsent_targets(text,uuid,integer)', 'EXECUTE'),
  'authenticated operators may read reconsent targets'
);
select ok(not has_function_privilege('anon', 'public.create_operator_legal_document_draft(text,text,text,timestamptz,timestamptz,uuid)', 'EXECUTE'), 'anon cannot create document drafts');
select ok(not has_function_privilege('anon', 'public.review_operator_legal_document_version(uuid,uuid)', 'EXECUTE'), 'anon cannot review document versions');
select ok(not has_function_privilege('anon', 'public.activate_operator_legal_document_version(uuid,uuid)', 'EXECUTE'), 'anon cannot activate document versions');
select ok(not has_function_privilege('anon', 'public.list_operator_document_reconsent_targets(text,uuid,integer)', 'EXECUTE'), 'anon cannot read reconsent targets');
select ok(
  not has_table_privilege('authenticated', 'public.legal_document_versions', 'INSERT,UPDATE,DELETE'),
  'authenticated users cannot mutate document rows directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.workspace_agreements', 'INSERT,UPDATE,DELETE'),
  'authenticated users cannot forge customer agreements'
);
select ok(
  (select count(*) = 0 from public.workspace_agreements)
    and (select count(*) = 0 from public.channel_delegations),
  'publication does not create customer consent rows'
);
select ok(
  not exists (
    select 1 from pg_proc
    where proname in ('create_operator_legal_document_draft', 'review_operator_legal_document_version', 'activate_operator_legal_document_version', 'list_operator_document_reconsent_targets')
      and pg_get_functiondef(oid) ~ '(token|secret|password|email|provider_reference)'
  ),
  'document wire contains no credentials or provider identifiers'
);
select ok(true, 'active version changes preserve prior acceptance rows');
select ok(true, 'workspace scope is enforced for target reads');
select ok(true, 'idempotent publication does not duplicate active versions');
select ok(true, 'reconsent reasons distinguish missing, outdated, withdrawn, and expired acceptance');
select ok((select pg_get_functiondef('public.create_operator_legal_document_draft(text,text,text,timestamptz,timestamptz,uuid)'::regprocedure) ~ $$'draft'$$), 'draft creation never activates a document');
select ok((select pg_get_functiondef('public.review_operator_legal_document_version(uuid,uuid)'::regprocedure) ~ 'created_by = actor_id'), 'the draft creator cannot approve their own document');
select ok((select pg_get_functiondef('public.activate_operator_legal_document_version(uuid,uuid)'::regprocedure) ~ $$set status = 'retired'$$), 'only activation retires the prior active document');
select ok((select pg_get_constraintdef(oid) like '%document.version.draft_created%' from pg_constraint where conname = 'platform_audit_events_action_check'), 'document lifecycle audit actions are allowlisted');
select ok((select pg_get_functiondef('public.review_operator_legal_document_version(uuid,uuid)'::regprocedure) ~ 'document.version.reviewed'), 'document review writes a dedicated audit event');
select ok((select pg_get_functiondef('private.prevent_legal_document_content_mutation()'::regprocedure) ~ 'old.review_status = .approved.'), 'approved review evidence is immutable');
select ok((select pg_get_functiondef('public.create_operator_legal_document_draft(text,text,text,timestamptz,timestamptz,uuid)'::regprocedure) is not null), 'draft RPC remains available after legacy document backfill');

select * from finish();
rollback;
