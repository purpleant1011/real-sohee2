-- Canonical editorBlocks only; legacy SNS revision RPC remains unchanged.
create function public.create_naver_block_revision(
  p_workspace_id uuid,
  p_content_id uuid,
  p_expected_base_version_id uuid,
  p_expected_base_fingerprint text,
  p_block_index integer,
  p_replacement_text text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_id uuid;
  base public.content_versions%rowtype;
  payload jsonb;
  block jsonb;
  caption text;
  knowledge_ids jsonb;
  media_ids jsonb;
begin
  if not coalesce(private.has_workspace_role(p_workspace_id, array['owner', 'manager', 'reviewer']::text[]), false) then
    raise exception '콘텐츠를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_expected_base_version_id is null
    or p_expected_base_fingerprint is null
    or p_expected_base_fingerprint !~ '^[a-f0-9]{64}$'
    or p_block_index is null or p_block_index not between 0 and 79
    or p_replacement_text is null or char_length(btrim(p_replacement_text)) = 0 then
    raise exception '문단 수정 기준을 확인해 주세요.' using errcode = '22023';
  end if;

  select item.current_version_id into current_id
  from public.content_items item
  where item.workspace_id = p_workspace_id and item.id = p_content_id and item.channel = 'naver_blog'
  for update;
  if current_id is distinct from p_expected_base_version_id then
    raise exception '새 버전이 있어 다시 확인해야 합니다.' using errcode = '40001';
  end if;
  select * into base from public.content_versions version
  where version.workspace_id = p_workspace_id and version.content_id = p_content_id and version.id = current_id;
  if base.id is null or base.fingerprint is distinct from p_expected_base_fingerprint then
    raise exception '새 버전이 있어 다시 확인해야 합니다.' using errcode = '40001';
  end if;

  payload := base.structured_payload;
  if payload ->> 'channel' is distinct from 'naver_blog'
    or jsonb_typeof(payload -> 'editorBlocks') is distinct from 'array' then
    raise exception '편집 가능한 원고를 확인해 주세요.' using errcode = '22023';
  end if;
  block := payload -> 'editorBlocks' -> p_block_index;
  if block is null or coalesce(block ->> 'kind', '') not in ('paragraph', 'heading', 'quote', 'cta')
    or jsonb_typeof(block -> 'text') is distinct from 'string'
    or char_length(p_replacement_text) > (case block ->> 'kind'
      when 'heading' then 200 when 'quote' then 1000 when 'cta' then 500 else 8000 end)
    or block ->> 'text' = p_replacement_text then
    raise exception '텍스트 문단과 변경 내용을 확인해 주세요.' using errcode = '22023';
  end if;

  -- Only the selected text changes. All lineage, facts, settings, and media survive.
  payload := jsonb_set(payload, array['editorBlocks', p_block_index::text, 'text'], to_jsonb(p_replacement_text), false);
  select string_agg(case
    when part ? 'text' then part ->> 'text'
    when part ->> 'kind' = 'link' then (part ->> 'title') || ' (' || (part ->> 'url') || ')'
    when part ->> 'kind' = 'map' then part ->> 'placeName'
    else null end, E'\n\n' order by ordinal)
  into caption from jsonb_array_elements(payload -> 'editorBlocks') with ordinality as parts(part, ordinal);

  select coalesce(jsonb_agg(link.media_asset_id order by link.position), '[]'::jsonb)
  into media_ids from public.content_version_media link
  where link.workspace_id = p_workspace_id and link.version_id = base.id;
  select coalesce(jsonb_agg(link.knowledge_item_id order by link.knowledge_item_id), '[]'::jsonb)
  into knowledge_ids from public.content_version_knowledge link
  where link.workspace_id = p_workspace_id and link.version_id = base.id;

  -- Existing internal writer validates rights, media order, links, and issues a new fingerprint.
  return private.create_content_version_internal(
    p_workspace_id, p_content_id, left(caption, 2200), base.hashtags, base.disclosure,
    jsonb_build_object(
      'structuredPayload', payload,
      'rightsConfirmed', base.rights -> 'confirmed',
      'generationEvidenceConfirmed', base.generation_evidence -> 'confirmed',
      'mediaIds', media_ids,
      'knowledgeIds', knowledge_ids,
      'harnessRuleIds', to_jsonb(base.harness_rule_ids),
      'revisionReason', '네이버 원고 ' || (p_block_index + 1)::text || '번 블록 직접 수정'
    )
  );
end;
$$;

revoke all on function public.create_naver_block_revision(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.create_naver_block_revision(uuid, uuid, uuid, text, integer, text) to authenticated;
