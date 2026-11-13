begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'workspace_members', 'workspace_members exists');
select has_table('public', 'business_profiles', 'business_profiles exists');
select has_table('public', 'brand_profiles', 'brand_profiles exists');
select has_table('public', 'channel_connections', 'channel_connections exists');
select col_is_pk('public', 'workspaces', 'id', 'workspaces uses a UUID primary key');
select col_is_pk(
  'public',
  'workspace_members',
  array['workspace_id', 'user_id'],
  'membership primary key prevents duplicate members'
);
select has_index(
  'public',
  'workspace_members',
  'workspace_members_user_id_idx',
  'membership lookup index exists'
);
select has_index(
  'public',
  'channel_connections',
  'channel_connections_workspace_status_idx',
  'channel status lookup index exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspaces'::regclass),
  'workspaces RLS is enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspace_members'::regclass),
  'workspace_members RLS is enabled'
);
select has_function(
  'private',
  'is_workspace_member',
  array['uuid'],
  'workspace membership helper exists'
);
select has_function(
  'private',
  'has_workspace_role',
  array['uuid', 'text[]'],
  'workspace role helper exists'
);
select has_trigger(
  'public',
  'workspaces',
  'workspaces_add_owner_membership',
  'workspace creator becomes the first owner atomically'
);
select policies_are(
  'public',
  'workspace_members',
  array[
    'workspace members can read active peers',
    'owners can delete workspace members',
    'owners can insert workspace members',
    'owners can update workspace member roles'
  ],
  'workspace member policies are exact'
);
select policies_are(
  'public',
  'workspaces',
  array[
    'authenticated users can create workspaces',
    'workspace managers can update workspaces',
    'workspace members can read workspaces'
  ],
  'workspace policies are exact'
);
select ok(
  not has_table_privilege('anon', 'public.workspaces', 'SELECT'),
  'anonymous role cannot read workspaces'
);
select ok(
  has_table_privilege('authenticated', 'public.workspaces', 'SELECT'),
  'authenticated role has Data API access gated by RLS'
);
select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated policies can resolve private membership helpers'
);
select ok(
  not has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'),
  'anonymous role cannot invoke the platform RLS event function'
);
select ok(
  not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE'),
  'authenticated role cannot invoke the platform RLS event function'
);

select * from finish();
rollback;
