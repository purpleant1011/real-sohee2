begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select ok(
  exists (
    select 1 from storage.buckets
    where id = 'content-media'
      and public is false
      and file_size_limit = 10485760
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  'content media bucket is private and constrained'
);
select ok(
  exists (
    select 1 from storage.buckets
    where id = 'knowledge-files'
      and public is false
      and file_size_limit = 8388608
      and allowed_mime_types = array['application/pdf', 'text/plain', 'image/jpeg', 'image/png']::text[]
  ),
  'knowledge bucket is private and constrained'
);

select has_function(
  'private', 'storage_path_workspace', array['text'],
  'storage path workspace parser exists'
);
select has_function(
  'private', 'is_valid_storage_object_path', array['text'],
  'strict storage path validator exists'
);
select has_function(
  'private', 'is_registered_storage_object', array['text', 'text', 'uuid'],
  'storage objects must be bound to a media asset record'
);

select is(
  private.storage_path_workspace(
    '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/photo.webp'
  ),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'workspace UUID is parsed from a valid path'
);
select ok(
  private.is_valid_storage_object_path(
    '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/photo.webp'
  ),
  'the canonical four-segment path is valid'
);
select ok(
  not private.is_valid_storage_object_path('../escape/secret.txt'),
  'path traversal is invalid'
);
select ok(
  not private.is_valid_storage_object_path(
    '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/folder/photo.webp'
  ),
  'nested or extra path segments are invalid'
);
select ok(
  not private.is_valid_storage_object_path(
    '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/.hidden'
  ),
  'hidden filenames are invalid'
);
select ok(
  not private.is_registered_storage_object(
    'content-media',
    '20000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/photo.webp',
    '10000000-0000-4000-8000-000000000001'
  ),
  'a canonical path without a media asset record is not authorized'
);

select policies_are(
  'storage',
  'objects',
  array[
    'profile image owners can delete objects',
    'profile image owners can insert objects',
    'profile image owners can read objects',
    'workspace managers can delete private objects',
    'workspace members can read private objects'
  ],
  'private object policies are exact'
);

select ok(
  not has_function_privilege('anon', 'private.storage_path_workspace(text)', 'EXECUTE'),
  'anonymous users cannot invoke the path parser'
);
select ok(
  not has_function_privilege('anon', 'private.is_valid_storage_object_path(text)', 'EXECUTE'),
  'anonymous users cannot invoke the path validator'
);
select ok(
  has_function_privilege('authenticated', 'private.storage_path_workspace(text)', 'EXECUTE'),
  'authenticated storage policies can invoke the path parser'
);
select ok(
  has_function_privilege('authenticated', 'private.is_valid_storage_object_path(text)', 'EXECUTE'),
  'authenticated storage policies can invoke the path validator'
);
select ok(
  not has_function_privilege(
    'anon', 'private.is_registered_storage_object(text,text,uuid)', 'EXECUTE'
  ),
  'anonymous users cannot probe registered storage records'
);
select ok(
  has_function_privilege(
    'authenticated', 'private.is_registered_storage_object(text,text,uuid)', 'EXECUTE'
  ),
  'authenticated storage policies can verify registered storage records'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'INSERT'
      and roles && array['anon'::name, 'public'::name]
  ),
  'anonymous users have no object upload policy'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'UPDATE'
      and policyname like 'workspace%'
  ),
  'upsert and object replacement are not enabled'
);

insert into auth.users (id, email)
values
  ('11000000-0000-4000-8000-000000000001', 'storage-owner@sohee.test.invalid'),
  ('11000000-0000-4000-8000-000000000002', 'storage-other@sohee.test.invalid'),
  ('11000000-0000-4000-8000-000000000003', 'storage-viewer@sohee.test.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);

insert into public.workspaces (id, name, created_by)
values (
  '21000000-0000-4000-8000-000000000001',
  'Storage A',
  '11000000-0000-4000-8000-000000000001'
);

insert into public.workspace_members (workspace_id, user_id, role, status)
values (
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000003',
  'viewer',
  'active'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'content-media',
      '21000000-0000-4000-8000-000000000001/11000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/photo.webp',
      '11000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'browser-authenticated owners cannot bypass server-side file validation'
);

reset role;
insert into public.media_assets (
  id, workspace_id, bucket_id, object_path, kind, mime_type, size_bytes,
  rights_status, created_by
)
values (
  '31000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'content-media',
  '21000000-0000-4000-8000-000000000001/11000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/photo.webp',
  'content',
  'image/webp',
  100,
  'confirmed',
  '11000000-0000-4000-8000-000000000001'
);
insert into storage.objects (bucket_id, name, owner)
values (
  'content-media',
  '21000000-0000-4000-8000-000000000001/11000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/photo.webp',
  '11000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
insert into public.workspaces (id, name, created_by)
values (
  '21000000-0000-4000-8000-000000000002',
  'Storage B',
  '11000000-0000-4000-8000-000000000002'
);
reset role;
insert into public.media_assets (
  id, workspace_id, bucket_id, object_path, kind, mime_type, size_bytes,
  rights_status, created_by
)
values (
  '31000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000002',
  'content-media',
  '21000000-0000-4000-8000-000000000002/11000000-0000-4000-8000-000000000002/31000000-0000-4000-8000-000000000002/photo.webp',
  'content',
  'image/webp',
  100,
  'confirmed',
  '11000000-0000-4000-8000-000000000002'
);
insert into storage.objects (bucket_id, name, owner)
values (
  'content-media',
  '21000000-0000-4000-8000-000000000002/11000000-0000-4000-8000-000000000002/31000000-0000-4000-8000-000000000002/photo.webp',
  '11000000-0000-4000-8000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'content-media'),
  1,
  'an owner cannot read another workspace objects'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'content-media',
      '21000000-0000-4000-8000-000000000002/11000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000003/cross.webp',
      '11000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'an owner cannot upload into another workspace'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'content-media',
      '21000000-0000-4000-8000-000000000001/11000000-0000-4000-8000-000000000003/31000000-0000-4000-8000-000000000004/viewer.webp',
      '11000000-0000-4000-8000-000000000003'
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a viewer cannot upload private objects'
);

select * from finish();
rollback;
