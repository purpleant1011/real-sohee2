begin;

create extension if not exists pgtap with schema extensions;

select plan(108);

select has_table('public', 'content_items', 'content items exist');
select has_table('public', 'content_versions', 'immutable content versions exist');
select has_table('public', 'media_assets', 'media assets exist');
select has_table('public', 'content_version_media', 'version media links exist');
select has_table('public', 'content_version_knowledge', 'version knowledge links exist');
select has_table('public', 'approvals', 'approvals exist');
select has_table('public', 'schedules', 'schedules exist');
select has_table('public', 'publish_attempts', 'publish attempts exist');
select has_table('public', 'report_snapshots', 'report snapshots exist');
select has_table('public', 'knowledge_items', 'knowledge items exist');
select has_table('public', 'automation_rules', 'automation rules exist');
select has_table('public', 'automation_runs', 'automation runs exist');
select has_table('public', 'notification_preferences', 'notification preferences exist');
select has_table('public', 'notifications', 'notifications exist');
select has_table('public', 'audit_events', 'audit events exist');
select has_table(
  'public', 'platform_admin_members',
  'platform administrator members exist'
);
select has_table('public', 'platform_roles', 'platform roles exist');
select has_table(
  'public', 'platform_role_permissions',
  'platform role permissions exist'
);
select has_table(
  'public', 'platform_admin_role_assignments',
  'platform administrator role assignments exist'
);
select has_column('public', 'notifications', 'event_key', 'notification event key exists');

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname in (
        'profiles', 'workspaces', 'workspace_members', 'business_profiles',
        'brand_profiles', 'channel_connections', 'content_items',
        'content_versions', 'media_assets', 'content_version_media',
        'content_version_knowledge', 'approvals', 'schedules',
        'publish_attempts', 'report_snapshots', 'knowledge_items',
        'automation_rules', 'automation_runs', 'notification_preferences',
      'notifications', 'audit_events', 'platform_admin_members',
      'platform_roles', 'platform_role_permissions',
      'platform_admin_role_assignments'
      )
      and relrowsecurity
  ),
  25,
  'all application tables have RLS enabled'
);

select has_function(
  'public', 'create_content_version',
  array['uuid', 'uuid', 'text', 'text[]', 'text', 'jsonb'],
  'version creation RPC exists'
);
select has_function(
  'public', 'approve_content_version',
  array['uuid', 'uuid', 'uuid', 'text', 'boolean', 'boolean', 'text'],
  'approval RPC exists'
);
select has_function(
  'public', 'schedule_approved_content',
  array['uuid', 'uuid', 'timestamptz', 'text', 'uuid'],
  'schedule RPC exists'
);
select has_function(
  'public', 'record_publish_attempt',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text'],
  'publish result RPC exists'
);
select has_function(
  'public', 'retry_publish_attempt',
  array['uuid', 'uuid', 'text'],
  'publish retry RPC exists'
);
select has_function(
  'public', 'reject_content_version',
  array['uuid', 'uuid', 'uuid', 'text', 'text'],
  'revision request RPC exists'
);
select has_function(
  'public', 'reschedule_content',
  array['uuid', 'uuid', 'timestamptz', 'text'],
  'schedule change RPC exists'
);
select has_function(
  'public', 'cancel_schedule',
  array['uuid', 'uuid'],
  'schedule cancellation RPC exists'
);
select has_function(
  'public', 'reserve_publish_attempt',
  array['uuid', 'uuid', 'text'],
  'mock publish reservation RPC exists'
);
select has_function(
  'public', 'reserve_publish_retry',
  array['uuid', 'uuid', 'text'],
  'mock publish retry reservation RPC exists'
);
select has_function(
  'public', 'review_knowledge_item',
  array['uuid', 'uuid', 'text'],
  'knowledge review RPC exists'
);
select has_function(
  'public', 'save_automation_rule',
  array['uuid', 'uuid', 'text', 'boolean', 'boolean'],
  'automation rule save RPC exists'
);
select has_function(
  'public', 'run_mock_automation',
  array['uuid', 'uuid', 'text'],
  'mock automation run RPC exists'
);

