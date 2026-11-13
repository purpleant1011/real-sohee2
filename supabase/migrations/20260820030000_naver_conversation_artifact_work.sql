alter table public.conversation_artifacts
  add column if not exists title text,
  add column if not exists structured_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_payload) = 'object');

alter table public.conversation_artifacts
  drop constraint if exists conversation_artifacts_type_check;
alter table public.conversation_artifacts
  add constraint conversation_artifacts_type_check
  check (type in ('instagram_post', 'threads_post', 'naver_blog_post'));

alter function private.save_conversation_artifact_to_work_internal(uuid, uuid)
  rename to save_conversation_social_artifact_to_work_internal;

create function private.save_conversation_artifact_to_work_internal(
  p_artifact_id uuid,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  artifact public.conversation_artifacts%rowtype;
  source_thread_id uuid;
  media_ids uuid[];
  valid_media_count integer;
  latest_batch_status text;
  payload jsonb;
  image_placements jsonb;
  version_caption text;
  content_title text;
  new_content_item_id uuid;
  new_version_id uuid;
  new_work_item_id uuid;
  saved_version_number integer;
begin
  if (select auth.uid()) is null or p_artifact_id is null or p_request_key is null then
    raise exception '작업함 저장 요청이 올바르지 않습니다.' using errcode = 'P0001';
  end if;

  select candidate.* into artifact
  from public.conversation_artifacts as candidate
  where candidate.id = p_artifact_id
    and (select private.is_workspace_member(candidate.workspace_id))
  for update;

  if not found then
    raise exception '저장할 결과물을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  if artifact.type <> 'naver_blog_post' then
    return private.save_conversation_social_artifact_to_work_internal(p_artifact_id, p_request_key);
  end if;

  if not (select private.has_workspace_role(
    artifact.workspace_id,
    array['owner', 'manager', 'reviewer']::text[]
  )) then
    raise exception '결과물을 작업함에 저장할 권한이 없습니다.' using errcode = 'P0001';
  end if;

  if artifact.work_item_id is not null then
    if artifact.save_request_key is distinct from p_request_key then
      raise exception '이미 작업함에 저장된 결과물입니다.' using errcode = 'P0001';
    end if;
    select version_number into saved_version_number
    from public.content_versions
    where workspace_id = artifact.workspace_id and id = artifact.version_id;
    return jsonb_build_object(
      'artifactId', artifact.id, 'workItemId', artifact.work_item_id,
      'contentItemId', artifact.content_item_id, 'versionId', artifact.version_id,
      'versionNumber', saved_version_number
    );
  end if;

  if artifact.status not in ('partial', 'ready_for_review') then
    raise exception '검토할 수 있는 결과물만 작업함에 저장할 수 있습니다.' using errcode = 'P0001';
  end if;

  select batch.status into latest_batch_status
  from public.generation_batches as batch
  where batch.workspace_id = artifact.workspace_id and batch.artifact_id = artifact.id
  order by batch.created_at desc, batch.id desc limit 1;
  if (artifact.status = 'ready_for_review' and latest_batch_status <> 'succeeded')
    or (artifact.status = 'partial' and latest_batch_status <> 'partial') then
    raise exception '이미지 생성 상태를 다시 확인해 주세요.' using errcode = 'P0001';
  end if;

  select
    array_agg(slide.media_asset_id order by slide.position),
    count(*)::integer,
    jsonb_agg(jsonb_build_object(
      'mediaId', slide.media_asset_id,
      'placement', case when slide.position = 1 then 'cover' else 'inline' end,
      'altText', slide.alt_text
    ) order by slide.position)
  into media_ids, valid_media_count, image_placements
  from public.artifact_slides as slide
  join public.media_assets as media
    on media.workspace_id = slide.workspace_id
   and media.id = slide.media_asset_id
   and media.bucket_id = 'content-media'
   and media.kind = 'content'
   and media.rights_status = 'confirmed'
  join storage.objects as object
    on object.bucket_id = media.bucket_id and object.name = media.object_path
  where slide.workspace_id = artifact.workspace_id
    and slide.artifact_id = artifact.id
    and slide.status = 'succeeded'
    and slide.rights_status = 'confirmed';

  if valid_media_count not between 1 and 3 then
    raise exception '사용할 수 있는 결과 이미지가 없습니다.' using errcode = 'P0001';
  end if;

  payload := artifact.structured_payload || jsonb_build_object('imagePlacements', image_placements);
  if payload ->> 'channel' is distinct from 'naver_blog'
    or jsonb_typeof(payload -> 'title') is distinct from 'string'
    or jsonb_typeof(payload -> 'introduction') is distinct from 'string'
    or jsonb_typeof(payload -> 'sections') is distinct from 'array'
    or jsonb_array_length(payload -> 'sections') < 1
    or jsonb_typeof(payload -> 'keywords') is distinct from 'array'
    or jsonb_array_length(payload -> 'keywords') < 1
    or jsonb_typeof(payload -> 'cta') is distinct from 'string'
    or payload ->> 'visibility' is distinct from 'private' then
    raise exception '네이버 블로그 구조화 초안을 확인해 주세요.' using errcode = 'P0001';
  end if;

  content_title := left(payload ->> 'title', 200);
  version_caption := left(
    concat_ws(E'\n\n', payload ->> 'introduction', artifact.cta),
    2200
  );

  insert into public.content_items (workspace_id, channel, title, status, created_by)
  values (artifact.workspace_id, 'naver_blog', content_title, 'draft', (select auth.uid()))
  returning id into new_content_item_id;

  new_version_id := private.create_content_version_internal(
    artifact.workspace_id,
    new_content_item_id,
    version_caption,
    artifact.hashtags,
    artifact.disclosure,
    jsonb_build_object(
      'rightsConfirmed', true,
      'generationEvidenceConfirmed', true,
      'mediaIds', to_jsonb(media_ids),
      'knowledgeIds', '[]'::jsonb,
      'harnessRuleIds', '[]'::jsonb,
      'structuredPayload', payload,
      'revisionReason', '대화에서 선택한 네이버 블로그 게시물 제안'
    )
  );

  select thread_id into source_thread_id
  from public.messages
  where workspace_id = artifact.workspace_id and id = artifact.source_message_id;

  insert into public.work_items (
    workspace_id, type, title, summary, status, priority, owner_type,
    source_thread_id, source_message_id, content_item_id, created_by
  ) values (
    artifact.workspace_id, 'content', content_title, left(version_caption, 4000),
    'drafting', 'normal', 'shared', source_thread_id, artifact.source_message_id,
    new_content_item_id, (select auth.uid())
  ) returning id into new_work_item_id;

  update public.messages set work_item_id = new_work_item_id
  where workspace_id = artifact.workspace_id and id = artifact.source_message_id;

  update public.conversation_artifacts
  set work_item_id = new_work_item_id, content_item_id = new_content_item_id,
      version_id = new_version_id, save_request_key = p_request_key
  where workspace_id = artifact.workspace_id and id = artifact.id;

  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload
  ) values (
    artifact.workspace_id, 'content.plan.created', 'artifact:' || artifact.id::text || ':saved',
    'work_item', new_work_item_id, jsonb_build_object(
      'artifactId', artifact.id, 'contentItemId', new_content_item_id,
      'versionId', new_version_id, 'channel', 'naver_blog'
    )
  ) on conflict (workspace_id, event_key) do nothing;

  insert into public.notifications (workspace_id, user_id, kind, body, href, event_key)
  values (
    artifact.workspace_id, (select auth.uid()), 'system',
    '대화에서 선택한 네이버 블로그 제안이 검토 대상으로 저장됐습니다.',
    '/app/work/' || new_content_item_id::text,
    'artifact:' || artifact.id::text || ':saved'
  ) on conflict (workspace_id, user_id, event_key) where event_key is not null do nothing;

  select version_number into saved_version_number
  from public.content_versions
  where workspace_id = artifact.workspace_id and id = new_version_id;

  return jsonb_build_object(
    'artifactId', artifact.id, 'workItemId', new_work_item_id,
    'contentItemId', new_content_item_id, 'versionId', new_version_id,
    'versionNumber', saved_version_number
  );
end;
$$;

revoke all on function private.save_conversation_social_artifact_to_work_internal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.save_conversation_artifact_to_work_internal(uuid, uuid)
  from public, anon;
grant execute on function private.save_conversation_artifact_to_work_internal(uuid, uuid)
  to authenticated;
