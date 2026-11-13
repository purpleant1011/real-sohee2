-- Full replay: actual public commands, private helpers, fingerprint writer, RLS and audit triggers.
-- Auth claims are local GUCs, not signed JWT/PostgREST integration.
insert into auth.users(id,email)
select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'full-schema-'||n||'@sohee.test.invalid' from generate_series(1,6) n;
insert into public.workspaces(id,name,created_by) values
 ('20000000-0000-4000-8000-000000000001','격리 A','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','격리 B','10000000-0000-4000-8000-000000000006');
insert into public.workspace_members(workspace_id,user_id,role,status) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','manager','active'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','reviewer','active'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','viewer','active');
insert into public.content_items(id,workspace_id,channel,title,created_by) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','naver_blog','격리 원고','10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','naver_blog','다른 원고','10000000-0000-4000-8000-000000000006');
insert into public.media_assets(id,workspace_id,bucket_id,object_path,kind,mime_type,size_bytes,rights_status,created_by,sha256_digest) values
 ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','content-media','full-schema/photo.png','content','image/png',68,'confirmed','10000000-0000-4000-8000-000000000001',repeat('a',64));

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
create temporary table created_version as select public.create_content_version(
 '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','기존 문단',array['#안내'],'AI 삽화',
 jsonb_build_object('rightsConfirmed',true,'generationEvidenceConfirmed',true,'mediaIds',jsonb_build_array('50000000-0000-4000-8000-000000000001'),
 'structuredPayload','{"channel":"naver_blog","title":"확인 안내","introduction":"도입","sections":[{"heading":"안내","body":"기존 문단"}],"keywords":["안내"],"cta":"문의","editorBlocks":[{"kind":"paragraph","text":"기존 문단"},{"kind":"image","mediaId":"50000000-0000-4000-8000-000000000001","altText":"사진"}],"imagePlacements":[{"mediaId":"50000000-0000-4000-8000-000000000001","placement":"cover","altText":"사진"}]}'::jsonb)) as id;
create temporary table baseline as select id,fingerprint,structured_payload from public.content_versions where id=(select id from created_version);
reset role;
grant select on baseline to authenticated;
insert into public.approvals(workspace_id,content_id,version_id,fingerprint,status,disclosure_confirmed,rights_confirmed,reason,decided_by)
select '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',id,fingerprint,'approved',true,true,'격리 승인','10000000-0000-4000-8000-000000000001' from baseline;

set role authenticated;
do $$ declare actor integer; base record; next_id uuid; next_row record; begin
 if public.naver_revision_readiness() <> '{"contract":"naver-revision-v1","ready":true}'::jsonb then raise exception 'readiness false on full schema'; end if;
 for actor in 1..3 loop
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-'||lpad(actor::text,12,'0'),false);
  select v.* into base from public.content_versions v join public.content_items i on i.current_version_id=v.id where i.id='30000000-0000-4000-8000-000000000001';
  next_id:=public.create_naver_block_revision(base.workspace_id,base.content_id,base.id,base.fingerprint,0,'수정 문단 '||actor);
  select * into next_row from public.content_versions where id=next_id;
  if next_row.fingerprint=base.fingerprint or next_row.structured_payload is distinct from jsonb_set(base.structured_payload,'{editorBlocks,0,text}',to_jsonb('수정 문단 '||actor)) then raise exception 'fingerprint or unrelated payload changed'; end if;
  if (select count(*) from public.content_version_media where version_id=next_id and media_asset_id='50000000-0000-4000-8000-000000000001')<>1 then raise exception 'media not preserved'; end if;
  if exists(select 1 from public.approvals where version_id=next_id) then raise exception 'approval inherited'; end if;
  begin
   perform public.create_naver_block_revision(base.workspace_id,base.content_id,base.id,base.fingerprint,0,'stale');
   raise exception 'stale write accepted';
  exception when serialization_failure then null; end;
  next_id:=public.create_naver_meta_revision(next_row.workspace_id,next_row.content_id,next_row.id,next_row.fingerprint,'새 제목 '||actor,array['안내'],array['#안내']);
  select * into next_row from public.content_versions where id=next_id;
  next_id:=public.restore_naver_version(next_row.workspace_id,next_row.content_id,next_row.id,next_row.fingerprint,(select id from baseline));
  if (select structured_payload from public.content_versions where id=next_id) is distinct from (select structured_payload from baseline) then raise exception 'restore payload differs'; end if;
 end loop;
 raise notice 'PASS: owner/manager/reviewer block/meta/restore, immutable version, media, approval and stale checks';
end $$;

-- Viewer, nonmember and other tenant cannot mutate or see B through A identity.
do $$ declare actor integer; base record; begin
 for actor in 4..6 loop
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-'||lpad(actor::text,12,'0'),false);
  begin
   perform public.create_naver_block_revision('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',(select id from baseline),(select fingerprint from baseline),0,'불허');
   raise exception 'unauthorized actor accepted';
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
 if exists(select 1 from public.content_items where workspace_id='20000000-0000-4000-8000-000000000002') then raise exception 'tenant B leaked'; end if;
 if (select structured_payload from public.content_versions where id=(select id from baseline)) is distinct from (select structured_payload from baseline) then raise exception 'old version changed'; end if;
 raise notice 'PASS: viewer/nonmember/cross-tenant deny and tenant RLS';
end $$;
reset role;
begin;
update public.media_assets set rights_status='rejected' where id='50000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare base record; count_before integer; begin
 select v.* into base from public.content_versions v join public.content_items i on i.current_version_id=v.id where i.id='30000000-0000-4000-8000-000000000001';
 select count(*) into count_before from public.content_versions;
 begin
  perform public.create_naver_block_revision(base.workspace_id,base.content_id,base.id,base.fingerprint,0,'권리 없는 사진 포함 수정');
  raise exception 'rights-invalid media was accepted';
 exception when raise_exception then
  if sqlerrm <> '사용할 수 있는 미디어를 확인해 주세요.' then raise; end if;
 end;
 if (select count(*) from public.content_versions) <> count_before then raise exception 'failed write left a version'; end if;
 raise notice 'PASS: revoked media rights reject and roll back version creation';
end $$;
rollback;
set role anon;
do $$ begin
 begin
  perform public.create_naver_block_revision(null,null,null,null,0,'불허');
  raise exception 'anon accepted';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS: anonymous command denied';
end $$;
reset role;
select 'FULL_SCHEMA_NAVER_REVISION_PASS';