select has_index(
  'public', 'content_versions', 'content_versions_content_number_key',
  'content version numbers are unique per content item'
);
select has_index(
  'public', 'publish_attempts', 'publish_attempts_workspace_id_idempotency_key_key',
  'publish idempotency keys are unique per workspace'
);
select has_index(
  'public', 'approvals', 'approvals_workspace_version_idx',
  'approval version foreign key is indexed'
);
select has_index(
  'public', 'content_items', 'content_items_workspace_current_version_idx',
  'current version foreign key is indexed'
);
select has_index(
  'public', 'knowledge_items', 'knowledge_items_workspace_media_idx',
  'knowledge media foreign key is indexed'
);
select has_index(
  'public', 'schedules', 'schedules_workspace_content_idx',
  'schedule content foreign key is indexed'
);
select has_index(
  'public', 'schedules', 'schedules_workspace_version_idx',
  'schedule version foreign key is indexed'
);
select has_index(
  'public', 'schedules', 'schedules_one_active_approval_idx',
  'one approval cannot create duplicate active schedules'
);
select has_index(
  'public', 'notifications', 'notifications_workspace_user_event_key_key',
  'notification event keys prevent duplicate delivery records'
);
select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ),
  'notifications are published for authenticated realtime requery'
);
select has_trigger(
  'public', 'content_versions', 'content_versions_are_immutable',
  'content versions cannot be updated or deleted'
);

select ok(
  has_table_privilege('authenticated', 'public.content_versions', 'SELECT'),
  'authenticated users can read versions through RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.content_versions', 'UPDATE'),
  'authenticated users cannot update immutable versions'
);
select ok(
  not has_table_privilege('authenticated', 'public.content_versions', 'DELETE'),
  'authenticated users cannot delete immutable versions'
);
select ok(
  not has_table_privilege('authenticated', 'public.content_versions', 'INSERT'),
  'authenticated users cannot bypass the version creation RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.approvals', 'INSERT'),
  'authenticated users cannot bypass the approval RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.schedules', 'INSERT'),
  'authenticated users cannot bypass the schedule RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.publish_attempts', 'INSERT'),
  'authenticated users cannot bypass publish idempotency RPCs'
);
select ok(
  not has_column_privilege('authenticated', 'public.content_items', 'status', 'UPDATE'),
  'authenticated users cannot directly change content workflow state'
);
select ok(
  not has_column_privilege(
    'authenticated', 'public.content_items', 'current_version_id', 'UPDATE'
  ),
  'authenticated users cannot directly replace the current version'
);
select ok(
  not has_column_privilege('authenticated', 'public.content_items', 'status', 'INSERT'),
  'authenticated users cannot inject a workflow state when creating content'
);
select ok(
  not has_column_privilege(
    'authenticated', 'public.content_items', 'current_version_id', 'INSERT'
  ),
  'authenticated users cannot inject a current version when creating content'
);
select ok(
  has_column_privilege('authenticated', 'public.content_items', 'title', 'INSERT'),
  'authenticated content editors can still create draft content'
);
select ok(
  not has_table_privilege('authenticated', 'public.content_version_media', 'INSERT'),
  'authenticated users cannot mutate immutable version media directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.content_version_knowledge', 'INSERT'),
  'authenticated users cannot mutate immutable version knowledge directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.media_assets', 'INSERT'),
  'authenticated users cannot bypass server-side file signature validation'
);
select ok(
  not has_table_privilege('authenticated', 'public.knowledge_items', 'INSERT'),
  'authenticated users cannot forge approved knowledge records'
);
select ok(
  not has_table_privilege('authenticated', 'public.knowledge_items', 'UPDATE'),
  'authenticated users cannot bypass reviewed knowledge transitions'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.review_knowledge_item(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated workspace managers may call the knowledge review RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.review_knowledge_item(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous users cannot call the knowledge review RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.save_automation_rule(uuid,uuid,text,boolean,boolean)',
    'EXECUTE'
  ),
  'authenticated managers may call the automation save RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.save_automation_rule(uuid,uuid,text,boolean,boolean)',
    'EXECUTE'
  ),
  'anonymous users cannot call the automation save RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.run_mock_automation(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated managers may call the mock automation RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.run_mock_automation(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous users cannot call the mock automation RPC'
);
select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.knowledge_items'::regclass
      and conname = 'knowledge_items_status_check'
  ) like '%uploading%checking%review_required%approved%rejected%disabled%'
  and (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.knowledge_items'::regclass
      and conname = 'knowledge_items_status_check'
  ) not like '%failed%'
  and (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.knowledge_items'::regclass
      and conname = 'knowledge_items_status_check'
  ) not like '%archived%',
  'knowledge status constraint matches the approved application contract'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'INSERT'),
  'authenticated users cannot place secrets in audit metadata directly'
);
select ok(
  not has_table_privilege('anon', 'public.content_items', 'SELECT'),
  'anonymous users cannot read content'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_content_version(uuid,uuid,text,text[],text,jsonb)',
    'EXECUTE'
  ),
  'authenticated users may call the version RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_content_version(uuid,uuid,text,text[],text,jsonb)',
    'EXECUTE'
  ),
  'anonymous users may not call the version RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.approve_content_version(uuid,uuid,uuid,text,boolean,boolean,text)',
    'EXECUTE'
  ),
  'authenticated users may call the approval RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.approve_content_version(uuid,uuid,uuid,text,boolean,boolean,text)',
    'EXECUTE'
  ),
  'anonymous users may not call the approval RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.schedule_approved_content(uuid,uuid,timestamptz,text,uuid)',
    'EXECUTE'
  ),
  'authenticated users may call the schedule RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.schedule_approved_content(uuid,uuid,timestamptz,text,uuid)',
    'EXECUTE'
  ),
  'anonymous users may not call the schedule RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_publish_attempt(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated users cannot directly record publish outcomes'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.record_publish_attempt(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'anonymous users may not record publish outcomes'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.retry_publish_attempt(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated users may request a controlled retry'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.retry_publish_attempt(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous users may not request a retry'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.reject_content_version(uuid,uuid,uuid,text,text)', 'EXECUTE'
  ),
  'authenticated reviewers may call the revision request RPC'
);
select ok(
  not has_function_privilege(
    'anon', 'public.reject_content_version(uuid,uuid,uuid,text,text)', 'EXECUTE'
  ),
  'anonymous users may not reject content'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.reschedule_content(uuid,uuid,timestamptz,text)', 'EXECUTE'
  ),
  'authenticated workspace managers may call the reschedule RPC'
);
select ok(
  not has_function_privilege(
    'anon', 'public.reschedule_content(uuid,uuid,timestamptz,text)', 'EXECUTE'
  ),
  'anonymous users may not change schedules'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.cancel_schedule(uuid,uuid)', 'EXECUTE'
  ),
  'authenticated workspace managers may call the cancel RPC'
);
select ok(
  not has_function_privilege('anon', 'public.cancel_schedule(uuid,uuid)', 'EXECUTE'),
  'anonymous users may not cancel schedules'
);
select ok(
  not has_function_privilege('authenticated', 'public.reserve_publish_attempt(uuid,uuid,text)', 'EXECUTE'),
  'authenticated workspace managers cannot directly reserve a mock publish'
);
select ok(
  not has_function_privilege('anon', 'public.reserve_publish_attempt(uuid,uuid,text)', 'EXECUTE'),
  'anonymous users may not reserve a mock publish'
);
select ok(
  not has_function_privilege('authenticated', 'public.reserve_publish_retry(uuid,uuid,text)', 'EXECUTE'),
  'authenticated workspace managers cannot directly reserve a mock retry'
);
select ok(
  not has_function_privilege('anon', 'public.reserve_publish_retry(uuid,uuid,text)', 'EXECUTE'),
  'anonymous users may not reserve a mock retry'
);

