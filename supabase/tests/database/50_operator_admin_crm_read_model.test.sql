begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_column('public', 'workspaces', 'workspace_kind', 'workspace classification is stored at the source');
select col_not_null('public', 'workspaces', 'workspace_kind', 'workspace classification cannot silently disappear');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.workspaces'::regclass and conname = 'workspaces_workspace_kind_check') like '%pilot%' and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.workspaces'::regclass and conname = 'workspaces_workspace_kind_check') like '%integration%', 'workspace classification is constrained');
select has_function('private', 'operator_workspace_admin_projection', array['uuid'], 'CRM projection helper exists');
select has_function('public', 'list_operator_workspaces', array['timestamptz','uuid','text','text','text','integer'], 'guarded customer list RPC exists');
select has_function('public', 'get_operator_workspace_detail', array['uuid'], 'guarded customer detail RPC exists');
select ok(has_function_privilege('authenticated', 'public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)', 'EXECUTE'), 'authenticated operators can call the guarded list RPC');
select ok(not has_function_privilege('anon', 'public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)', 'EXECUTE'), 'anonymous users cannot call the customer list RPC');
select ok(not has_function_privilege('service_role', 'public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)', 'EXECUTE'), 'service role cannot bypass the operator list boundary');
select ok(pg_get_functiondef('public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)'::regprocedure) like '%operator_mfa_required%', 'customer list reevaluates effective MFA policy');
select ok(pg_get_functiondef('public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)'::regprocedure) like '%workspace_kind <> ''integration''%', 'integration fixtures are hidden from the default customer list');
select ok(pg_get_functiondef('public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)'::regprocedure) like '%lifecycle.status = p_status%', 'customer list supports lifecycle filtering');
select ok(pg_get_functiondef('private.operator_workspace_admin_projection(uuid)'::regprocedure) like '%member_count%' and pg_get_functiondef('private.operator_workspace_admin_projection(uuid)'::regprocedure) like '%plan_code%', 'projection includes customer members and plan');
select ok(pg_get_functiondef('private.operator_workspace_admin_projection(uuid)'::regprocedure) like '%available_credits%' and pg_get_functiondef('private.operator_workspace_admin_projection(uuid)'::regprocedure) like '%published_this_month%', 'projection includes credit and publishing aggregates');
select ok(pg_get_functiondef('private.operator_workspace_admin_projection(uuid)'::regprocedure) like '%last_activity_at%' and pg_get_functiondef('private.operator_workspace_admin_projection(uuid)'::regprocedure) like '%agreement_status%', 'projection includes activity and agreement status');
select has_function('private', 'seed_operator_admin_crm_demo_data', array[]::text[], 'demo data requires an explicit service-side seed action');
select ok(pg_get_functiondef('private.seed_operator_admin_crm_demo_data()'::regprocedure) not like '%insert into public.credit_accounts%', 'demo seed relies on the canonical workspace credit entitlement trigger');
select ok(pg_get_functiondef('private.seed_operator_admin_crm_demo_data()'::regprocedure) not like '%insert into public.credit_ledger_entries%', 'demo seed does not create a second credit allowance');
select is((select count(*) from public.publish_attempts where workspace_id in ('b1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000005'))::integer, 0, 'demo seed does not fabricate public publishing results');
select is((select count(*) from public.channel_connections where workspace_id in ('b1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000005'))::integer, 0, 'demo seed does not fabricate provider credentials or channel connections');

select * from finish();
rollback;
