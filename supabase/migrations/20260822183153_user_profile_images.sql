alter table public.profiles
  add column avatar_bucket text,
  add column avatar_path text,
  add column avatar_version integer not null default 0;

alter table public.profiles
  add constraint profiles_avatar_location_check check (
    (avatar_bucket is null and avatar_path is null)
    or (
      avatar_bucket = 'profile-images'
      and avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/avatar\.(jpg|png|webp)$'
      and split_part(avatar_path, '/', 1) = id::text
    )
  ),
  add constraint profiles_avatar_version_check check (avatar_version >= 0);

revoke update on public.profiles from authenticated;
grant update (display_name, avatar_bucket, avatar_path, avatar_version)
on public.profiles to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-images',
  'profile-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "profile image owners can read objects"
on storage.objects for select
to authenticated
using (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "profile image owners can insert objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "profile image owners can delete objects"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
