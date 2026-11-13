create extension if not exists pgcrypto with schema extensions;

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null check (channel in ('instagram', 'threads', 'naver_blog', 'naver_place')),
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approved', 'scheduled', 'published', 'archived')),
  current_version_id uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_items_workspace_id_id_key unique (workspace_id, id)
);

create index content_items_workspace_status_idx
  on public.content_items (workspace_id, status, updated_at desc);
create index content_items_created_by_idx on public.content_items (created_by);

create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  content_id uuid not null,
  version_number integer not null check (version_number > 0),
  caption text not null check (char_length(caption) between 1 and 2200),
  hashtags text[] not null default '{}'
    check (cardinality(hashtags) <= 30),
  disclosure text not null default '' check (char_length(disclosure) <= 500),
  rights jsonb not null default '{}'::jsonb check (jsonb_typeof(rights) = 'object'),
  generation_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(generation_evidence) = 'object'),
  revision_reason text check (revision_reason is null or char_length(revision_reason) <= 500),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint content_versions_content_number_key unique (content_id, version_number),
  constraint content_versions_workspace_id_id_key unique (workspace_id, id),
  constraint content_versions_workspace_content_fkey
    foreign key (workspace_id, content_id)
    references public.content_items (workspace_id, id)
    on delete cascade
);

create index content_versions_workspace_content_idx
  on public.content_versions (workspace_id, content_id, version_number desc);
create index content_versions_created_by_idx on public.content_versions (created_by);

alter table public.content_items
  add constraint content_items_current_version_fkey
  foreign key (workspace_id, current_version_id)
  references public.content_versions (workspace_id, id)
  deferrable initially deferred;

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  bucket_id text not null check (bucket_id in ('content-media', 'knowledge-files')),
  object_path text not null check (char_length(object_path) between 1 and 1024),
  kind text not null check (kind in ('content', 'knowledge')),
  mime_type text not null check (char_length(mime_type) between 1 and 120),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  rights_status text not null default 'pending'
    check (rights_status in ('pending', 'confirmed', 'rejected')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint media_assets_workspace_path_key unique (workspace_id, bucket_id, object_path),
  constraint media_assets_workspace_id_id_key unique (workspace_id, id)
);

create index media_assets_workspace_kind_idx
  on public.media_assets (workspace_id, kind, created_at desc);
create index media_assets_created_by_idx on public.media_assets (created_by);

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  media_asset_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'uploading'
    check (status in ('uploading', 'checking', 'approved', 'rejected', 'failed', 'archived')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_items_workspace_id_id_key unique (workspace_id, id),
  constraint knowledge_items_media_asset_fkey
    foreign key (workspace_id, media_asset_id)
    references public.media_assets (workspace_id, id)
);

create index knowledge_items_workspace_status_idx
  on public.knowledge_items (workspace_id, status, updated_at desc);
create index knowledge_items_created_by_idx on public.knowledge_items (created_by);

create table public.content_version_media (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version_id uuid not null,
  media_asset_id uuid not null,
  position smallint not null check (position between 0 and 9),
  created_at timestamptz not null default now(),
  primary key (version_id, media_asset_id),
  unique (version_id, position),
  foreign key (workspace_id, version_id)
    references public.content_versions (workspace_id, id) on delete cascade,
  foreign key (workspace_id, media_asset_id)
    references public.media_assets (workspace_id, id) on delete restrict
);

create index content_version_media_workspace_idx
  on public.content_version_media (workspace_id, version_id, position);
create index content_version_media_asset_idx
  on public.content_version_media (workspace_id, media_asset_id);

create table public.content_version_knowledge (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version_id uuid not null,
  knowledge_item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (version_id, knowledge_item_id),
  foreign key (workspace_id, version_id)
    references public.content_versions (workspace_id, id) on delete cascade,
  foreign key (workspace_id, knowledge_item_id)
    references public.knowledge_items (workspace_id, id) on delete restrict
);

create index content_version_knowledge_workspace_idx
  on public.content_version_knowledge (workspace_id, version_id);
create index content_version_knowledge_item_idx
  on public.content_version_knowledge (workspace_id, knowledge_item_id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_id uuid not null,
  version_id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('approved', 'rejected')),
  disclosure_confirmed boolean not null,
  rights_confirmed boolean not null,
  reason text not null check (char_length(reason) between 1 and 500),
  decided_by uuid not null references auth.users (id),
  decided_at timestamptz not null default now(),
  constraint approvals_version_key unique (version_id),
  constraint approvals_workspace_id_id_key unique (workspace_id, id),
  foreign key (workspace_id, content_id)
    references public.content_items (workspace_id, id) on delete cascade,
  foreign key (workspace_id, version_id)
    references public.content_versions (workspace_id, id) on delete restrict
);

