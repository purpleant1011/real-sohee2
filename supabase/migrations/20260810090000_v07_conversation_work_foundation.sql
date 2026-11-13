create table public.conversation_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('operations', 'work', 'customer_summary')),
  title text not null check (char_length(title) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'archived')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_threads_workspace_id_id_key unique (workspace_id, id)
);

create index conversation_threads_workspace_last_message_idx
  on public.conversation_threads (workspace_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'sohee', 'system_event')),
  content text not null check (char_length(content) between 1 and 20000),
  status text not null check (
    status in ('queued', 'streaming', 'completed', 'failed', 'cancelled')
  ),
  client_message_id uuid,
  reply_to_message_id uuid,
  work_item_id uuid,
  artifact_type text check (
    artifact_type is null
    or artifact_type in ('work_item', 'content_version', 'schedule', 'report_snapshot', 'media_asset')
  ),
  artifact_id uuid,
  model_name text check (model_name is null or char_length(model_name) <= 120),
  usage_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(usage_metadata) = 'object'),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  created_by_user_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint messages_workspace_client_message_id_key
    unique (workspace_id, client_message_id),
  constraint messages_workspace_id_id_key unique (workspace_id, id),
  constraint messages_thread_identity_key unique (workspace_id, thread_id, id),
  constraint messages_thread_fkey
    foreign key (workspace_id, thread_id)
    references public.conversation_threads (workspace_id, id)
    on delete cascade,
  constraint messages_reply_to_fkey
    foreign key (workspace_id, thread_id, reply_to_message_id)
    references public.messages (workspace_id, thread_id, id)
    on delete restrict,
  constraint messages_completion_check check (
    (status in ('queued', 'streaming') and completed_at is null)
    or status in ('completed', 'failed', 'cancelled')
  ),
  constraint messages_artifact_check check (
    (artifact_type is null and artifact_id is null)
    or (artifact_type is not null and artifact_id is not null)
  )
);

create index messages_thread_created_idx
  on public.messages (thread_id, created_at desc);
create index messages_workspace_work_item_idx
  on public.messages (workspace_id, work_item_id)
  where work_item_id is not null;

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null check (
    type in ('content', 'customer_followup', 'knowledge_review', 'recovery', 'campaign', 'report_review')
  ),
  title text not null check (char_length(title) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 4000),
  status text not null check (
    status in (
      'idea', 'researching', 'drafting', 'review_required',
      'revision_requested', 'revising', 'approved', 'schedule_required',
      'scheduled', 'publishing', 'published', 'blocked', 'publish_failed',
      'recovery_required', 'cancelled', 'archived'
    )
  ),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  owner_type text not null default 'shared'
    check (owner_type in ('sohee', 'user', 'shared')),
  owner_user_id uuid references auth.users (id),
  due_at timestamptz,
  source_thread_id uuid,
  source_message_id uuid,
  content_item_id uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_items_workspace_id_id_key unique (workspace_id, id),
  constraint work_items_source_thread_fkey
    foreign key (workspace_id, source_thread_id)
    references public.conversation_threads (workspace_id, id)
    on delete restrict,
  constraint work_items_source_message_fkey
    foreign key (workspace_id, source_thread_id, source_message_id)
    references public.messages (workspace_id, thread_id, id)
    on delete restrict,
  constraint work_items_content_item_fkey
    foreign key (workspace_id, content_item_id)
    references public.content_items (workspace_id, id)
    on delete restrict,
  constraint work_items_source_message_requires_thread_check check (
    source_message_id is null or source_thread_id is not null
  )
);

create index work_items_workspace_status_due_idx
  on public.work_items (workspace_id, status, due_at);
create index work_items_source_message_idx
  on public.work_items (workspace_id, source_message_id)
  where source_message_id is not null;
create index work_items_content_item_idx
  on public.work_items (workspace_id, content_item_id)
  where content_item_id is not null;

alter table public.messages
  add constraint messages_work_item_fkey
  foreign key (workspace_id, work_item_id)
  references public.work_items (workspace_id, id)
  on delete set null (work_item_id);

create table public.message_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  message_id uuid not null,
  evidence_type text not null check (
    evidence_type in (
      'knowledge', 'report', 'customer_conversation', 'work_item',
      'content_version', 'schedule', 'policy'
    )
  ),
  evidence_id uuid not null,
  label text not null check (char_length(label) between 1 and 200),
  excerpt text check (excerpt is null or char_length(excerpt) <= 1000),
  source_uri text check (source_uri is null or char_length(source_uri) <= 2048),
  source_timestamp timestamptz,
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),
  constraint message_evidence_workspace_id_id_key unique (workspace_id, id),
  constraint message_evidence_message_fkey
    foreign key (workspace_id, message_id)
    references public.messages (workspace_id, id)
    on delete cascade,
  constraint message_evidence_message_resource_key
    unique (message_id, evidence_type, evidence_id)
);

create index message_evidence_workspace_message_idx
  on public.message_evidence (workspace_id, message_id, created_at);

