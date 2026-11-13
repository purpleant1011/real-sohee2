-- Restore = a NEW head version copied from an older naver_blog version. History is never rewritten
-- and approval is never reused: the internal writer issues a fresh fingerprint and review state.
create function public.restore_naver_version(
  p_workspace_id uuid,
  p_content_id uuid,
  p_expected_base_version_id uuid,
  p_expected_base_fingerprint text,
  p_source_version_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_id uuid;
  base public.content_versions%rowtype;
  source public.content_versions%rowtype;
  media_ids jsonb;
  knowledge_ids jsonb;
begin
  if not coalesce(private.has_workspace_role(p_workspace_id, array['owner', 'manager', 'reviewer']::text[]), false) then
    raise exception '콘텐츠를 수정할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_expected_base_version_id is null or p_source_version_id is null
    or p_expected_base_fingerprint is null or p_expected_base_fingerprint !~ '^[a-f0-9]{64}$'
    or p_source_version_id = p_expected_base_version_id then
    raise exception '복원할 버전을 확인해 주세요.' using errcode = '22023';
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

  select * into source from public.content_versions version
  where version.workspace_id = p_workspace_id and version.content_id = p_content_id and version.id = p_source_version_id;
  if source.id is null
    or source.structured_payload ->> 'channel' is distinct from 'naver_blog'
    or jsonb_typeof(source.structured_payload -> 'editorBlocks') is distinct from 'array' then
    raise exception '복원할 수 있는 네이버 원고가 아닙니다.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(link.media_asset_id order by link.position), '[]'::jsonb)
  into media_ids from public.content_version_media link
  where link.workspace_id = p_workspace_id and link.version_id = source.id;
  select coalesce(jsonb_agg(link.knowledge_item_id order by link.knowledge_item_id), '[]'::jsonb)
  into knowledge_ids from public.content_version_knowledge link
  where link.workspace_id = p_workspace_id and link.version_id = source.id;

  return private.create_content_version_internal(
    p_workspace_id, p_content_id, source.caption, source.hashtags, source.disclosure,
    jsonb_build_object(
      'structuredPayload', source.structured_payload,
      'rightsConfirmed', source.rights -> 'confirmed',
      'generationEvidenceConfirmed', source.generation_evidence -> 'confirmed',
      'mediaIds', media_ids,
      'knowledgeIds', knowledge_ids,
      'harnessRuleIds', to_jsonb(source.harness_rule_ids),
      'revisionReason', '네이버 원고 v' || source.version_number::text || ' 복원'
    )
  );
end;
$$;

revoke all on function public.restore_naver_version(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.restore_naver_version(uuid, uuid, uuid, text, uuid) to authenticated;
