begin;

set local search_path = public, extensions;

select plan(9);

select has_function(
  'public',
  'create_initial_workspace',
  array['text', 'text', 'text'],
  'authenticated first-workspace RPC exists'
);

select function_lang_is(
  'public',
  'create_initial_workspace',
  array['text', 'text', 'text'],
  'sql',
  'public wrapper is a small SQL function'
);

select function_privs_are(
  'public',
  'create_initial_workspace',
  array['text', 'text', 'text'],
  'anon',
  array[]::text[],
  'anonymous users cannot create a workspace through the RPC'
);

select function_privs_are(
  'public',
  'create_initial_workspace',
  array['text', 'text', 'text'],
  'authenticated',
  array['EXECUTE'],
  'authenticated users may execute the public wrapper'
);

select lives_ok(
  $$
    select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
    insert into auth.users (id, email)
    values ('10000000-0000-4000-8000-000000000001', 'workspace-owner@example.com');
    set local role authenticated;
    select public.create_initial_workspace('소희 운영자', '빌더스 길드', 'Asia/Seoul');
  $$,
  'an authenticated user can create the first workspace'
);

select is(
  (select count(*)::integer from public.workspaces),
  1,
  'one workspace was created'
);

select is(
  (
    select count(*)::integer
    from public.workspace_members
    where user_id = '10000000-0000-4000-8000-000000000001'
      and role = 'owner'
      and status = 'active'
  ),
  1,
  'the creator became the active owner'
);

select is(
  (
    select count(*)::integer
    from (
      select public.create_initial_workspace('다른 이름', '중복 작업공간', 'Asia/Seoul')
    ) as repeated
  ),
  1,
  'an idempotent retry returns one workspace identifier'
);

select is(
  (select count(*)::integer from public.workspaces),
  1,
  'an idempotent retry does not create a second workspace'
);

select * from finish();
rollback;
