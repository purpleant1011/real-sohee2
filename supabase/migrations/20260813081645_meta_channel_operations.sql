-- Meta credentials are encrypted in the Worker before storage. This table is
-- intentionally service-role-only; authenticated clients never read ciphertext.
create table public.meta_channel_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_connection_id uuid not null,
  provider text not null check (provider in ('instagram', 'threads')),
  encrypted_access_token text not null check (char_length(encrypted_access_token) between 24 and 8192),
  access_token_iv text not null check (char_length(access_token_iv) between 16 and 64),
  encryption_algorithm text not null default 'AES-GCM-256' check (encryption_algorithm = 'AES-GCM-256'),
  granted_scopes text[] not null default '{}'::text[] check (cardinality(granted_scopes) <= 30),
  token_expires_at timestamptz,
  refresh_after timestamptz,
  status text not null default 'active' check (status in ('active', 'refresh_required', 'revoked', 'error')),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_channel_credentials_workspace_id_id_key unique (workspace_id, id),
  constraint meta_channel_credentials_connection_key unique (channel_connection_id),
  constraint meta_channel_credentials_connection_fkey
    foreign key (workspace_id, channel_connection_id)
    references public.channel_connections (workspace_id, id)
    on delete cascade
);

create index meta_channel_credentials_refresh_idx
  on public.meta_channel_credentials (status, refresh_after)
  where status in ('active', 'refresh_required');

create unique index channel_connections_meta_external_account_key
  on public.channel_connections (channel, external_account_id)
  where channel in ('instagram', 'threads') and external_account_id is not null;

create table public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_connection_id uuid not null,
  provider text not null check (provider in ('instagram', 'threads')),
  category text not null check (category in ('comment', 'reply', 'mention', 'dm')),
  event_key text not null check (char_length(event_key) between 3 and 500),
  provider_event_id text check (provider_event_id is null or char_length(provider_event_id) <= 500),
  external_subject_id text check (external_subject_id is null or char_length(external_subject_id) <= 500),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'received' check (status in ('received', 'classified', 'processed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint provider_webhook_events_workspace_id_id_key unique (workspace_id, id),
  constraint provider_webhook_events_workspace_event_key unique (workspace_id, event_key),
  constraint provider_webhook_events_connection_fkey
    foreign key (workspace_id, channel_connection_id)
    references public.channel_connections (workspace_id, id)
    on delete restrict
);

create index provider_webhook_events_pending_idx
  on public.provider_webhook_events (status, next_attempt_at, received_at)
  where status in ('received', 'classified');

create table public.channel_response_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  inbound_event_id uuid not null,
  channel_connection_id uuid not null,
  response_kind text not null check (response_kind in ('instagram_comment_reply', 'threads_reply', 'instagram_dm')),
  external_target_id text not null check (char_length(external_target_id) between 1 and 500),
  draft_text text check (draft_text is null or char_length(draft_text) between 1 and 2200),
  status text not null default 'needs_draft'
    check (status in ('needs_draft', 'draft', 'approved', 'sending', 'sent', 'failed', 'cancelled')),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  provider_reference text check (provider_reference is null or char_length(provider_reference) <= 500),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_response_jobs_workspace_id_id_key unique (workspace_id, id),
  constraint channel_response_jobs_event_key unique (inbound_event_id),
  constraint channel_response_jobs_idempotency_key unique (workspace_id, idempotency_key),
  constraint channel_response_jobs_event_fkey
    foreign key (workspace_id, inbound_event_id)
    references public.provider_webhook_events (workspace_id, id)
    on delete cascade,
  constraint channel_response_jobs_connection_fkey
    foreign key (workspace_id, channel_connection_id)
    references public.channel_connections (workspace_id, id)
    on delete restrict,
  constraint channel_response_jobs_approval_evidence_check check (
    (status not in ('approved', 'sending', 'sent'))
    or (draft_text is not null and approved_by is not null and approved_at is not null)
  )
);

create index channel_response_jobs_review_idx
  on public.channel_response_jobs (workspace_id, status, created_at)
  where status in ('needs_draft', 'draft', 'failed');

