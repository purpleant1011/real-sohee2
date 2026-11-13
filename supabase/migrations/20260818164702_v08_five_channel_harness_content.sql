alter table public.content_items
  drop constraint content_items_channel_check;

alter table public.content_items
  add constraint content_items_channel_check
  check (channel in ('instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business'));

alter table public.content_versions
  add column structured_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_payload) = 'object'),
  add column harness_rule_ids uuid[] not null default '{}'::uuid[];

alter table public.harness_rules
  drop constraint harness_rules_applies_to_channels_check;

alter table public.harness_rules
  add constraint harness_rules_applies_to_channels_check
  check (
    cardinality(applies_to_channels) <= 5
    and applies_to_channels <@ array[
      'instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business'
    ]::text[]
  );

update public.knowledge_sources
set refresh_policy = refresh_policy || jsonb_build_object(
  'ownership', 'owned',
  'allowedUse', 'business_facts',
  'requestedScope', 'business_facts',
  'collectionState', case
    when status = 'refresh_required' then 'refresh_required'
    else 'partial'
  end
)
where source_type = 'url'
  and not (refresh_policy ? 'collectionState');

alter table public.knowledge_sources
  add constraint knowledge_sources_url_collection_contract_check
  check (
    source_type <> 'url'
    or (
      refresh_policy ->> 'ownership' in ('owned', 'reference')
      and refresh_policy ->> 'allowedUse' in ('business_facts', 'pattern_only')
      and refresh_policy ->> 'requestedScope' in ('profile', 'posts', 'business_facts')
      and refresh_policy ->> 'collectionState' in (
        'complete', 'partial', 'connection_required', 'file_required',
        'access_limited', 'refresh_required'
      )
      and (
        refresh_policy ->> 'ownership' <> 'reference'
        or refresh_policy ->> 'allowedUse' = 'pattern_only'
      )
    )
  );

create index knowledge_sources_url_collection_state_idx
  on public.knowledge_sources (workspace_id, (refresh_policy ->> 'collectionState'), updated_at desc)
  where source_type = 'url';

create or replace function public.list_collectable_url_knowledge_sources(
  p_limit integer default 10
)
returns table (workspace_id uuid, source_id uuid)
language sql
security definer
set search_path = ''
as $$
  select source.workspace_id, source.id
  from public.knowledge_sources as source
  where source.source_type = 'url'
    and source.refresh_policy ->> 'collectionState' in ('partial', 'refresh_required')
  order by source.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 10), 10));
$$;

revoke all on function public.list_collectable_url_knowledge_sources(integer)
  from public, anon, authenticated;
grant execute on function public.list_collectable_url_knowledge_sources(integer)
  to service_role;

create table public.content_version_harness_rules (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version_id uuid not null,
  harness_rule_id uuid not null,
  position smallint not null check (position between 0 and 49),
  created_at timestamptz not null default now(),
  primary key (version_id, harness_rule_id),
  unique (version_id, position),
  foreign key (workspace_id, version_id)
    references public.content_versions (workspace_id, id) on delete cascade,
  foreign key (workspace_id, harness_rule_id)
    references public.harness_rules (workspace_id, id) on delete restrict
);

create index content_version_harness_rules_workspace_version_idx
  on public.content_version_harness_rules (workspace_id, version_id, position);

alter table public.content_version_harness_rules enable row level security;