create index approvals_workspace_status_idx
  on public.approvals (workspace_id, status, decided_at desc);
create index approvals_content_idx on public.approvals (workspace_id, content_id);
create index approvals_decided_by_idx on public.approvals (decided_by);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  approval_id uuid not null,
  content_id uuid not null,
  version_id uuid not null,
  channel_connection_id uuid not null,
  publish_at timestamptz not null,
  timezone text not null check (char_length(timezone) between 1 and 64),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedules_workspace_id_id_key unique (workspace_id, id),
  foreign key (workspace_id, approval_id)
    references public.approvals (workspace_id, id) on delete restrict,
  foreign key (workspace_id, content_id)
    references public.content_items (workspace_id, id) on delete cascade,
  foreign key (workspace_id, version_id)
    references public.content_versions (workspace_id, id) on delete restrict,
  foreign key (channel_connection_id)
    references public.channel_connections (id) on delete restrict
);

create index schedules_workspace_time_idx
  on public.schedules (workspace_id, status, publish_at);
create index schedules_channel_time_idx
  on public.schedules (channel_connection_id, status, publish_at);
create index schedules_approval_idx on public.schedules (workspace_id, approval_id);
create index schedules_created_by_idx on public.schedules (created_by);

create table public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  schedule_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  provider_reference text check (provider_reference is null or char_length(provider_reference) <= 500),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid not null references auth.users (id),
  constraint publish_attempts_workspace_id_idempotency_key_key
    unique (workspace_id, idempotency_key),
  constraint publish_attempts_schedule_attempt_key unique (schedule_id, attempt_number),
  constraint publish_attempts_workspace_id_id_key unique (workspace_id, id),
  foreign key (workspace_id, schedule_id)
    references public.schedules (workspace_id, id) on delete cascade
);

create index publish_attempts_workspace_status_idx
  on public.publish_attempts (workspace_id, status, started_at desc);
create index publish_attempts_schedule_idx
  on public.publish_attempts (workspace_id, schedule_id, attempt_number desc);
create index publish_attempts_created_by_idx on public.publish_attempts (created_by);

create table public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('unavailable', 'insufficient', 'sufficient')),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  source_ready boolean not null default false,
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (workspace_id, period_start, period_end)
);

create index report_snapshots_workspace_period_idx
  on public.report_snapshots (workspace_id, period_end desc);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('faq_safe_reply', 'content_reminder')),
  active boolean not null default false,
  approval_required boolean not null default true,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_rules_workspace_id_id_key unique (workspace_id, id)
);

create index automation_rules_workspace_active_idx
  on public.automation_rules (workspace_id, active, kind);
create index automation_rules_created_by_idx on public.automation_rules (created_by);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  rule_id uuid not null,
  status text not null check (status in ('pending', 'awaiting_approval', 'succeeded', 'failed')),
  input_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(input_summary) = 'object'),
  output_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(output_summary) = 'object'),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (workspace_id, rule_id)
    references public.automation_rules (workspace_id, id) on delete cascade
);

create index automation_runs_workspace_status_idx
  on public.automation_runs (workspace_id, status, created_at desc);
create index automation_runs_rule_idx
  on public.automation_runs (workspace_id, rule_id, created_at desc);

create table public.notification_preferences (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  approval_events boolean not null default true,
  schedule_events boolean not null default true,
  publish_events boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index notification_preferences_user_idx
  on public.notification_preferences (user_id, workspace_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('approval', 'schedule', 'publish', 'system')),
  body text not null check (char_length(body) between 1 and 200),
  href text check (href is null or char_length(href) <= 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at desc);
create index notifications_workspace_idx
  on public.notifications (workspace_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id),
  event_type text not null check (char_length(event_type) between 1 and 120),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_workspace_time_idx
  on public.audit_events (workspace_id, created_at desc);
create index audit_events_entity_idx
  on public.audit_events (workspace_id, entity_type, entity_id);
create index audit_events_actor_idx on public.audit_events (actor_id, created_at desc);

create or replace function private.prevent_immutable_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception '승인 근거가 되는 기록은 변경하거나 삭제할 수 없습니다.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger content_versions_are_immutable
before update or delete on public.content_versions
for each row execute function private.prevent_immutable_change();

create trigger approvals_are_immutable
before update or delete on public.approvals
for each row execute function private.prevent_immutable_change();

create trigger content_items_set_updated_at
before update on public.content_items
for each row execute function private.set_updated_at();

create trigger knowledge_items_set_updated_at
before update on public.knowledge_items
for each row execute function private.set_updated_at();

create trigger schedules_set_updated_at
before update on public.schedules
for each row execute function private.set_updated_at();

create trigger automation_rules_set_updated_at
before update on public.automation_rules
for each row execute function private.set_updated_at();

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function private.set_updated_at();

revoke execute on function private.prevent_immutable_change() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'content_items', 'content_versions', 'media_assets', 'content_version_media',
    'content_version_knowledge', 'approvals', 'schedules', 'publish_attempts',
    'report_snapshots', 'knowledge_items', 'automation_rules', 'automation_runs',
    'notification_preferences', 'notifications', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_workspace_member(workspace_id)))',
      'workspace members can read ' || table_name,
      table_name
    );
  end loop;