create table public.channel_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  response_job_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 20),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  provider_reference text check (provider_reference is null or char_length(provider_reference) <= 500),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint channel_delivery_attempts_workspace_id_id_key unique (workspace_id, id),
  constraint channel_delivery_attempts_response_attempt_key unique (response_job_id, attempt_number),
  constraint channel_delivery_attempts_idempotency_key unique (workspace_id, idempotency_key),
  constraint channel_delivery_attempts_response_fkey
    foreign key (workspace_id, response_job_id)
    references public.channel_response_jobs (workspace_id, id)
    on delete cascade
);

create index channel_delivery_attempts_status_idx
  on public.channel_delivery_attempts (workspace_id, status, started_at desc);

create function private.create_channel_response_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  response_kind text;
  target_id text;
  response_id uuid;
begin
  response_kind := case
    when new.provider = 'instagram' and new.category in ('comment', 'mention') then 'instagram_comment_reply'
    when new.provider = 'threads' and new.category in ('reply', 'mention') then 'threads_reply'
    when new.provider = 'instagram' and new.category = 'dm' then 'instagram_dm'
    else null
  end;
  target_id := case when new.category = 'dm' then new.external_subject_id else new.provider_event_id end;
  if response_kind is null or target_id is null then return new; end if;

  insert into public.channel_response_jobs (
    workspace_id, inbound_event_id, channel_connection_id, response_kind,
    external_target_id, idempotency_key
  ) values (
    new.workspace_id, new.id, new.channel_connection_id, response_kind,
    target_id,
    encode(extensions.digest('sohee:channel-response:' || new.id::text, 'sha256'), 'hex')
  )
  on conflict (inbound_event_id) do nothing
  returning id into response_id;

  if response_id is not null then
    insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
    ) values (
      new.workspace_id,
      'channel.response.created',
      'channel.response.created:' || response_id::text,
      'channel_response_job',
      response_id,
      jsonb_build_object('channel', new.provider, 'responseKind', response_kind),
      now()
    ) on conflict (workspace_id, event_key) do nothing;
  end if;
  return new;
end;
$$;

alter table public.operation_events
  drop constraint operation_events_event_type_check;
alter table public.operation_events
  add constraint operation_events_event_type_check check (
    event_type in (
      'content.plan.created', 'content.version.created', 'content.review.requested',
      'content.approved', 'content.approval.invalidated', 'schedule.suggested',
      'schedule.confirmed', 'publish.succeeded', 'publish.failed', 'report.snapshot.ready',
      'customer.conversation.needs_attention', 'knowledge.conflict.detected',
      'harness.rule.candidate_created', 'channel.response.created',
      'channel.response.approved', 'channel.response.sent', 'channel.response.failed'
    )
  );

create trigger provider_webhook_event_create_response_job
after insert on public.provider_webhook_events
for each row execute function private.create_channel_response_job();

create trigger meta_channel_credentials_set_updated_at
before update on public.meta_channel_credentials
for each row execute function private.set_updated_at();
create trigger channel_response_jobs_set_updated_at
before update on public.channel_response_jobs
for each row execute function private.set_updated_at();

alter table public.meta_channel_credentials enable row level security;
alter table public.provider_webhook_events enable row level security;
alter table public.channel_response_jobs enable row level security;
alter table public.channel_delivery_attempts enable row level security;

create policy "workspace managers can read channel response jobs"
on public.channel_response_jobs for select to authenticated
using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

revoke all on public.meta_channel_credentials from public, anon, authenticated;
revoke all on public.provider_webhook_events from public, anon, authenticated;
revoke all on public.channel_response_jobs from public, anon, authenticated;
revoke all on public.channel_delivery_attempts from public, anon, authenticated;
grant select on public.channel_response_jobs to authenticated;
grant select, insert, update, delete on public.meta_channel_credentials to service_role;
grant select, insert, update, delete on public.provider_webhook_events to service_role;
grant select, insert, update, delete on public.channel_response_jobs to service_role;
grant select, insert, update, delete on public.channel_delivery_attempts to service_role;

