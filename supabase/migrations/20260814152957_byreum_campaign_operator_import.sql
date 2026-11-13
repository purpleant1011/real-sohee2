create or replace function public.import_byreum_campaign_pair(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_theme text,
  p_instagram_caption text,
  p_instagram_hashtags text[],
  p_threads_caption text,
  p_threads_hashtags text[],
  p_disclosure text,
  p_instagram_media_ids uuid[],
  p_threads_media_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_key text := 'byreum-campaign-2026-08-15:' || p_theme || ':import';
  existing_payload jsonb;
  instagram_connection_id uuid;
  threads_connection_id uuid;
  instagram_content_id uuid;
  threads_content_id uuid;
  instagram_version_id uuid;
  threads_version_id uuid;
  instagram_fingerprint text;
  threads_fingerprint text;
  instagram_dispatch jsonb;
  threads_dispatch jsonb;
  valid_media_count integer;
  result jsonb;
begin
  if p_theme not in ('natural', 'soft', 'balance')
    or p_instagram_caption is null or char_length(p_instagram_caption) not between 1 and 2200
    or p_threads_caption is null or char_length(p_threads_caption) not between 1 and 500
    or p_disclosure is null or char_length(p_disclosure) not between 1 and 500
    or cardinality(p_instagram_media_ids) <> 3
    or p_threads_media_id is null
    or p_threads_media_id = any(p_instagram_media_ids) then
    raise exception 'BYREUM_IMPORT_INPUT_INVALID';
  end if;

  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role in ('owner', 'manager')
  ) then
    raise exception 'BYREUM_IMPORT_FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || event_key, 0)
  );
  select payload into existing_payload
  from public.operation_events
  where workspace_id = p_workspace_id and operation_events.event_key = event_key;
  if existing_payload is not null then
    return existing_payload;
  end if;

  select count(*)::integer into valid_media_count
  from public.media_assets as asset
  join storage.objects as object
    on object.bucket_id = asset.bucket_id and object.name = asset.object_path
  where asset.workspace_id = p_workspace_id
    and asset.id = any(p_instagram_media_ids || p_threads_media_id)
    and asset.bucket_id = 'content-media'
    and asset.kind = 'content'
    and asset.rights_status = 'confirmed';
  if valid_media_count <> 4 then
    raise exception 'BYREUM_IMPORT_MEDIA_INVALID';
  end if;

  select min(id) into instagram_connection_id
  from public.channel_connections
  where workspace_id = p_workspace_id and channel = 'instagram' and status = 'connected';
  select min(id) into threads_connection_id
  from public.channel_connections
  where workspace_id = p_workspace_id and channel = 'threads' and status = 'connected';
  if instagram_connection_id is null or threads_connection_id is null then
    raise exception 'BYREUM_IMPORT_CONNECTION_MISSING';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_actor_user_id::text, 'role', 'authenticated')::text,
    true
  );

  insert into public.content_items (workspace_id, channel, title, status, created_by)
  values (p_workspace_id, 'instagram', 'BY.REUM ' || upper(p_theme) || ' Instagram', 'draft', p_actor_user_id)
  returning id into instagram_content_id;
  instagram_version_id := private.create_content_version_internal(
    p_workspace_id,
    instagram_content_id,
    p_instagram_caption,
    p_instagram_hashtags,
    p_disclosure,
    jsonb_build_object(
      'rightsConfirmed', true,
      'generationEvidenceConfirmed', true,
      'mediaIds', to_jsonb(p_instagram_media_ids),
      'knowledgeIds', '[]'::jsonb,
      'revisionReason', '승인된 BY.REUM V1.2 캠페인 운영 임포트'
    )
  );

  insert into public.content_items (workspace_id, channel, title, status, created_by)
  values (p_workspace_id, 'threads', 'BY.REUM ' || upper(p_theme) || ' Threads', 'draft', p_actor_user_id)
  returning id into threads_content_id;
  threads_version_id := private.create_content_version_internal(
    p_workspace_id,
    threads_content_id,
    p_threads_caption,
    p_threads_hashtags,
    p_disclosure,
    jsonb_build_object(
      'rightsConfirmed', true,
      'generationEvidenceConfirmed', true,
      'mediaIds', jsonb_build_array(p_threads_media_id),
      'knowledgeIds', '[]'::jsonb,
      'revisionReason', '승인된 BY.REUM V1.2 캠페인 운영 임포트'
    )
  );

  select fingerprint into instagram_fingerprint from public.content_versions where id = instagram_version_id;
  select fingerprint into threads_fingerprint from public.content_versions where id = threads_version_id;

  instagram_dispatch := public.approve_and_dispatch_meta_content(
    p_workspace_id, instagram_content_id, instagram_version_id, instagram_fingerprint,
    'publish_now', statement_timestamp(), 'Asia/Seoul', instagram_connection_id
  );
  threads_dispatch := public.approve_and_dispatch_meta_content(
    p_workspace_id, threads_content_id, threads_version_id, threads_fingerprint,
    'publish_now', statement_timestamp(), 'Asia/Seoul', threads_connection_id
  );

  result := jsonb_build_object(
    'theme', p_theme,
    'instagramContentId', instagram_content_id,
    'instagramVersionId', instagram_version_id,
    'instagramFingerprint', instagram_fingerprint,
    'instagramScheduleId', instagram_dispatch ->> 'scheduleId',
    'threadsContentId', threads_content_id,
    'threadsVersionId', threads_version_id,
    'threadsFingerprint', threads_fingerprint,
    'threadsScheduleId', threads_dispatch ->> 'scheduleId'
  );

  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload
  ) values (
    p_workspace_id,
    'content.publish_requested',
    event_key,
    'content_item',
    instagram_content_id,
    result
  );
  return result;
end;
$$;

revoke all on function public.import_byreum_campaign_pair(
  uuid, uuid, text, text, text[], text, text[], text, uuid[], uuid
) from public, anon, authenticated;
grant execute on function public.import_byreum_campaign_pair(
  uuid, uuid, text, text, text[], text, text[], text, uuid[], uuid
) to service_role;

comment on function public.import_byreum_campaign_pair(
  uuid, uuid, text, text, text[], text, text[], text, uuid[], uuid
) is 'One-time idempotent BY.REUM V1.2 campaign import that creates exact approved versions and publish schedules.';
