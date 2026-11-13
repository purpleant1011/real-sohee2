create or replace function private.create_content_version_internal(
  p_workspace_id uuid,
  p_content_id uuid,
  p_caption text,
  p_hashtags text[],
  p_disclosure text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version integer;
  new_version_id uuid;
  new_fingerprint text;
  media_ids jsonb;
  knowledge_ids jsonb;
  media_count integer;
  knowledge_count integer;
  distinct_id_count integer;
  valid_id_count integer;
  linked_count integer;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager', 'reviewer']::text[]
  )) then
    raise exception '콘텐츠 버전을 만들 권한이 없습니다.';
  end if;

  if p_caption is null or char_length(p_caption) not between 1 and 2200
    or p_hashtags is null or cardinality(p_hashtags) > 30
    or p_disclosure is null or char_length(p_disclosure) > 500
    or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
    or (
      p_metadata ? 'revisionReason'
      and (
        jsonb_typeof(p_metadata -> 'revisionReason') is distinct from 'string'
        or char_length(p_metadata ->> 'revisionReason') not between 1 and 500
      )
    ) then
    raise exception '콘텐츠 버전 입력이 올바르지 않습니다.';
  end if;

  if p_metadata -> 'rightsConfirmed' is distinct from 'true'::jsonb
    or p_metadata -> 'generationEvidenceConfirmed' is distinct from 'true'::jsonb then
    raise exception '권리와 생성 근거를 확인해 주세요.';
  end if;

  media_ids := p_metadata -> 'mediaIds';
  knowledge_ids := coalesce(p_metadata -> 'knowledgeIds', '[]'::jsonb);

  if jsonb_typeof(media_ids) is distinct from 'array' then
    raise exception '미디어를 1개 이상 10개 이하로 선택해 주세요.';
  end if;

  media_count := jsonb_array_length(media_ids);
  if media_count not between 1 and 10 then
    raise exception '미디어를 1개 이상 10개 이하로 선택해 주세요.';
  end if;
  select
    count(distinct lower(value))::integer,
    count(*) filter (
      where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )::integer
  into distinct_id_count, valid_id_count
  from jsonb_array_elements_text(media_ids);

  if distinct_id_count <> media_count or valid_id_count <> media_count then
    raise exception '미디어 선택에 중복되거나 잘못된 값이 있습니다.';
  end if;

  if jsonb_typeof(knowledge_ids) is distinct from 'array' then
    raise exception '지식 자료를 확인해 주세요.';
  end if;

  knowledge_count := jsonb_array_length(knowledge_ids);
  if knowledge_count > 50 then
    raise exception '지식 자료를 확인해 주세요.';
  end if;
  select
    count(distinct lower(value))::integer,
    count(*) filter (
      where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )::integer
  into distinct_id_count, valid_id_count
  from jsonb_array_elements_text(knowledge_ids);

  if distinct_id_count <> knowledge_count or valid_id_count <> knowledge_count then
    raise exception '지식 자료에 중복되거나 잘못된 값이 있습니다.';
  end if;

  perform 1
  from public.content_items
  where workspace_id = p_workspace_id and id = p_content_id
  for update;

  if not found then
    raise exception '콘텐츠를 찾을 수 없습니다.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into next_version
  from public.content_versions
  where workspace_id = p_workspace_id and content_id = p_content_id;

  new_fingerprint := encode(
    extensions.digest(
      convert_to(
        p_workspace_id::text || ':' || p_content_id::text || ':' || next_version::text || ':' ||
        p_caption || ':' || array_to_string(p_hashtags, ',') || ':' || p_disclosure || ':' ||
        p_metadata::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.content_versions (
    workspace_id, content_id, version_number, caption, hashtags, disclosure,
    rights, generation_evidence, revision_reason, fingerprint, created_by
  )
  values (
    p_workspace_id, p_content_id, next_version, p_caption, p_hashtags, p_disclosure,
    jsonb_build_object('confirmed', true),
    jsonb_build_object('confirmed', true),
    p_metadata ->> 'revisionReason', new_fingerprint, (select auth.uid())
  )
  returning id into new_version_id;

  insert into public.content_version_media (
    workspace_id, version_id, media_asset_id, position
  )
  select
    p_workspace_id,
    new_version_id,
    asset.id,
    (requested.ordinality - 1)::smallint
  from jsonb_array_elements_text(media_ids) with ordinality as requested(value, ordinality)
  join public.media_assets as asset
    on asset.workspace_id = p_workspace_id
   and asset.id = requested.value::uuid
   and asset.bucket_id = 'content-media'
   and asset.kind = 'content'
   and asset.rights_status = 'confirmed';

  get diagnostics linked_count = row_count;
  if linked_count <> media_count then
    raise exception '사용할 수 있는 미디어를 확인해 주세요.';
  end if;

  if knowledge_count > 0 then
    insert into public.content_version_knowledge (
      workspace_id, version_id, knowledge_item_id
    )
    select p_workspace_id, new_version_id, knowledge.id
    from jsonb_array_elements_text(knowledge_ids) as requested(value)
    join public.knowledge_items as knowledge
      on knowledge.workspace_id = p_workspace_id
     and knowledge.id = requested.value::uuid
     and knowledge.status = 'approved';

    get diagnostics linked_count = row_count;
    if linked_count <> knowledge_count then
      raise exception '사용할 수 있는 지식 자료를 확인해 주세요.';
    end if;
  end if;

  update public.content_items
  set current_version_id = new_version_id,
      status = 'review'
  where workspace_id = p_workspace_id and id = p_content_id;

  perform private.write_audit_event(
    p_workspace_id,
    'content.version_created',
    'content_version',
    new_version_id,
    jsonb_build_object('versionNumber', next_version, 'fingerprint', new_fingerprint)
  );

  return new_version_id;
end;
$$;
