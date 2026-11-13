do $$
declare ws uuid := '10000000-0000-4000-8000-000000000001'; cid uuid := '20000000-0000-4000-8000-000000000001';
  v1 uuid := '30000000-0000-4000-8000-000000000001'; head uuid; head_fp text; restored uuid; n integer;
begin
  select id, fingerprint into head, head_fp from content_versions where content_id = cid order by version_number desc limit 1;
  select count(*) into n from content_versions;
  perform set_config('test.allowed','no',false);
  begin perform public.restore_naver_version(ws,cid,head,head_fp,v1); raise exception 'unauthorized restore';
  exception when insufficient_privilege then null; end;
  perform set_config('test.allowed','yes',false);
  begin perform public.restore_naver_version(ws,cid,head,head_fp,head); raise exception 'self restore accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.restore_naver_version(ws,cid,v1,repeat('1',64),v1); raise exception 'stale base accepted';
  exception when invalid_parameter_value or serialization_failure then null; end;
  begin perform public.restore_naver_version('90000000-0000-4000-8000-000000000009',cid,head,head_fp,v1); raise exception 'cross-workspace restore';
  exception when serialization_failure then null; end;
  begin perform public.restore_naver_version(ws,cid,head,head_fp,'99999999-0000-4000-8000-000000000009'); raise exception 'unknown source accepted';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from content_versions) <> n then raise exception 'failed restore wrote a version'; end if;

  restored := public.restore_naver_version(ws,cid,head,head_fp,v1);
  if restored = v1 or (select count(*) from content_versions) <> n + 1 then raise exception 'restore must append a new version'; end if;
  if (select structured_payload from content_versions where id = restored) is distinct from (select structured_payload from content_versions where id = v1) then raise exception 'payload not restored'; end if;
  if (select current_version_id from content_items) is distinct from restored then raise exception 'head not moved'; end if;
  if (select status from content_items) is distinct from 'review' then raise exception 'approval reused'; end if;
  if (select media_asset_id from content_version_media where version_id = restored) is distinct from '50000000-0000-4000-8000-000000000001'::uuid then raise exception 'media lost'; end if;
  if has_function_privilege('anon','public.restore_naver_version(uuid,uuid,uuid,text,uuid)','execute') then raise exception 'anonymous grant'; end if;
end;
$$;
