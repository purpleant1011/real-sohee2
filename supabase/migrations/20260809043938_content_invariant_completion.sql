revoke insert on public.content_items from authenticated;
grant insert (id, workspace_id, channel, title, created_by)
  on public.content_items to authenticated;

alter policy "content editors can insert content items"
on public.content_items
with check (
  created_by = (select auth.uid())
  and status = 'draft'
  and current_version_id is null
  and (select private.has_workspace_role(
    workspace_id,
    array['owner', 'manager', 'reviewer']::text[]
  ))
);

create or replace function private.is_content_version_publishable(
  p_workspace_id uuid,
  p_version_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  media_count integer;
  valid_media_count integer;
  storage_object_count integer;
  knowledge_count integer;
  valid_knowledge_count integer;
begin
  perform 1
  from public.content_versions as version
  where version.workspace_id = p_workspace_id
    and version.id = p_version_id
    and version.rights -> 'confirmed' = 'true'::jsonb
    and version.generation_evidence -> 'confirmed' = 'true'::jsonb
  for share of version;

  if not found then return false; end if;

  select count(*)::integer into media_count
  from public.content_version_media as link
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id;

  if media_count not between 1 and 10 then return false; end if;

  perform asset.id
  from public.content_version_media as link
  join public.media_assets as asset
    on asset.workspace_id = link.workspace_id
   and asset.id = link.media_asset_id
   and asset.bucket_id = 'content-media'
   and asset.kind = 'content'
   and asset.rights_status = 'confirmed'
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id
  order by asset.id
  for share of asset;
  get diagnostics valid_media_count = row_count;

  if valid_media_count <> media_count then return false; end if;

  perform object.id
  from public.content_version_media as link
  join public.media_assets as asset
    on asset.workspace_id = link.workspace_id
   and asset.id = link.media_asset_id
  join storage.objects as object
    on object.bucket_id = asset.bucket_id
   and object.name = asset.object_path
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id
  order by object.id
  for share of object;
  get diagnostics storage_object_count = row_count;

  if storage_object_count <> media_count then return false; end if;

  select count(*)::integer into knowledge_count
  from public.content_version_knowledge as link
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id;

  perform knowledge.id
  from public.content_version_knowledge as link
  join public.knowledge_items as knowledge
    on knowledge.workspace_id = link.workspace_id
   and knowledge.id = link.knowledge_item_id
   and knowledge.status = 'approved'
  where link.workspace_id = p_workspace_id
    and link.version_id = p_version_id
  order by knowledge.id
  for share of knowledge;
  get diagnostics valid_knowledge_count = row_count;

  return valid_knowledge_count = knowledge_count;
end;
$$;

create or replace function private.write_audit_event(
  p_workspace_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_type not in (
    'content.version_created', 'content.approved', 'content.scheduled',
    'publish.recorded', 'publish.retry_requested'
  )
    or p_entity_type not in ('content_version', 'approval', 'schedule', 'publish_attempt')
    or p_metadata is null
    or jsonb_typeof(p_metadata) <> 'object'
    or octet_length(p_metadata::text) > 2000 then
    raise exception '감사 이벤트 입력이 올바르지 않습니다.';
  end if;

  insert into public.audit_events (
    workspace_id, actor_id, event_type, entity_type, entity_id, metadata
  ) values (
    p_workspace_id, (select auth.uid()), p_event_type, p_entity_type, p_entity_id, p_metadata
  );
end;
$$;

revoke execute on function private.is_content_version_publishable(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function private.write_audit_event(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;

revoke insert on public.audit_events from authenticated;
drop policy if exists "workspace owners can insert audit events" on public.audit_events;

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
    or p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
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
    rights, generation_evidence, fingerprint, created_by
  )
  values (
    p_workspace_id, p_content_id, next_version, p_caption, p_hashtags, p_disclosure,
    jsonb_build_object('confirmed', true),
    jsonb_build_object('confirmed', true),
    new_fingerprint, (select auth.uid())
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

create or replace function private.approve_content_version_internal(
  p_workspace_id uuid,
  p_content_id uuid,
  p_version_id uuid,
  p_expected_fingerprint text,
  p_disclosure_confirmed boolean,
  p_rights_confirmed boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version uuid;
  actual_fingerprint text;
  approval_id uuid;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager', 'reviewer']::text[]
  )) then
    raise exception '콘텐츠를 승인할 권한이 없습니다.';
  end if;

  select current_version_id into current_version
  from public.content_items
  where workspace_id = p_workspace_id and id = p_content_id
  for update;

  if current_version is null or current_version <> p_version_id then
    raise exception '최신 버전만 승인할 수 있습니다.';
  end if;

  select fingerprint into actual_fingerprint
  from public.content_versions
  where workspace_id = p_workspace_id
    and content_id = p_content_id
    and id = p_version_id;

  if actual_fingerprint is null or actual_fingerprint <> p_expected_fingerprint then
    raise exception '현재 버전 지문이 일치하지 않습니다.';
  end if;

  if not private.is_content_version_publishable(p_workspace_id, p_version_id) then
    raise exception '승인에 필요한 미디어와 지식 근거를 확인해 주세요.';
  end if;

  if p_disclosure_confirmed is not true or p_rights_confirmed is not true then
    raise exception '고지와 권리 확인을 모두 완료해야 승인할 수 있습니다.';
  end if;

  if p_reason is null or char_length(p_reason) not between 1 and 500 then
    raise exception '승인 사유를 입력해 주세요.';
  end if;

  insert into public.approvals (
    workspace_id, content_id, version_id, fingerprint, status,
    disclosure_confirmed, rights_confirmed, reason, decided_by
  ) values (
    p_workspace_id, p_content_id, p_version_id, actual_fingerprint, 'approved',
    true, true, p_reason, (select auth.uid())
  )
  on conflict (version_id) do nothing
  returning id into approval_id;

  if approval_id is null then
    select id into approval_id
    from public.approvals
    where workspace_id = p_workspace_id
      and version_id = p_version_id
      and fingerprint = actual_fingerprint
      and status = 'approved';
  end if;

  if approval_id is null then
    raise exception '이미 다른 결과로 검토된 버전입니다.';
  end if;

  update public.content_items
  set status = 'approved'
  where workspace_id = p_workspace_id
    and id = p_content_id
    and current_version_id = p_version_id;

  perform private.write_audit_event(
    p_workspace_id,
    'content.approved',
    'approval',
    approval_id,
    jsonb_build_object('versionId', p_version_id, 'fingerprint', actual_fingerprint)
  );

  return approval_id;
end;
$$;

create or replace function private.schedule_approved_content_internal(
  p_workspace_id uuid,
  p_approval_id uuid,
  p_publish_at timestamptz,
  p_timezone text,
  p_channel_connection_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_content_id uuid;
  approved_version_id uuid;
  approved_channel text;
  connection_channel text;
  new_schedule_id uuid;
  updated_count integer;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '콘텐츠를 예약할 권한이 없습니다.';
  end if;

  select approval.content_id, approval.version_id, content.channel
  into approved_content_id, approved_version_id, approved_channel
  from public.approvals as approval
  join public.content_items as content
    on content.workspace_id = approval.workspace_id
   and content.id = approval.content_id
   and content.current_version_id = approval.version_id
  where approval.workspace_id = p_workspace_id
    and approval.id = p_approval_id
    and approval.status = 'approved'
    and approval.disclosure_confirmed
    and approval.rights_confirmed
  for update of content;

  if approved_version_id is null then
    raise exception '승인된 버전만 예약할 수 있습니다.';
  end if;

  if not private.is_content_version_publishable(p_workspace_id, approved_version_id) then
    raise exception '승인 근거가 변경되어 다시 승인해야 합니다.';
  end if;

  if p_publish_at is null or p_publish_at < statement_timestamp() + interval '60 minutes' then
    raise exception '예약 시각은 현재보다 60분 이상 뒤여야 합니다.';
  end if;

  if p_timezone is null or char_length(p_timezone) not between 1 and 64 then
    raise exception '예약 시간대를 확인해 주세요.';
  end if;

  select channel into connection_channel
  from public.channel_connections
  where workspace_id = p_workspace_id
    and id = p_channel_connection_id
    and status = 'connected'
  for update;

  if connection_channel is null or connection_channel <> approved_channel then
    raise exception '연결된 게시 채널을 확인해 주세요.';
  end if;

  insert into public.schedules (
    workspace_id, approval_id, content_id, version_id, channel_connection_id,
    publish_at, timezone, status, created_by
  ) values (
    p_workspace_id, p_approval_id, approved_content_id, approved_version_id,
    p_channel_connection_id, p_publish_at, p_timezone, 'scheduled', (select auth.uid())
  )
  returning id into new_schedule_id;

  update public.content_items
  set status = 'scheduled'
  where workspace_id = p_workspace_id
    and id = approved_content_id
    and current_version_id = approved_version_id;

  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception '승인 버전이 변경되어 예약을 완료할 수 없습니다.';
  end if;

  perform private.write_audit_event(
    p_workspace_id,
    'content.scheduled',
    'schedule',
    new_schedule_id,
    jsonb_build_object(
      'versionId', approved_version_id,
      'channelConnectionId', p_channel_connection_id,
      'publishAt', p_publish_at
    )
  );

  return new_schedule_id;
end;
$$;

create or replace function private.record_publish_attempt_internal(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_idempotency_key text,
  p_status text,
  p_provider_reference text,
  p_error_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_attempt integer;
  attempt_id uuid;
  stored_schedule_id uuid;
  stored_status text;
  stored_provider_reference text;
  stored_error_code text;
  stored_attempt_number integer;
  latest_attempt_number integer;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '발행 결과를 기록할 권한이 없습니다.';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200
    or p_status not in ('succeeded', 'failed')
    or (p_provider_reference is not null and char_length(p_provider_reference) > 500)
    or (p_error_code is not null and char_length(p_error_code) > 120) then
    raise exception '발행 결과 입력이 올바르지 않습니다.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key, 0)
  );

  select id, schedule_id, status, provider_reference, error_code, attempt_number
  into attempt_id, stored_schedule_id, stored_status, stored_provider_reference,
       stored_error_code, stored_attempt_number
  from public.publish_attempts
  where workspace_id = p_workspace_id
    and idempotency_key = p_idempotency_key;

  if attempt_id is not null then
    if stored_schedule_id <> p_schedule_id then
      raise exception '발행 식별자가 다른 요청에 이미 사용되었습니다.';
    end if;

    if stored_status = 'pending' then
      perform 1
      from public.schedules
      where workspace_id = p_workspace_id and id = stored_schedule_id
      for update;

      select max(attempt_number)
      into latest_attempt_number
      from public.publish_attempts
      where workspace_id = p_workspace_id and schedule_id = stored_schedule_id;

      if latest_attempt_number <> stored_attempt_number then
        raise exception '가장 최근의 발행 시도만 완료할 수 있습니다.';
      end if;

      update public.publish_attempts
      set status = p_status,
          provider_reference = p_provider_reference,
          error_code = p_error_code,
          finished_at = statement_timestamp()
      where workspace_id = p_workspace_id
        and id = attempt_id
        and status = 'pending';

      update public.schedules
      set status = case when p_status = 'succeeded' then 'published' else 'failed' end
      where workspace_id = p_workspace_id and id = stored_schedule_id;

      update public.content_items as content
      set status = case when p_status = 'succeeded' then 'published' else content.status end
      from public.schedules as schedule
      where schedule.workspace_id = p_workspace_id
        and schedule.id = stored_schedule_id
        and content.workspace_id = schedule.workspace_id
        and content.id = schedule.content_id
        and content.current_version_id = schedule.version_id;

      perform private.write_audit_event(
        p_workspace_id,
        'publish.recorded',
        'publish_attempt',
        attempt_id,
        jsonb_build_object('scheduleId', stored_schedule_id, 'status', p_status)
      );

      return attempt_id;
    end if;

    if stored_status <> p_status
      or stored_provider_reference is distinct from p_provider_reference
      or stored_error_code is distinct from p_error_code then
      raise exception '발행 식별자가 다른 요청에 이미 사용되었습니다.';
    end if;

    return attempt_id;
  end if;

  perform 1
  from public.schedules
  where workspace_id = p_workspace_id and id = p_schedule_id
  for update;

  if not found then
    raise exception '예약을 찾을 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.publish_attempts
    where workspace_id = p_workspace_id
      and schedule_id = p_schedule_id
      and status = 'pending'
  ) then
    raise exception '대기 중인 재시도 결과를 먼저 기록해 주세요.';
  end if;

  select coalesce(max(attempt_number), 0) + 1
  into next_attempt
  from public.publish_attempts
  where workspace_id = p_workspace_id and schedule_id = p_schedule_id;

  insert into public.publish_attempts (
    workspace_id, schedule_id, attempt_number, idempotency_key, status,
    provider_reference, error_code, finished_at, created_by
  ) values (
    p_workspace_id, p_schedule_id, next_attempt, p_idempotency_key, p_status,
    p_provider_reference, p_error_code, statement_timestamp(), (select auth.uid())
  )
  returning id into attempt_id;

  update public.schedules
  set status = case when p_status = 'succeeded' then 'published' else 'failed' end
  where workspace_id = p_workspace_id and id = p_schedule_id;

  update public.content_items as content
  set status = case when p_status = 'succeeded' then 'published' else content.status end
  from public.schedules as schedule
  where schedule.workspace_id = p_workspace_id
    and schedule.id = p_schedule_id
    and content.workspace_id = schedule.workspace_id
    and content.id = schedule.content_id
    and content.current_version_id = schedule.version_id;

  perform private.write_audit_event(
    p_workspace_id,
    'publish.recorded',
    'publish_attempt',
    attempt_id,
    jsonb_build_object('scheduleId', p_schedule_id, 'status', p_status)
  );

  return attempt_id;
end;
$$;

create or replace function private.retry_publish_attempt_internal(
  p_workspace_id uuid,
  p_failed_attempt_id uuid,
  p_new_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed_schedule_id uuid;
  failed_attempt_number integer;
  latest_attempt_number integer;
  retry_id uuid;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception '발행을 재시도할 권한이 없습니다.';
  end if;

  if p_new_idempotency_key is null
    or char_length(p_new_idempotency_key) not between 1 and 200 then
    raise exception '재시도 식별자를 확인해 주세요.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_new_idempotency_key, 0)
  );

  if exists (
    select 1 from public.publish_attempts
    where workspace_id = p_workspace_id
      and idempotency_key = p_new_idempotency_key
  ) then
    raise exception '재시도 식별자가 이미 사용되었습니다.';
  end if;

  select schedule_id, attempt_number
  into failed_schedule_id, failed_attempt_number
  from public.publish_attempts
  where workspace_id = p_workspace_id
    and id = p_failed_attempt_id
    and status = 'failed';

  if failed_schedule_id is null then
    raise exception '실패한 발행 시도만 재시도할 수 있습니다.';
  end if;

  perform 1
  from public.schedules
  where workspace_id = p_workspace_id and id = failed_schedule_id
  for update;

  select max(attempt_number)
  into latest_attempt_number
  from public.publish_attempts
  where workspace_id = p_workspace_id and schedule_id = failed_schedule_id;

  if latest_attempt_number <> failed_attempt_number then
    raise exception '가장 최근의 실패한 발행만 재시도할 수 있습니다.';
  end if;

  insert into public.publish_attempts (
    workspace_id, schedule_id, attempt_number, idempotency_key, status, created_by
  ) values (
    p_workspace_id, failed_schedule_id, latest_attempt_number + 1,
    p_new_idempotency_key, 'pending', (select auth.uid())
  )
  returning id into retry_id;

  update public.schedules
  set status = 'scheduled'
  where workspace_id = p_workspace_id and id = failed_schedule_id;

  perform private.write_audit_event(
    p_workspace_id,
    'publish.retry_requested',
    'publish_attempt',
    retry_id,
    jsonb_build_object(
      'scheduleId', failed_schedule_id,
      'sourceAttemptId', p_failed_attempt_id
    )
  );

  return retry_id;
end;
$$;
