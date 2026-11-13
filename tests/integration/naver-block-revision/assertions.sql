do $$
declare next_id uuid; old_payload jsonb; next_payload jsonb;
begin
  -- Unauthorized caller, wrong workspace, invalid target, null CAS all fail before writes.
  perform set_config('test.allowed','no',false);
  begin
    perform public.create_naver_block_revision('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',repeat('1',64),1,'수정');
    raise exception 'unauthorized write accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('test.allowed','yes',false);
  begin
    perform public.create_naver_block_revision('90000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',repeat('1',64),1,'수정');
    raise exception 'cross-workspace write accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.create_naver_block_revision('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',null,1,'수정');
    raise exception 'null fingerprint accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_naver_block_revision('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',repeat('1',64),2,'수정');
    raise exception 'image edited as text';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_naver_block_revision('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',repeat('1',64),79,'수정');
    raise exception 'missing block accepted';
  exception when invalid_parameter_value then null; end;

  begin
    update content_versions set structured_payload = structured_payload #- '{editorBlocks,1,kind}' where version_number = 1;
    perform public.create_naver_block_revision('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',repeat('1',64),1,'수정');
    raise exception 'missing block kind accepted';
  exception when invalid_parameter_value then null; end;
  select structured_payload into old_payload from content_versions where version_number = 1;
  next_id := public.create_naver_block_revision('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',repeat('1',64),1,'새 둘째 문단');
  select structured_payload into next_payload from content_versions where id = next_id;
  if next_payload is distinct from jsonb_set(old_payload, '{editorBlocks,1,text}', '"새 둘째 문단"') then raise exception 'unselected payload changed'; end if;
  if (select caption from content_versions where id = next_id) is distinct from E'첫 문단\n\n새 둘째 문단' then raise exception 'caption projection stale'; end if;
  if (select structured_payload from content_versions where version_number = 1) is distinct from old_payload then raise exception 'base version mutated'; end if;
  if (select status from content_items) is distinct from 'review' then raise exception 'approval reused'; end if;
  if (select media_asset_id from content_version_media where version_id = next_id) is distinct from '50000000-0000-4000-8000-000000000001'::uuid then raise exception 'media lost'; end if;
  if (select knowledge_item_id from content_version_knowledge where version_id = next_id) is distinct from '70000000-0000-4000-8000-000000000001'::uuid then raise exception 'knowledge lost'; end if;
  if (select harness_rule_ids from content_versions where id = next_id) is distinct from array['60000000-0000-4000-8000-000000000001']::uuid[] then raise exception 'harness lost'; end if;
  begin
    perform public.create_naver_block_revision('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',repeat('1',64),1,'다른 기기의 덮어쓰기');
    raise exception 'stale write accepted';
  exception when serialization_failure then null; end;
  if (select count(*) from content_versions) <> 2 then raise exception 'extra version created'; end if;
  if has_function_privilege('anon','public.create_naver_block_revision(uuid,uuid,uuid,text,integer,text)','execute') then raise exception 'anonymous grant'; end if;
end;
$$;
