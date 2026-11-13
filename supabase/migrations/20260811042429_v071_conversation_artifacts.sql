create table public.conversation_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null check (type in ('instagram_post')),
  status text not null check (
    status in ('preparing', 'partial', 'ready_for_review', 'failed', 'archived')
  ),
  source_message_id uuid not null,
  work_item_id uuid,
  content_item_id uuid,
  version_id uuid,
  caption text not null check (char_length(caption) between 1 and 2200),
  hashtags text[] not null default '{}'
    check (cardinality(hashtags) <= 30),
  cta text not null default '' check (char_length(cta) <= 500),
  disclosure text not null default '' check (char_length(disclosure) <= 500),
  observations text[] not null default '{}'
    check (cardinality(observations) <= 20),
  limitations text[] not null default '{}'
    check (cardinality(limitations) <= 20),
  evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence) = 'array'),
  unresolved_questions text[] not null default '{}'
    check (cardinality(unresolved_questions) <= 20),
  idempotency_key uuid not null,
  save_request_key uuid,
  created_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_artifacts_workspace_id_id_key unique (workspace_id, id),
  constraint conversation_artifacts_source_message_key
    unique (workspace_id, source_message_id, idempotency_key),
  constraint conversation_artifacts_workspace_content_item_key
    unique (workspace_id, content_item_id),
  constraint conversation_artifacts_source_message_fkey
    foreign key (workspace_id, source_message_id)
    references public.messages (workspace_id, id)
    on delete restrict,
  constraint conversation_artifacts_work_item_fkey
    foreign key (workspace_id, work_item_id)
    references public.work_items (workspace_id, id)
    on delete restrict,
  constraint conversation_artifacts_content_item_fkey
    foreign key (workspace_id, content_item_id)
    references public.content_items (workspace_id, id)
    on delete restrict,
  constraint conversation_artifacts_version_fkey
    foreign key (workspace_id, version_id)
    references public.content_versions (workspace_id, id)
    on delete restrict,
  constraint conversation_artifacts_save_refs_check check (
    (
      work_item_id is null
      and content_item_id is null
      and version_id is null
      and save_request_key is null
    )
    or (
      work_item_id is not null
      and content_item_id is not null
      and version_id is not null
      and save_request_key is not null
    )
  )
);

create index conversation_artifacts_workspace_status_idx
  on public.conversation_artifacts (workspace_id, status, updated_at desc);
create index conversation_artifacts_source_message_idx
  on public.conversation_artifacts (workspace_id, source_message_id, created_at);
create index conversation_artifacts_created_by_idx
  on public.conversation_artifacts (created_by_user_id, created_at desc);

create table public.generation_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  artifact_id uuid not null,
  requested_count smallint not null check (requested_count between 1 and 3),
  started_count smallint not null default 0,
  succeeded_count smallint not null default 0,
  failed_count smallint not null default 0,
  status text not null check (
    status in ('queued', 'generating', 'partial', 'succeeded', 'failed', 'cancelled')
  ),
  idempotency_key uuid not null,
  safe_error_code text check (
    safe_error_code is null or char_length(safe_error_code) between 1 and 120
  ),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generation_batches_workspace_id_id_key unique (workspace_id, id),
  constraint generation_batches_artifact_identity_key
    unique (workspace_id, artifact_id, id),
  constraint generation_batches_artifact_request_key
    unique (workspace_id, artifact_id, idempotency_key),
  constraint generation_batches_artifact_fkey
    foreign key (workspace_id, artifact_id)
    references public.conversation_artifacts (workspace_id, id)
    on delete cascade,
  constraint generation_batches_counts_check check (
    started_count between 0 and requested_count
    and succeeded_count between 0 and started_count
    and failed_count between 0 and started_count
    and succeeded_count + failed_count <= started_count
  ),
  constraint generation_batches_status_counts_check check (
    (status = 'queued'
      and started_count = 0 and succeeded_count = 0 and failed_count = 0
      and started_at is null and completed_at is null)
    or (status = 'generating'
      and started_count > 0 and succeeded_count + failed_count <= started_count
      and started_at is not null and completed_at is null)
    or (status = 'succeeded'
      and started_count = requested_count
      and succeeded_count = requested_count and failed_count = 0
      and started_at is not null and completed_at is not null)
    or (status = 'partial'
      and started_count = requested_count
      and succeeded_count > 0 and failed_count > 0
      and succeeded_count + failed_count = requested_count
      and started_at is not null and completed_at is not null)
    or (status = 'failed'
      and started_count = requested_count
      and succeeded_count = 0 and failed_count = requested_count
      and started_at is not null and completed_at is not null)
    or (status = 'cancelled'
      and started_at is not null and completed_at is not null)
  )
);

create index generation_batches_workspace_artifact_idx
  on public.generation_batches (workspace_id, artifact_id, created_at desc);

