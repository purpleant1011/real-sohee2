-- Title/keyword-only edit for naver_blog. editorBlocks, media, facts and strategy are carried over untouched.
create function public.create_naver_meta_revision(
  p_workspace_id uuid,
  p_content_id uuid,
  p_expected_base_version_id uuid,
  p_expected_base_fingerprint text,
  p_title text,
  p_keywords text[],
  p_hashtags text[]
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
  media_ids jsonb;
  knowledge_ids jsonb;
begin
  if not coalesce(private.has_workspace_role(p_workspace_id, array['owner', 'manager', 'reviewer']::text[]), false) then
    raise exception '콘텐츠를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_expected_base_version_id is null
    or p_expected_base_fingerprint is null or p_expected_base_fingerprint !~ '^[a-f0-9]{64}$'
    or p_title is null or char_length(btrim(p_title)) = 0 or char_length(p_title) > 200
    or p_keywords is null or coalesce(array_length(p_keywords, 1), 0) not between 1 and 30
    or p_hashtags is null or coalesce(array_length(p_hashtags, 1), 0) <> array_length(p_keywords, 1)
    or exists (select 1 from unnest(p_keywords) k where k is null or char_length(btrim(k)) = 0 or char_length(k) > 100)
    or exists (select 1 from unnest(p_hashtags) h where h is null or h !~ '^#[^\s#]+$') then
    raise exception '제목과 태그를 확인해 주세요.' using errcode = '22023';
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
  if payload ->> 'channel' is distinct from 'naver_blog' then
    raise exception '편집 가능한 원고를 확인해 주세요.' using errcode = '22023';
  end if;
  if payload ->> 'title' = p_title and payload -> 'keywords' = to_jsonb(p_keywords) then
    raise exception '변경된 내용이 없습니다.' using errcode = '22023';
  end if;
  payload := jsonb_set(jsonb_set(payload, '{title}', to_jsonb(p_title), false), '{keywords}', to_jsonb(p_keywords), false);

  select coalesce(jsonb_agg(link.media_asset_id order by link.position), '[]'::jsonb)
  into media_ids from public.content_version_media link
  where link.workspace_id = p_workspace_id and link.version_id = base.id;
  select coalesce(jsonb_agg(link.knowledge_item_id order by link.knowledge_item_id), '[]'::jsonb)
  into knowledge_ids from public.content_version_knowledge link
  where link.workspace_id = p_workspace_id and link.version_id = base.id;

  return private.create_content_version_internal(
    p_workspace_id, p_content_id, base.caption, p_hashtags, base.disclosure,
    jsonb_build_object(
      'structuredPayload', payload,
      'rightsConfirmed', base.rights -> 'confirmed',
      'generationEvidenceConfirmed', base.generation_evidence -> 'confirmed',
      'mediaIds', media_ids,
      'knowledgeIds', knowledge_ids,
      'harnessRuleIds', to_jsonb(base.harness_rule_ids),
      'revisionReason', '네이버 원고 제목·태그 직접 수정'
    )
  );
end;
$$;

revoke all on function public.create_naver_meta_revision(uuid, uuid, uuid, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.create_naver_meta_revision(uuid, uuid, uuid, text, text, text[], text[]) to authenticated;