end;
$$;

create policy "content editors can insert content items"
on public.content_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[]))
);

create policy "content editors can update content items"
on public.content_items for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])));

create policy "content editors can insert versions"
on public.content_versions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[]))
);

create policy "content editors can insert media"
on public.media_assets for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[]))
);

create policy "content managers can update media"
on public.media_assets for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "content editors can link version media"
on public.content_version_media for insert to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])));

create policy "content editors can unlink version media"
on public.content_version_media for delete to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])));

create policy "content editors can link version knowledge"
on public.content_version_knowledge for insert to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])));

create policy "content editors can unlink version knowledge"
on public.content_version_knowledge for delete to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])));

create policy "reviewers can insert approvals"
on public.approvals for insert to authenticated
with check (
  decided_by = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[]))
);

create policy "reviewers can insert schedules"
on public.schedules for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[]))
);

create policy "managers can update schedules"
on public.schedules for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "managers can insert publish attempts"
on public.publish_attempts for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[]))
);

create policy "managers can update publish attempts"
on public.publish_attempts for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "managers can insert report snapshots"
on public.report_snapshots for insert to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "content editors can insert knowledge"
on public.knowledge_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[]))
);

create policy "content editors can update knowledge"
on public.knowledge_items for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager', 'reviewer']::text[])));

create policy "managers can insert automation rules"
on public.automation_rules for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[]))
);

create policy "managers can update automation rules"
on public.automation_rules for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "managers can insert automation runs"
on public.automation_runs for insert to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "managers can update automation runs"
on public.automation_runs for update to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "members manage their notification preferences"
on public.notification_preferences for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);

create policy "members update their notification preferences"
on public.notification_preferences for update to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);

create policy "members read only their notifications"
on public.notifications as restrictive for select to authenticated
using (user_id = (select auth.uid()));

create policy "members mark their notifications read"
on public.notifications for update to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);

create policy "managers can insert notifications"
on public.notifications for insert to authenticated
with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace owners can insert audit events"
on public.audit_events for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and (select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[]))
);

create or replace function public.create_content_version(
  p_workspace_id uuid,
  p_content_id uuid,
  p_caption text,
  p_hashtags text[],
  p_disclosure text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_version integer;
  new_version_id uuid;
  new_fingerprint text;
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
    jsonb_build_object('confirmed', coalesce((p_metadata ->> 'rightsConfirmed')::boolean, false)),
    jsonb_build_object('confirmed', coalesce((p_metadata ->> 'generationEvidenceConfirmed')::boolean, false)),
    new_fingerprint, (select auth.uid())
  )
  returning id into new_version_id;

  update public.content_items
  set current_version_id = new_version_id,
      status = 'review'
  where workspace_id = p_workspace_id and id = p_content_id;

  return new_version_id;
end;
$$;