create function private.approve_channel_response_internal(
  p_workspace_id uuid,
  p_response_job_id uuid,
  p_draft_text text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_id uuid;
begin
  if not (select private.has_workspace_role(p_workspace_id, array['owner', 'manager']::text[])) then
    raise exception '채널 응답을 승인할 권한이 없습니다.';
  end if;
  if p_draft_text is null or char_length(p_draft_text) not between 1 and 2200 then
    raise exception '응답 문안을 확인해 주세요.';
  end if;
  update public.channel_response_jobs
  set draft_text = p_draft_text,
      status = 'approved',
      approved_by = (select auth.uid()),
      approved_at = now()
  where workspace_id = p_workspace_id
    and id = p_response_job_id
    and status in ('needs_draft', 'draft', 'failed')
  returning id into approved_id;
  if approved_id is null then raise exception '승인할 채널 응답을 확인해 주세요.'; end if;
  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
  ) values (
    p_workspace_id, 'channel.response.approved',
    'channel.response.approved:' || approved_id::text,
    'channel_response_job', approved_id, '{}'::jsonb, now()
  ) on conflict (workspace_id, event_key) do nothing;
  return approved_id;
end;
$$;

create function public.approve_channel_response(
  p_workspace_id uuid,
  p_response_job_id uuid,
  p_draft_text text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.approve_channel_response_internal(p_workspace_id, p_response_job_id, p_draft_text);
$$;

revoke all on function private.create_channel_response_job() from public, anon, authenticated;
revoke all on function private.approve_channel_response_internal(uuid, uuid, text) from public, anon;
grant execute on function private.approve_channel_response_internal(uuid, uuid, text) to authenticated;
revoke all on function public.approve_channel_response(uuid, uuid, text) from public, anon;
grant execute on function public.approve_channel_response(uuid, uuid, text) to authenticated;

create function public.list_channel_interactions(p_workspace_id uuid)
returns table (
  event_id uuid,
  provider text,
  category text,
  occurred_at timestamptz,
  inbound_text text,
  response_job_id uuid,
  response_kind text,
  response_text text,
  response_status text,
  response_approved_at timestamptz,
  response_provider_reference text,
  delivery_status text,
  delivery_error_code text,
  content_id uuid,
  content_version_id uuid,
  content_title text,
  schedule_id uuid,
  publish_at timestamptz,
  schedule_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.has_workspace_role(p_workspace_id, array['owner', 'manager']::text[])) then
    raise exception '채널 대화를 볼 권한이 없습니다.';
  end if;
  return query
  select
    event.id,
    event.provider,
    event.category,
    event.occurred_at,
    case
      when event.category = 'dm' then event.payload #>> '{message,text}'
      else event.payload #>> '{value,text}'
    end,
    response.id,
    response.response_kind,
    response.draft_text,
    response.status,
    response.approved_at,
    response.provider_reference,
    delivery.status,
    delivery.error_code,
    schedule.content_id,
    schedule.version_id,
    content.title,
    schedule.id,
    schedule.publish_at,
    schedule.status
  from public.provider_webhook_events as event
  left join public.channel_response_jobs as response
    on response.workspace_id = event.workspace_id
   and response.inbound_event_id = event.id
  left join lateral (
    select attempt.status, attempt.error_code
    from public.channel_delivery_attempts as attempt
    where attempt.workspace_id = response.workspace_id
      and attempt.response_job_id = response.id
    order by attempt.attempt_number desc
    limit 1
  ) as delivery on true
  left join lateral (
    select candidate_schedule.*
    from public.publish_attempts as publish_attempt
    join public.schedules as candidate_schedule
      on candidate_schedule.workspace_id = publish_attempt.workspace_id
     and candidate_schedule.id = publish_attempt.schedule_id
    where publish_attempt.workspace_id = event.workspace_id
      and publish_attempt.status = 'succeeded'
      and publish_attempt.provider_reference = coalesce(
        event.payload #>> '{value,media,id}',
        event.payload #>> '{value,replied_to,id}',
        event.payload #>> '{value,root_post,id}'
      )
    order by publish_attempt.finished_at desc nulls last
    limit 1
  ) as schedule on true
  left join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
  where event.workspace_id = p_workspace_id
  order by event.occurred_at desc, event.id desc
  limit 100;
end;
$$;

revoke all on function public.list_channel_interactions(uuid) from public, anon;
grant execute on function public.list_channel_interactions(uuid) to authenticated;
