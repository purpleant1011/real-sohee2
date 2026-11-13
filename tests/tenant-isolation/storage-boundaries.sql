-- Storage schema is platform-owned. The raw replay stubs do not provision its
-- grants/RLS, so model those platform prerequisites explicitly in this transaction.
-- This tests SQL authorization only, NOT Storage HTTP/signing/token expiry.
begin;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
create temporary table storage_actors(ws uuid,actor uuid);
insert into storage_actors values
 ('a4111111-1111-4111-8111-111111111111','a4222222-2222-4222-8222-222222222222'),
 ('b4111111-1111-4111-8111-111111111111','b4222222-2222-4222-8222-222222222222');
insert into auth.users(id) select actor from storage_actors;
insert into public.workspaces(id,name,created_by) select ws,'fixture',actor from storage_actors;
insert into public.workspace_members(workspace_id,user_id,role,status)
 select ws,actor,'owner','active' from storage_actors on conflict (workspace_id,user_id) do update set status='active';
insert into public.media_assets(id,workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest)
 select ws,ws,'content-media',ws||'/'||actor||'/'||ws||'/fixture.jpg','content','image/jpeg',10,'confirmed',actor,repeat('a',64) from storage_actors;
insert into storage.objects(bucket_id,name,owner)
 select 'content-media',ws||'/'||actor||'/'||ws||'/fixture.jpg',actor from storage_actors;
do $$ declare person record; total int; forbidden_name text; rejected boolean; begin
 if (select public from storage.buckets where id='content-media') is distinct from false then raise exception 'content-media must remain private'; end if;
 for person in select * from storage_actors loop
  select ws||'/'||actor||'/'||ws||'/fixture.jpg' into forbidden_name from storage_actors where ws<>person.ws;
  perform set_config('request.jwt.claim.sub',person.actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',person.actor,'role','authenticated')::text,true);
  set local role authenticated;
  select count(*) into total from storage.objects;
  if total<>1 then raise exception 'own object positive control failed'; end if;
  select count(*) into total from storage.objects where name=forbidden_name;
  if total<>0 then raise exception 'foreign private attachment disclosed'; end if;
  delete from storage.objects where name=forbidden_name;
  get diagnostics total = row_count;
  if total<>0 then raise exception 'foreign attachment deleted'; end if;
  rejected:=false;
  begin insert into storage.objects(bucket_id,name,owner) values('content-media',forbidden_name,person.actor);
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'foreign attachment overwrite/upload allowed'; end if;
  reset role;
 end loop;
end $$;
select 'Private Storage SQL read/delete/upload boundaries verified; HTTP signed URLs NOT_VERIFIED';
rollback;