select is(
  (
    select count(*)::integer
    from pg_proc
    where oid in (
      'public.create_content_version(uuid,uuid,text,text[],text,jsonb)'::regprocedure,
      'public.approve_content_version(uuid,uuid,uuid,text,boolean,boolean,text)'::regprocedure,
      'public.schedule_approved_content(uuid,uuid,timestamptz,text,uuid)'::regprocedure,
      'public.record_publish_attempt(uuid,uuid,text,text,text,text)'::regprocedure,
      'public.retry_publish_attempt(uuid,uuid,text)'::regprocedure
    )
      and not prosecdef
  ),
  5,
  'public RPC entrypoints remain security invokers'
);
select is(
  (
    select count(*)::integer
    from pg_proc
    where oid in (
      'public.reject_content_version(uuid,uuid,uuid,text,text)'::regprocedure,
      'public.reschedule_content(uuid,uuid,timestamptz,text)'::regprocedure,
      'public.cancel_schedule(uuid,uuid)'::regprocedure
    )
      and not prosecdef
  ),
  3,
  'approval and schedule lifecycle entrypoints remain security invokers'
);
select is(
  (
    select count(*)::integer from pg_proc
    where oid in (
      'public.reserve_publish_attempt(uuid,uuid,text)'::regprocedure,
      'public.reserve_publish_retry(uuid,uuid,text)'::regprocedure
    ) and not prosecdef
  ),
  2,
  'mock publish reservation entrypoints remain security invokers'
);
select is(
  (
    select count(*)::integer
    from pg_proc
    where oid in (
      'private.create_content_version_internal(uuid,uuid,text,text[],text,jsonb)'::regprocedure,
      'private.approve_content_version_internal(uuid,uuid,uuid,text,boolean,boolean,text)'::regprocedure,
      'private.schedule_approved_content_internal(uuid,uuid,timestamptz,text,uuid)'::regprocedure,
      'private.record_publish_attempt_internal(uuid,uuid,text,text,text,text)'::regprocedure,
      'private.retry_publish_attempt_internal(uuid,uuid,text)'::regprocedure
    )
      and prosecdef
  ),
  5,
  'private mutation implementations use controlled security definer access'
);
select is(
  (
    select count(*)::integer
    from pg_proc
    where oid in (
      'private.reject_content_version_internal(uuid,uuid,uuid,text,text)'::regprocedure,
      'private.schedule_approved_content_once_internal(uuid,uuid,timestamptz,text,uuid)'::regprocedure,
      'private.reschedule_content_internal(uuid,uuid,timestamptz,text)'::regprocedure,
      'private.cancel_schedule_internal(uuid,uuid)'::regprocedure
    )
      and prosecdef
  ),
  4,
  'new lifecycle mutations use controlled security definer access'
);
select is(
  (
    select count(*)::integer from pg_proc
    where oid in (
      'private.reserve_publish_attempt_internal(uuid,uuid,text)'::regprocedure,
      'private.reserve_publish_retry_internal(uuid,uuid,text)'::regprocedure
    ) and prosecdef
  ),
  2,
  'mock publish reservations use controlled security definer access'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.publish_reservation_context(uuid,uuid,boolean)', 'EXECUTE'
  ),
  'authenticated users cannot query reservation context directly'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.schedules'::regclass
      and conname = 'schedules_workspace_channel_connection_fkey'
      and contype = 'f'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.schedules'::regclass and attname = 'workspace_id'),
        (select attnum from pg_attribute where attrelid = 'public.schedules'::regclass and attname = 'channel_connection_id')
      ]::smallint[]
  ),
  'schedule channel connections are constrained to the same workspace'
);
select has_index(
  'public', 'schedules', 'schedules_workspace_channel_idx',
  'the workspace channel foreign key is indexed'
);
select ok(
  pg_get_functiondef(
    'private.schedule_approved_content_internal(uuid,uuid,timestamptz,text,uuid)'::regprocedure
  ) ~* 'for update of content',
  'schedule validation locks the approved content version against concurrent revision'
);
select ok(
  pg_get_functiondef(
    'private.record_publish_attempt_internal(uuid,uuid,text,text,text,text)'::regprocedure
  ) ~* 'pg_advisory_xact_lock',
  'publish idempotency keys are serialized before lookup and mutation'
);
select ok(
  pg_get_functiondef(
    'private.retry_publish_attempt_internal(uuid,uuid,text)'::regprocedure
  ) ~* 'for update',
  'publish retries lock their schedule before selecting the next attempt'
);
select has_function(
  'private', 'is_content_version_publishable', array['uuid', 'uuid'],
  'approval and scheduling share the same publishability validator'
);
select ok(
  pg_get_functiondef(
    'private.is_content_version_publishable(uuid,uuid)'::regprocedure
  ) ~* 'for share',
  'publishability validation locks linked evidence against concurrent invalidation'
);
select has_function(
  'private', 'write_audit_event', array['uuid', 'text', 'text', 'uuid', 'jsonb'],
  'safe internal audit writer exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.write_audit_event(uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated users cannot call the audit writer directly'
);

select is(
  (
    select count(*)::integer
    from pg_index as index_definition
    join pg_class as table_definition
      on table_definition.oid = index_definition.indrelid
    join pg_namespace as namespace_definition
      on namespace_definition.oid = table_definition.relnamespace
    where namespace_definition.nspname = 'public'
      and table_definition.relname in (
        'content_items', 'content_versions', 'media_assets',
        'content_version_media', 'content_version_knowledge', 'approvals',
        'schedules', 'publish_attempts', 'report_snapshots', 'knowledge_items',
        'automation_rules', 'automation_runs', 'notification_preferences',
        'notifications', 'audit_events'
      )
      and index_definition.indisvalid
  ) > 20,
  true,
  'content and operations tables have lookup and relationship indexes'
);

select * from finish();
rollback;