create policy "workspace members can read content version harness rules"
on public.content_version_harness_rules for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on public.content_version_harness_rules from anon, authenticated;
grant select on public.content_version_harness_rules to authenticated;
grant select, insert, update, delete on public.content_version_harness_rules to service_role;

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
  content_channel text;
  media_ids jsonb;
  knowledge_ids jsonb;
  harness_ids jsonb;
  structured_payload jsonb;
  payload_media_ids jsonb;
  media_count integer;
  knowledge_count integer;
  harness_count integer;
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

  select item.channel into content_channel
  from public.content_items as item
  where item.workspace_id = p_workspace_id and item.id = p_content_id
  for update;

  if not found then
    raise exception '콘텐츠를 찾을 수 없습니다.';
  end if;

  media_ids := p_metadata -> 'mediaIds';
  knowledge_ids := coalesce(p_metadata -> 'knowledgeIds', '[]'::jsonb);
  harness_ids := coalesce(p_metadata -> 'harnessRuleIds', '[]'::jsonb);

  if jsonb_typeof(media_ids) is distinct from 'array' then
    raise exception '미디어 선택을 확인해 주세요.';
  end if;
  media_count := jsonb_array_length(media_ids);
  if media_count > 10 or (content_channel <> 'threads' and media_count < 1) then
    raise exception '채널에 맞는 미디어 선택을 확인해 주세요.';
  end if;
  select count(distinct lower(value))::integer,
    count(*) filter (where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')::integer
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
  select count(distinct lower(value))::integer,
    count(*) filter (where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')::integer
  into distinct_id_count, valid_id_count
  from jsonb_array_elements_text(knowledge_ids);
  if distinct_id_count <> knowledge_count or valid_id_count <> knowledge_count then
    raise exception '지식 자료에 중복되거나 잘못된 값이 있습니다.';
  end if;

  if jsonb_typeof(harness_ids) is distinct from 'array' then
    raise exception '하네스 규칙을 확인해 주세요.';
  end if;
  harness_count := jsonb_array_length(harness_ids);
  if harness_count > 50 then
    raise exception '하네스 규칙을 확인해 주세요.';
  end if;
  select count(distinct lower(value))::integer,
    count(*) filter (where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')::integer
  into distinct_id_count, valid_id_count
  from jsonb_array_elements_text(harness_ids);
  if distinct_id_count <> harness_count or valid_id_count <> harness_count then
    raise exception '하네스 규칙에 중복되거나 잘못된 값이 있습니다.';
  end if;

  structured_payload := p_metadata -> 'structuredPayload';
  if structured_payload is null then
    if content_channel = 'instagram' then
      structured_payload := jsonb_build_object(
        'channel', content_channel, 'caption', p_caption, 'hashtags', to_jsonb(p_hashtags),
        'slides', (select coalesce(jsonb_agg(jsonb_build_object(
          'mediaId', value,
          'placement', case when ordinality = 1 then 'cover' else 'inline' end,
          'altText', '콘텐츠 미디어 ' || ordinality::text
        )), '[]'::jsonb) from jsonb_array_elements_text(media_ids) with ordinality),
        'cta', '상담이 필요하면 문의해 주세요.'
      );
    elsif content_channel = 'threads' then
      structured_payload := jsonb_build_object(
        'channel', content_channel, 'segments', jsonb_build_array(p_caption),
        'mediaIds', media_ids, 'question', '어떤 점이 가장 궁금한가요?'
      );
    else
      raise exception '구조화 콘텐츠를 입력해 주세요.';
    end if;
  end if;

  if jsonb_typeof(structured_payload) is distinct from 'object'
    or structured_payload ->> 'channel' is distinct from content_channel then
    raise exception '콘텐츠 채널과 구조화 페이로드가 일치하지 않습니다.';
  end if;

  case content_channel
    when 'instagram' then
      if jsonb_typeof(structured_payload -> 'caption') is distinct from 'string'
        or jsonb_typeof(structured_payload -> 'hashtags') is distinct from 'array'
        or jsonb_typeof(structured_payload -> 'slides') is distinct from 'array'
        or jsonb_array_length(structured_payload -> 'slides') < 1
        or jsonb_typeof(structured_payload -> 'cta') is distinct from 'string' then
        raise exception '인스타그램 구조화 콘텐츠를 확인해 주세요.';
      end if;
      select coalesce(jsonb_agg(slide -> 'mediaId'), '[]'::jsonb) into payload_media_ids
      from jsonb_array_elements(structured_payload -> 'slides') as slide;
    when 'threads' then
      if jsonb_typeof(structured_payload -> 'segments') is distinct from 'array'
        or jsonb_array_length(structured_payload -> 'segments') < 1
        or jsonb_typeof(structured_payload -> 'mediaIds') is distinct from 'array'
        or jsonb_typeof(structured_payload -> 'question') is distinct from 'string' then
        raise exception '스레드 구조화 콘텐츠를 확인해 주세요.';
      end if;
      payload_media_ids := structured_payload -> 'mediaIds';
    when 'naver_blog' then
      if jsonb_typeof(structured_payload -> 'title') is distinct from 'string'
        or jsonb_typeof(structured_payload -> 'introduction') is distinct from 'string'
        or jsonb_typeof(structured_payload -> 'sections') is distinct from 'array'
        or jsonb_array_length(structured_payload -> 'sections') < 1
        or jsonb_typeof(structured_payload -> 'keywords') is distinct from 'array'
        or jsonb_array_length(structured_payload -> 'keywords') < 1
        or jsonb_typeof(structured_payload -> 'imagePlacements') is distinct from 'array'
        or jsonb_array_length(structured_payload -> 'imagePlacements') < 1
        or jsonb_typeof(structured_payload -> 'cta') is distinct from 'string' then
        raise exception '네이버 블로그 구조화 콘텐츠를 확인해 주세요.';
      end if;
      select coalesce(jsonb_agg(placement -> 'mediaId'), '[]'::jsonb) into payload_media_ids
      from jsonb_array_elements(structured_payload -> 'imagePlacements') as placement;
    when 'naver_place' then
      if structured_payload ->> 'postKind' is distinct from 'place_news'
        or jsonb_typeof(structured_payload -> 'title') is distinct from 'string'
        or jsonb_typeof(structured_payload -> 'body') is distinct from 'string'
        or jsonb_typeof(structured_payload -> 'mediaIds') is distinct from 'array'
        or jsonb_typeof(structured_payload -> 'validUntil') is distinct from 'string' then
        raise exception '네이버 플레이스 구조화 콘텐츠를 확인해 주세요.';
      end if;
      payload_media_ids := structured_payload -> 'mediaIds';
    when 'daangn_business' then
      if jsonb_typeof(structured_payload -> 'title') is distinct from 'string'
        or jsonb_typeof(structured_payload -> 'body') is distinct from 'string'
        or jsonb_typeof(structured_payload -> 'mediaIds') is distinct from 'array'
        or jsonb_typeof(structured_payload -> 'localCta') is distinct from 'string'
        or jsonb_typeof(structured_payload -> 'targetNeighborhood') is distinct from 'string' then
        raise exception '당근 비즈프로필 구조화 콘텐츠를 확인해 주세요.';
      end if;
      payload_media_ids := structured_payload -> 'mediaIds';
  end case;

  if payload_media_ids is distinct from media_ids then
    raise exception '구조화 콘텐츠의 미디어 순서를 확인해 주세요.';
  end if;

  select count(*)::integer into linked_count
  from public.harness_rules
  where workspace_id = p_workspace_id and id = any (
    array(select value::uuid from jsonb_array_elements_text(harness_ids))
  ) and status = 'active';
  if linked_count <> harness_count then
    raise exception '활성 하네스 규칙을 확인해 주세요.';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.content_versions
  where workspace_id = p_workspace_id and content_id = p_content_id;

  new_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'workspaceId', p_workspace_id, 'contentId', p_content_id, 'versionNumber', next_version,
          'captionProjection', jsonb_build_object('caption', p_caption, 'hashtags', to_jsonb(p_hashtags), 'disclosure', p_disclosure),
          'structuredPayload', structured_payload, 'mediaIds', media_ids,
          'knowledgeIds', knowledge_ids, 'harnessRuleIds', harness_ids
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.content_versions (
    workspace_id, content_id, version_number, caption, hashtags, disclosure,
    rights, generation_evidence, revision_reason, structured_payload, harness_rule_ids,
    fingerprint, created_by
  ) values (
    p_workspace_id, p_content_id, next_version, p_caption, p_hashtags, p_disclosure,
    jsonb_build_object('confirmed', true), jsonb_build_object('confirmed', true),
    p_metadata ->> 'revisionReason', structured_payload,
    array(select value::uuid from jsonb_array_elements_text(harness_ids)),
    new_fingerprint, (select auth.uid())
  ) returning id into new_version_id;

  insert into public.content_version_media (workspace_id, version_id, media_asset_id, position)
  select p_workspace_id, new_version_id, asset.id, (requested.ordinality - 1)::smallint
  from jsonb_array_elements_text(media_ids) with ordinality as requested(value, ordinality)
  join public.media_assets as asset
    on asset.workspace_id = p_workspace_id and asset.id = requested.value::uuid
    and asset.bucket_id = 'content-media' and asset.kind = 'content'
    and asset.rights_status = 'confirmed';
  get diagnostics linked_count = row_count;
  if linked_count <> media_count then
    raise exception '사용할 수 있는 미디어를 확인해 주세요.';
  end if;

  if knowledge_count > 0 then
    insert into public.content_version_knowledge (workspace_id, version_id, knowledge_item_id)
    select p_workspace_id, new_version_id, knowledge.id
    from jsonb_array_elements_text(knowledge_ids) as requested(value)
    join public.knowledge_items as knowledge
      on knowledge.workspace_id = p_workspace_id and knowledge.id = requested.value::uuid
      and knowledge.status = 'approved';
    get diagnostics linked_count = row_count;
    if linked_count <> knowledge_count then
      raise exception '사용할 수 있는 지식 자료를 확인해 주세요.';
    end if;
  end if;

  if harness_count > 0 then
    insert into public.content_version_harness_rules (
      workspace_id, version_id, harness_rule_id, position
    )
    select p_workspace_id, new_version_id, rule.id, (requested.ordinality - 1)::smallint
    from jsonb_array_elements_text(harness_ids) with ordinality as requested(value, ordinality)
    join public.harness_rules as rule
      on rule.workspace_id = p_workspace_id and rule.id = requested.value::uuid
      and rule.status = 'active';
    get diagnostics linked_count = row_count;
    if linked_count <> harness_count then
      raise exception '활성 하네스 규칙을 확인해 주세요.';
    end if;
  end if;

  update public.content_items set current_version_id = new_version_id, status = 'review'
  where workspace_id = p_workspace_id and id = p_content_id;

  perform private.write_audit_event(
    p_workspace_id, 'content.version_created', 'content_version', new_version_id,
    jsonb_build_object('versionNumber', next_version, 'fingerprint', new_fingerprint)
  );
  return new_version_id;
end;
$$;