create table public.artifact_slides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  artifact_id uuid not null,
  batch_id uuid not null,
  position smallint not null check (position between 1 and 3),
  role text not null check (role in ('cover', 'detail', 'proof', 'action')),
  media_asset_id uuid,
  alt_text text not null default '' check (char_length(alt_text) <= 500),
  status text not null check (
    status in ('queued', 'generating', 'succeeded', 'failed', 'cancelled')
  ),
  safe_error_code text check (
    safe_error_code is null or char_length(safe_error_code) between 1 and 120
  ),
  retryable boolean not null default false,
  rights_status text not null default 'pending'
    check (rights_status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artifact_slides_workspace_id_id_key unique (workspace_id, id),
  constraint artifact_slides_artifact_position_key
    unique (workspace_id, artifact_id, position),
  constraint artifact_slides_artifact_fkey
    foreign key (workspace_id, artifact_id)
    references public.conversation_artifacts (workspace_id, id)
    on delete cascade,
  constraint artifact_slides_batch_fkey
    foreign key (workspace_id, artifact_id, batch_id)
    references public.generation_batches (workspace_id, artifact_id, id)
    on delete cascade,
  constraint artifact_slides_media_fkey
    foreign key (workspace_id, media_asset_id)
    references public.media_assets (workspace_id, id)
    on delete restrict,
  constraint artifact_slides_result_check check (
    (status = 'succeeded'
      and media_asset_id is not null
      and char_length(alt_text) between 1 and 500
      and safe_error_code is null)
    or (status = 'failed'
      and media_asset_id is null
      and safe_error_code is not null)
    or (status in ('queued', 'generating', 'cancelled')
      and media_asset_id is null)
  )
);

create index artifact_slides_workspace_artifact_idx
  on public.artifact_slides (workspace_id, artifact_id, position);
create index artifact_slides_media_idx
  on public.artifact_slides (workspace_id, media_asset_id)
  where media_asset_id is not null;

create table public.message_artifacts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  message_id uuid not null,
  artifact_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (message_id, artifact_id),
  constraint message_artifacts_workspace_message_fkey
    foreign key (workspace_id, message_id)
    references public.messages (workspace_id, id)
    on delete cascade,
  constraint message_artifacts_workspace_artifact_fkey
    foreign key (workspace_id, artifact_id)
    references public.conversation_artifacts (workspace_id, id)
    on delete cascade
);

create index message_artifacts_workspace_message_idx
  on public.message_artifacts (workspace_id, message_id, created_at);
create index message_artifacts_workspace_artifact_idx
  on public.message_artifacts (workspace_id, artifact_id, created_at);

create trigger conversation_artifacts_set_updated_at
before update on public.conversation_artifacts
for each row execute function private.set_updated_at();

create trigger generation_batches_set_updated_at
before update on public.generation_batches
for each row execute function private.set_updated_at();

create trigger artifact_slides_set_updated_at
before update on public.artifact_slides
for each row execute function private.set_updated_at();

alter table public.conversation_artifacts enable row level security;
alter table public.generation_batches enable row level security;
alter table public.artifact_slides enable row level security;
alter table public.message_artifacts enable row level security;

create policy "workspace members can read conversation artifacts"
on public.conversation_artifacts for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read generation batches"
on public.generation_batches for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read artifact slides"
on public.artifact_slides for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read message artifacts"
on public.message_artifacts for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on public.conversation_artifacts from anon, authenticated;
revoke all on public.generation_batches from anon, authenticated;
revoke all on public.artifact_slides from anon, authenticated;
revoke all on public.message_artifacts from anon, authenticated;

grant select on public.conversation_artifacts to authenticated;
grant select on public.generation_batches to authenticated;
grant select on public.artifact_slides to authenticated;
grant select on public.message_artifacts to authenticated;