create or replace function private.validate_message_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_exists boolean := false;
begin
  case new.evidence_type
    when 'knowledge' then
      select exists (
        select 1 from public.knowledge_items
        where workspace_id = new.workspace_id and id = new.evidence_id
      ) into resource_exists;
    when 'report' then
      select exists (
        select 1 from public.report_snapshots
        where workspace_id = new.workspace_id and id = new.evidence_id
      ) into resource_exists;
    when 'work_item' then
      select exists (
        select 1 from public.work_items
        where workspace_id = new.workspace_id and id = new.evidence_id
      ) into resource_exists;
    when 'content_version' then
      select exists (
        select 1 from public.content_versions
        where workspace_id = new.workspace_id and id = new.evidence_id
      ) into resource_exists;
    when 'schedule' then
      select exists (
        select 1 from public.schedules
        where workspace_id = new.workspace_id and id = new.evidence_id
      ) into resource_exists;
    when 'policy' then
      resource_exists := new.evidence_id = new.workspace_id;
    when 'customer_conversation' then
      if to_regclass('public.customer_conversations') is not null then
        execute
          'select exists (
             select 1 from public.customer_conversations
             where workspace_id = $1 and id = $2
           )'
          into resource_exists
          using new.workspace_id, new.evidence_id;
      end if;
  end case;

  if not resource_exists then
    raise exception '근거가 현재 작업 공간에 속하지 않습니다.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function private.touch_conversation_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_threads
  set last_message_at = greatest(
        coalesce(last_message_at, '-infinity'::timestamptz),
        new.created_at
      ),
      updated_at = statement_timestamp()
  where workspace_id = new.workspace_id
    and id = new.thread_id;
  return new;
end;
$$;

create or replace function private.validate_message_artifact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.artifact_type = 'media_asset' and not exists (
    select 1
    from public.media_assets
    where workspace_id = new.workspace_id
      and id = new.artifact_id
      and kind = 'content'
      and rights_status = 'confirmed'
  ) then
    raise exception '이미지 초안이 현재 작업공간에 속하지 않습니다.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger conversation_threads_set_updated_at
before update on public.conversation_threads
for each row execute function private.set_updated_at();

create trigger work_items_set_updated_at
before update on public.work_items
for each row execute function private.set_updated_at();

create trigger messages_touch_thread
after insert on public.messages
for each row execute function private.touch_conversation_thread();

create trigger messages_validate_artifact
before insert or update of artifact_type, artifact_id on public.messages
for each row execute function private.validate_message_artifact();

create trigger message_evidence_validate_resource
before insert or update on public.message_evidence
for each row execute function private.validate_message_evidence();

revoke execute on function private.validate_message_evidence() from public, anon, authenticated;
revoke execute on function private.touch_conversation_thread() from public, anon, authenticated;
revoke execute on function private.validate_message_artifact() from public, anon, authenticated;

alter table public.conversation_threads enable row level security;
alter table public.messages enable row level security;
alter table public.work_items enable row level security;
alter table public.message_evidence enable row level security;

create policy "workspace members can read conversation threads"
on public.conversation_threads for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace collaborators can create conversation threads"
on public.conversation_threads for insert to authenticated
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

create policy "workspace collaborators can update conversation threads"
on public.conversation_threads for update to authenticated
using ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)))
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

create policy "workspace members can read messages"
on public.messages for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can create user messages"
on public.messages for insert to authenticated
with check (
  role = 'user'
  and created_by_user_id = (select auth.uid())
  and (select private.is_workspace_member(workspace_id))
);

create policy "workspace collaborators can link messages to work"
on public.messages for update to authenticated
using ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)))
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

create policy "workspace members can read work items"
on public.work_items for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace collaborators can create work items"
on public.work_items for insert to authenticated
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

create policy "workspace collaborators can update work items"
on public.work_items for update to authenticated
using ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)))
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

create policy "workspace members can read message evidence"
on public.message_evidence for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace collaborators can create message evidence"
on public.message_evidence for insert to authenticated
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

revoke all on public.conversation_threads from anon, authenticated;
revoke all on public.messages from anon, authenticated;
revoke all on public.work_items from anon, authenticated;
revoke all on public.message_evidence from anon, authenticated;

grant select, insert on public.conversation_threads to authenticated;
grant update (title, status, last_message_at) on public.conversation_threads to authenticated;
grant select on public.messages to authenticated;
grant insert (
  id, workspace_id, thread_id, role, content, status, client_message_id,
  reply_to_message_id, created_by_user_id
) on public.messages to authenticated;
grant update (work_item_id) on public.messages to authenticated;
grant select, insert on public.work_items to authenticated;
grant update (
  title, summary, status, priority, owner_type, owner_user_id, due_at,
  content_item_id
) on public.work_items to authenticated;
grant select, insert on public.message_evidence to authenticated;

grant select, insert, update, delete on public.conversation_threads to service_role;
grant select, insert, update, delete on public.messages to service_role;
grant select, insert, update, delete on public.work_items to service_role;
grant select, insert, update, delete on public.message_evidence to service_role;
