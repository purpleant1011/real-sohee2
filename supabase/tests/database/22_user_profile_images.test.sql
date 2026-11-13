begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select has_column('public', 'profiles', 'avatar_bucket', 'profiles store the avatar bucket');
select has_column('public', 'profiles', 'avatar_path', 'profiles store the private avatar path');
select has_column('public', 'profiles', 'avatar_version', 'profiles version avatar changes');

select ok(
  exists (
    select 1 from storage.buckets
    where id = 'profile-images'
      and public is false
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  'profile image bucket is private and constrained'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles keep row level security enabled'
);
select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'authenticated users can read profiles');
select ok(has_column_privilege('authenticated', 'public.profiles', 'avatar_bucket', 'UPDATE'), 'authenticated users can update their avatar bucket');
select ok(has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'UPDATE'), 'authenticated users can update their avatar path');
select ok(has_column_privilege('authenticated', 'public.profiles', 'avatar_version', 'UPDATE'), 'authenticated users can update their avatar version');
select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anonymous users cannot read profiles');

insert into auth.users (id, email)
values
  ('12000000-0000-4000-8000-000000000001', 'profile-one@sohee.test.invalid'),
  ('12000000-0000-4000-8000-000000000002', 'profile-two@sohee.test.invalid');

insert into public.profiles (id, display_name)
values
  ('12000000-0000-4000-8000-000000000001', '프로필 하나'),
  ('12000000-0000-4000-8000-000000000002', '프로필 둘');

insert into storage.objects (bucket_id, name, owner)
values (
  'profile-images',
  '12000000-0000-4000-8000-000000000002/32000000-0000-4000-8000-000000000002/avatar.webp',
  '12000000-0000-4000-8000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);

select is((select count(*)::integer from public.profiles), 1, 'a user sees only their own profile');

update public.profiles
set avatar_bucket = 'profile-images',
    avatar_path = '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/avatar.png',
    avatar_version = avatar_version + 1
where id = '12000000-0000-4000-8000-000000000001';

select is(
  (select avatar_version from public.profiles where id = '12000000-0000-4000-8000-000000000001'),
  1,
  'a user can update their own avatar metadata'
);

select lives_ok(
  $$update public.profiles
    set avatar_path = 'cross-user-path'
    where id = '12000000-0000-4000-8000-000000000002'$$,
  'updating another profile is filtered without exposing the row'
);
select is(
  (select count(*)::integer from public.profiles where avatar_path = 'cross-user-path'),
  0,
  'another profile remains hidden and unchanged'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'profile-images',
      '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/avatar.png',
      '12000000-0000-4000-8000-000000000001'
    )$$,
  'a user can upload a new immutable object under their own path'
);
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'profile-images'),
  1,
  'a user reads only their own profile image object'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'profile-images',
      '12000000-0000-4000-8000-000000000002/32000000-0000-4000-8000-000000000003/avatar.png',
      '12000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a user cannot upload under another user path'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile image owners can delete objects'
  ),
  'profile images define an owner-only delete policy for the Storage API'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile image owners can delete objects'
      and cmd = 'DELETE'
      and roles = array['authenticated'::name]
  ),
  'profile image deletion is limited to authenticated Storage API requests'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'UPDATE'
      and policyname like 'profile image%'
  ),
  'profile image upsert and overwrite remain disabled'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and roles && array['anon'::name, 'public'::name]
      and policyname like 'profile image%'
  ),
  'anonymous users have no profile image object policy'
);

select * from finish();
rollback;