create or replace function public.approve_content_version(
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
security invoker
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

  return approval_id;
end;
$$;

create or replace function public.schedule_approved_content(
  p_workspace_id uuid,
  p_approval_id uuid,
  p_publish_at timestamptz,
  p_timezone text,
  p_channel_connection_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  approved_content_id uuid;
  approved_version_id uuid;
  approved_channel text;
  connection_channel text;
  new_schedule_id uuid;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager', 'reviewer']::text[]
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
    and approval.rights_confirmed;

  if approved_version_id is null then
    raise exception '승인된 버전만 예약할 수 있습니다.';
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
    and status = 'connected';

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

  return new_schedule_id;
end;
$$;

create or replace function public.record_publish_attempt(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_idempotency_key text,
  p_status text,
  p_provider_reference text,
  p_error_code text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_attempt integer;
  attempt_id uuid;
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

  select id into attempt_id
  from public.publish_attempts
  where workspace_id = p_workspace_id
    and idempotency_key = p_idempotency_key;

  if attempt_id is not null then
    return attempt_id;
  end if;

  perform 1
  from public.schedules
  where workspace_id = p_workspace_id and id = p_schedule_id
  for update;

  if not found then
    raise exception '예약을 찾을 수 없습니다.';
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
  on conflict (workspace_id, idempotency_key) do nothing
  returning id into attempt_id;

  if attempt_id is null then
    select id into attempt_id
    from public.publish_attempts
    where workspace_id = p_workspace_id
      and idempotency_key = p_idempotency_key;
  end if;

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

  return attempt_id;
end;
$$;

create or replace function public.retry_publish_attempt(
  p_workspace_id uuid,
  p_failed_attempt_id uuid,
  p_new_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  failed_schedule_id uuid;
  failed_attempt_number integer;
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

  select schedule_id, attempt_number
  into failed_schedule_id, failed_attempt_number
  from public.publish_attempts
  where workspace_id = p_workspace_id
    and id = p_failed_attempt_id
    and status = 'failed'
  for update;

  if failed_schedule_id is null then
    raise exception '실패한 발행 시도만 재시도할 수 있습니다.';
  end if;

  insert into public.publish_attempts (
    workspace_id, schedule_id, attempt_number, idempotency_key, status, created_by
  ) values (
    p_workspace_id, failed_schedule_id, failed_attempt_number + 1,
    p_new_idempotency_key, 'pending', (select auth.uid())
  )
  returning id into retry_id;

  update public.schedules
  set status = 'scheduled'
  where workspace_id = p_workspace_id and id = failed_schedule_id;

  return retry_id;
end;
$$;

revoke all on function public.create_content_version(uuid, uuid, text, text[], text, jsonb)
  from public, anon;
revoke all on function public.approve_content_version(uuid, uuid, uuid, text, boolean, boolean, text)
  from public, anon;
revoke all on function public.schedule_approved_content(uuid, uuid, timestamptz, text, uuid)
  from public, anon;
revoke all on function public.record_publish_attempt(uuid, uuid, text, text, text, text)
  from public, anon;
revoke all on function public.retry_publish_attempt(uuid, uuid, text)
  from public, anon;

grant execute on function public.create_content_version(uuid, uuid, text, text[], text, jsonb)
  to authenticated;
grant execute on function public.approve_content_version(uuid, uuid, uuid, text, boolean, boolean, text)
  to authenticated;
grant execute on function public.schedule_approved_content(uuid, uuid, timestamptz, text, uuid)
  to authenticated;
grant execute on function public.record_publish_attempt(uuid, uuid, text, text, text, text)
  to authenticated;
grant execute on function public.retry_publish_attempt(uuid, uuid, text)
  to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'content_items', 'content_versions', 'media_assets', 'content_version_media',
    'content_version_knowledge', 'approvals', 'schedules', 'publish_attempts',
    'report_snapshots', 'knowledge_items', 'automation_rules', 'automation_runs',
    'notification_preferences', 'notifications', 'audit_events'
  ]
  loop
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end;
$$;

grant select, insert on public.content_items to authenticated;
grant update (title, status, current_version_id) on public.content_items to authenticated;
grant select, insert on public.content_versions to authenticated;
grant select, insert on public.media_assets to authenticated;
grant update (rights_status) on public.media_assets to authenticated;
grant select, insert, delete on public.content_version_media to authenticated;
grant select, insert, delete on public.content_version_knowledge to authenticated;
grant select, insert on public.approvals to authenticated;
grant select, insert on public.schedules to authenticated;
grant update (status, publish_at, timezone, channel_connection_id) on public.schedules to authenticated;
grant select, insert on public.publish_attempts to authenticated;
grant update (status, provider_reference, error_code, finished_at) on public.publish_attempts to authenticated;
grant select, insert on public.report_snapshots to authenticated;
grant select, insert on public.knowledge_items to authenticated;
grant update (name, status, evidence, media_asset_id) on public.knowledge_items to authenticated;
grant select, insert on public.automation_rules to authenticated;
grant update (active, approval_required, configuration) on public.automation_rules to authenticated;
grant select, insert on public.automation_runs to authenticated;
grant update (status, output_summary, error_code, finished_at) on public.automation_runs to authenticated;
grant select, insert on public.notification_preferences to authenticated;
grant update (approval_events, schedule_events, publish_events) on public.notification_preferences to authenticated;
grant select, insert on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert on public.audit_events to authenticated;
