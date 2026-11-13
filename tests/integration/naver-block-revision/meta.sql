do $$
declare ws uuid := '10000000-0000-4000-8000-000000000001'; cid uuid := '20000000-0000-4000-8000-000000000001';
  head uuid; fp text; n integer; nid uuid; old jsonb;
begin
  select id, fingerprint, structured_payload into head, fp, old from content_versions where content_id = cid order by version_number desc limit 1;
  select count(*) into n from content_versions;
  perform set_config('test.allowed','no',false);
  begin perform public.create_naver_meta_revision(ws,cid,head,fp,'새 제목',array['태그'],array['#태그']); raise exception 'unauthorized';
  exception when insufficient_privilege then null; end;
  perform set_config('test.allowed','yes',false);
  begin perform public.create_naver_meta_revision(ws,cid,head,fp,'   ',array['태그'],array['#태그']); raise exception 'blank title';
  exception when invalid_parameter_value then null; end;
  begin perform public.create_naver_meta_revision(ws,cid,head,fp,'새 제목',array[]::text[],array[]::text[]); raise exception 'no keywords';
  exception when invalid_parameter_value then null; end;
  begin perform public.create_naver_meta_revision(ws,cid,head,fp,'새 제목',array['태그'],array['태그']); raise exception 'hashtag without #';
  exception when invalid_parameter_value then null; end;
  begin perform public.create_naver_meta_revision(ws,cid,head,fp,'새 제목',array['태그','둘'],array['#태그']); raise exception 'length mismatch';
  exception when invalid_parameter_value then null; end;
  begin perform public.create_naver_meta_revision(ws,cid,head,fp,old ->> 'title',array(select jsonb_array_elements_text(old -> 'keywords')),array['#태그']); raise exception 'no-op accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.create_naver_meta_revision(ws,cid,head,repeat('f',64),'새 제목',array['태그'],array['#태그']); raise exception 'stale';
  exception when serialization_failure then null; end;
  begin perform public.create_naver_meta_revision('90000000-0000-4000-8000-000000000009',cid,head,fp,'새 제목',array['태그'],array['#태그']); raise exception 'cross-workspace';
  exception when serialization_failure then null; end;
  if (select count(*) from content_versions) <> n then raise exception 'failed edit wrote a version'; end if;

  nid := public.create_naver_meta_revision(ws,cid,head,fp,'새 제목',array['새태그','둘째'],array['#새태그','#둘째']);
  if (select structured_payload from content_versions where id = nid)
     is distinct from jsonb_set(jsonb_set(old,'{title}','"새 제목"'),'{keywords}','["새태그","둘째"]') then raise exception 'other payload fields changed'; end if;
  if (select hashtags from content_versions where id = nid) is distinct from array['#새태그','#둘째'] then raise exception 'hashtags not synced'; end if;
  if (select caption from content_versions where id = nid) is distinct from (select caption from content_versions where id = head) then raise exception 'caption changed'; end if;
  if (select status from content_items) is distinct from 'review' then raise exception 'approval reused'; end if;
  if (select count(*) from content_version_media where version_id = nid) <> 1 then raise exception 'media lost'; end if;
  if has_function_privilege('anon','public.create_naver_meta_revision(uuid,uuid,uuid,text,text,text[],text[])','execute') then raise exception 'anonymous grant'; end if;
end;
$$;