grant select, insert, update, delete on public.conversation_artifacts to service_role;
grant select, insert, update, delete on public.generation_batches to service_role;
grant select, insert, update, delete on public.artifact_slides to service_role;
grant select, insert, update, delete on public.message_artifacts to service_role;

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

  select candidate.*
  into artifact
  from public.conversation_artifacts as candidate
  where candidate.id = p_artifact_id
    and (select private.is_workspace_member(candidate.workspace_id))
  for update;

  if not found then
    raise exception '저장할 결과물을 찾을 수 없습니다.' using errcode = 'P0001';
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

    select version_number
    into saved_version_number
    from public.content_versions
    where workspace_id = artifact.workspace_id
      and id = artifact.version_id;

    return jsonb_build_object(
      'artifactId', artifact.id,
      'workItemId', artifact.work_item_id,
      'contentItemId', artifact.content_item_id,
      'versionId', artifact.version_id,
      'versionNumber', saved_version_number
    );
  end if;

  if artifact.status not in ('partial', 'ready_for_review') then
    raise exception '검토할 수 있는 결과물만 작업함에 저장할 수 있습니다.' using errcode = 'P0001';
  end if;

  select batch.status
  into latest_batch_status
  from public.generation_batches as batch
  where batch.workspace_id = artifact.workspace_id
    and batch.artifact_id = artifact.id
  order by batch.created_at desc, batch.id desc
  limit 1;

  if (artifact.status = 'ready_for_review' and latest_batch_status <> 'succeeded')
    or (artifact.status = 'partial' and latest_batch_status <> 'partial') then
    raise exception '이미지 생성 상태를 다시 확인해 주세요.' using errcode = 'P0001';
  end if;

  select
    array_agg(slide.media_asset_id order by slide.position),
    count(*)::integer
  into media_ids, valid_media_count
  from public.artifact_slides as slide
  join public.media_assets as media
    on media.workspace_id = slide.workspace_id
   and media.id = slide.media_asset_id
   and media.bucket_id = 'content-media'
   and media.kind = 'content'
   and media.rights_status = 'confirmed'
  join storage.objects as object
    on object.bucket_id = media.bucket_id
   and object.name = media.object_path
  where slide.workspace_id = artifact.workspace_id
    and slide.artifact_id = artifact.id
    and slide.status = 'succeeded'
    and slide.rights_status = 'confirmed';

  if valid_media_count not between 1 and 3 then
    raise exception '사용할 수 있는 결과 이미지가 없습니다.' using errcode = 'P0001';
  end if;

  version_caption := case
    when artifact.cta = '' then artifact.caption
    else artifact.caption || E'\n\n' || artifact.cta
  end;

  if char_length(version_caption) > 2200 then
    raise exception '게시물 문안이 너무 깁니다.' using errcode = 'P0001';
  end if;

  content_title := left(
    regexp_replace(artifact.caption, E'\\s+', ' ', 'g'),
    200
  );

  insert into public.content_items (
    workspace_id, channel, title, status, created_by
  ) values (
    artifact.workspace_id, 'instagram', content_title, 'draft', (select auth.uid())
  ) returning id into new_content_item_id;

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
      'knowledgeIds', '[]'::jsonb
    )
  );

  select thread_id
  into source_thread_id
  from public.messages
  where workspace_id = artifact.workspace_id
    and id = artifact.source_message_id;

  insert into public.work_items (
    workspace_id, type, title, summary, status, priority, owner_type,
    source_thread_id, source_message_id, content_item_id, created_by
  ) values (
    artifact.workspace_id,
    'content',
    content_title,
    left(version_caption, 4000),
    'drafting',
    'normal',
    'shared',
    source_thread_id,
    artifact.source_message_id,
    new_content_item_id,
    (select auth.uid())
  ) returning id into new_work_item_id;

  update public.messages
  set work_item_id = new_work_item_id
  where workspace_id = artifact.workspace_id
    and id = artifact.source_message_id;

  update public.conversation_artifacts
  set work_item_id = new_work_item_id,
      content_item_id = new_content_item_id,
      version_id = new_version_id,
      save_request_key = p_request_key
  where workspace_id = artifact.workspace_id
    and id = artifact.id;

  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload
  ) values (
    artifact.workspace_id,
    'content.plan.created',
    'artifact:' || artifact.id::text || ':saved',
    'work_item',
    new_work_item_id,
    jsonb_build_object(
      'artifactId', artifact.id,
      'contentItemId', new_content_item_id,
      'versionId', new_version_id
    )
  ) on conflict (workspace_id, event_key) do nothing;

  insert into public.notifications (
    workspace_id, user_id, kind, body, href, event_key
  ) values (
    artifact.workspace_id,
    (select auth.uid()),
    'system',
    '대화 결과가 작업함에 저장되었습니다.',
    '/app/work/' || new_content_item_id::text,
    'artifact:' || artifact.id::text || ':saved'
  ) on conflict (workspace_id, user_id, event_key)
    where event_key is not null
    do nothing;

  select version_number
  into saved_version_number
  from public.content_versions
  where workspace_id = artifact.workspace_id
    and id = new_version_id;

  return jsonb_build_object(
    'artifactId', artifact.id,
    'workItemId', new_work_item_id,
    'contentItemId', new_content_item_id,
    'versionId', new_version_id,
    'versionNumber', saved_version_number
  );
end;
$$;

create function public.save_conversation_artifact_to_work(
  p_artifact_id uuid,
  p_request_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_conversation_artifact_to_work_internal(
    p_artifact_id,
    p_request_key
  );
$$;

revoke all on function private.save_conversation_artifact_to_work_internal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.save_conversation_artifact_to_work_internal(uuid, uuid)
  to authenticated;

revoke all on function public.save_conversation_artifact_to_work(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_conversation_artifact_to_work(uuid, uuid)
  to authenticated;
