alter table public.generation_batches
  drop constraint generation_batches_requested_count_check,
  add constraint generation_batches_requested_count_check
  check (requested_count between 1 and 20);

alter table public.artifact_slides
  drop constraint artifact_slides_position_check,
  add constraint artifact_slides_position_check
  check (position between 1 and 20);

create or replace function private.materialize_naver_editor_blocks(
  p_blueprint jsonb,
  p_image_placements jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  block jsonb;
  kind text;
  slot_position integer;
  expected_position integer := 1;
  image_count integer;
  placement jsonb;
  result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_blueprint) is distinct from 'array'
    or jsonb_typeof(p_image_placements) is distinct from 'array' then
    raise exception '네이버 편집 블록 입력을 확인해 주세요.';
  end if;

  image_count := jsonb_array_length(p_image_placements);
  if jsonb_array_length(p_blueprint) not between 1 and 80
    or image_count not between 1 and 20 then
    raise exception '네이버 편집 블록 수를 확인해 주세요.';
  end if;

  for block in select value from jsonb_array_elements(p_blueprint)
  loop
    if jsonb_typeof(block) is distinct from 'object' then
      raise exception '네이버 편집 블록 형식을 확인해 주세요.';
    end if;
    kind := block ->> 'kind';
    if kind = 'image_slot' then
      begin
        slot_position := (block ->> 'position')::integer;
      exception when others then
        raise exception '네이버 이미지 자리 번호를 확인해 주세요.';
      end;
      if slot_position <> expected_position or slot_position > image_count then
        raise exception '네이버 이미지 자리 순서를 확인해 주세요.';
      end if;
      placement := p_image_placements -> (slot_position - 1);
      if jsonb_typeof(placement) is distinct from 'object'
        or jsonb_typeof(placement -> 'mediaId') is distinct from 'string'
        or coalesce(nullif(block ->> 'altText', ''), placement ->> 'altText') is null then
        raise exception '네이버 이미지 자리 내용을 확인해 주세요.';
      end if;
      result := result || jsonb_build_array(jsonb_build_object(
        'kind', 'image',
        'mediaId', placement ->> 'mediaId',
        'altText', coalesce(nullif(block ->> 'altText', ''), placement ->> 'altText')
      ));
      expected_position := expected_position + 1;
    elsif kind in ('paragraph', 'heading', 'quote', 'cta') then
      if jsonb_typeof(block -> 'text') is distinct from 'string'
        or char_length(block ->> 'text') < 1 then
        raise exception '네이버 텍스트 블록 내용을 확인해 주세요.';
      end if;
      result := result || jsonb_build_array(jsonb_build_object('kind', kind, 'text', block ->> 'text'));
    elsif kind = 'link' then
      if jsonb_typeof(block -> 'url') is distinct from 'string'
        or block ->> 'url' !~ '^https://'
        or jsonb_typeof(block -> 'title') is distinct from 'string'
        or char_length(block ->> 'title') < 1 then
        raise exception '네이버 링크 블록 내용을 확인해 주세요.';
      end if;
      result := result || jsonb_build_array(jsonb_build_object(
        'kind', 'link', 'url', block ->> 'url', 'title', block ->> 'title'
      ));
    else
      raise exception '지원하지 않는 네이버 편집 블록입니다.';
    end if;
  end loop;

  if expected_position - 1 <> image_count then
    raise exception '네이버 이미지 자리가 승인 이미지 수와 일치하지 않습니다.';
  end if;
  return result;
end;
$$;

revoke all on function private.materialize_naver_editor_blocks(jsonb, jsonb)
  from public, anon, authenticated;

do $$
declare
  definition text;
  previous_statement constant text := 'payload := artifact.structured_payload || jsonb_build_object(''imagePlacements'', image_placements);';
  rich_statement constant text := previous_statement || chr(10)
    || '  if artifact.structured_payload ? ''editorBlueprint'' then' || chr(10)
    || '    payload := payload || jsonb_build_object(''editorBlocks'', private.materialize_naver_editor_blocks(' || chr(10)
    || '      artifact.structured_payload -> ''editorBlueprint'', image_placements' || chr(10)
    || '    ));' || chr(10)
    || '  end if;';
begin
  select pg_get_functiondef(
    'private.save_conversation_artifact_to_work_internal(uuid,uuid)'::regprocedure
  ) into definition;
  if position('private.materialize_naver_editor_blocks' in definition) > 0 then
    return;
  end if;
  if position(previous_statement in definition) = 0 then
    raise exception 'save_conversation_artifact_to_work_internal payload contract changed';
  end if;
  execute replace(definition, previous_statement, rich_statement);
end;
$$;

do $$
declare
  definition text;
  previous_rule constant text := 'if valid_media_count not between 1 and 3 then';
  naver_rule constant text := 'if valid_media_count not between 1 and 20 then';
begin
  select pg_get_functiondef(
    'private.save_conversation_artifact_to_work_internal(uuid,uuid)'::regprocedure
  ) into definition;
  if position(naver_rule in definition) > 0 then
    return;
  end if;
  if position(previous_rule in definition) = 0 then
    raise exception 'Naver conversation artifact media count contract changed';
  end if;
  execute replace(definition, previous_rule, naver_rule);
end;
$$;
