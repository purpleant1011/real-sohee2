alter table public.channel_connections
  drop constraint channel_connections_channel_check;
alter table public.channel_connections
  add constraint channel_connections_channel_check check (
    channel in ('instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business')
  );

create table public.channel_capabilities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('naver_place', 'daangn_business')),
  capability text not null default 'manual_assist_only'
    check (capability in ('supervised_allowed', 'manual_assist_only', 'unsupported')),
  official_source_url text not null check (char_length(official_source_url) between 1 and 2048),
  last_verified_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, channel)
);

create table public.channel_profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('naver_place', 'daangn_business')),
  target_external_id text not null check (char_length(target_external_id) between 1 and 255),
  target_label text not null check (char_length(target_label) between 1 and 255),
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  observed_at timestamptz not null,
  observed_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  constraint channel_profile_snapshots_workspace_id_id_key unique (workspace_id, id)
);
create index channel_profile_snapshots_target_idx
  on public.channel_profile_snapshots (workspace_id, channel, target_external_id, observed_at desc);

create table public.channel_profile_change_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  snapshot_id uuid not null,
  channel text not null check (channel in ('naver_place', 'daangn_business')),
  target_external_id text not null check (char_length(target_external_id) between 1 and 255),
  target_label text not null check (char_length(target_label) between 1 and 255),
  field text not null check (char_length(field) between 1 and 120),
  before_value jsonb not null,
  after_value jsonb not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  capability text not null default 'manual_assist_only'
    check (capability in ('supervised_allowed', 'manual_assist_only', 'unsupported')),
  evidence_url text not null check (char_length(evidence_url) between 1 and 2048),
  proposal_fingerprint text not null check (proposal_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (before_value <> 'null'::jsonb or after_value <> 'null'::jsonb),
  constraint channel_profile_change_proposals_workspace_id_id_key unique (workspace_id, id),
  foreign key (workspace_id, snapshot_id)
    references public.channel_profile_snapshots(workspace_id, id) on delete restrict
);
create index channel_profile_change_proposals_target_idx
  on public.channel_profile_change_proposals (workspace_id, channel, target_external_id, status, created_at desc);

create table public.external_action_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('naver_place', 'daangn_business')),
  action_kind text not null check (action_kind in ('profile_edit', 'news_post')),
  target_external_id text not null check (char_length(target_external_id) between 1 and 255),
  target_label text not null check (char_length(target_label) between 1 and 255),
  exact_payload jsonb not null check (jsonb_typeof(exact_payload) = 'object'),
  content_version_id uuid,
  approval_id uuid,
  approval_fingerprint text check (approval_fingerprint is null or approval_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null default 'prepared' check (status in (
    'connection_required', 'user_login_required', 'ready', 'prepared', 'approval_required',
    'executing', 'submitted', 'provider_review', 'succeeded', 'failed',
    'manual_assist_required', 'unknown_result'
  )),
  failure_code text check (failure_code is null or failure_code in (
    'REAUTH_REQUIRED', 'UI_DRIFT', 'TARGET_MISMATCH', 'POLICY_RESTRICTION',
    'DOCUMENT_REQUIRED', 'DUPLICATE_AMBIGUOUS', 'UNKNOWN_RESULT', 'BROKER_UNAVAILABLE'
  )),
  created_by uuid not null references auth.users(id),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint external_action_requests_workspace_id_id_key unique (workspace_id, id),
  constraint external_action_requests_workspace_idempotency_key_key unique (workspace_id, idempotency_key),
  foreign key (workspace_id, content_version_id)
    references public.content_versions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, approval_id)
    references public.approvals(workspace_id, id) on delete restrict
);
create index external_action_requests_workspace_status_idx
  on public.external_action_requests (workspace_id, status, created_at desc);

create table public.external_action_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_request_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in (
    'claimed', 'submitted', 'provider_review', 'succeeded', 'failed', 'unknown_result', 'manual_assist_required'
  )),
  failure_code text check (failure_code is null or failure_code in (
    'REAUTH_REQUIRED', 'UI_DRIFT', 'TARGET_MISMATCH', 'POLICY_RESTRICTION',
    'DOCUMENT_REQUIRED', 'DUPLICATE_AMBIGUOUS', 'UNKNOWN_RESULT', 'BROKER_UNAVAILABLE'
  )),
  provider_request_id text check (provider_request_id is null or char_length(provider_request_id) <= 500),
  provider_reference text check (provider_reference is null or char_length(provider_reference) <= 500),
  started_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  created_by uuid not null references auth.users(id),
  constraint external_action_attempts_request_number_key unique (action_request_id, attempt_number),
  constraint external_action_attempts_workspace_id_id_key unique (workspace_id, id),
  foreign key (workspace_id, action_request_id)
    references public.external_action_requests(workspace_id, id) on delete cascade
);

create table public.external_action_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_request_id uuid not null,
  attempt_id uuid,
  receipt_kind text not null check (receipt_kind in ('submission', 'provider_review', 'observed_result', 'manual_assist')),
  provider_reference text check (provider_reference is null or char_length(provider_reference) <= 500),
  result_url text check (result_url is null or char_length(result_url) <= 2048),
  observed_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(observed_payload) = 'object'),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default statement_timestamp(),
  constraint external_action_receipts_workspace_id_id_key unique (workspace_id, id),
  foreign key (workspace_id, action_request_id)
    references public.external_action_requests(workspace_id, id) on delete cascade,
  foreign key (workspace_id, attempt_id)
    references public.external_action_attempts(workspace_id, id) on delete restrict
);

create table private.supervised_session_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_connection_id uuid not null,
  reference_handle text not null check (char_length(reference_handle) between 16 and 512),
  state text not null default 'unavailable' check (state in ('unavailable', 'active', 'expired', 'revoked')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, channel_connection_id),
  foreign key (workspace_id, channel_connection_id)
    references public.channel_connections(workspace_id, id) on delete cascade
);

create trigger channel_capabilities_set_updated_at
before update on public.channel_capabilities
for each row execute function private.set_updated_at();
create trigger channel_profile_change_proposals_set_updated_at
before update on public.channel_profile_change_proposals
for each row execute function private.set_updated_at();
create trigger external_action_requests_set_updated_at
before update on public.external_action_requests
for each row execute function private.set_updated_at();
create trigger supervised_session_references_set_updated_at
before update on private.supervised_session_references
for each row execute function private.set_updated_at();

create function private.prevent_external_receipt_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'EXTERNAL_RECEIPT_IMMUTABLE';
end;
$$;
create trigger external_action_receipts_immutable
before update or delete on public.external_action_receipts
for each row execute function private.prevent_external_receipt_mutation();

alter table public.channel_capabilities enable row level security;
alter table public.channel_profile_snapshots enable row level security;
alter table public.channel_profile_change_proposals enable row level security;
alter table public.external_action_requests enable row level security;
alter table public.external_action_attempts enable row level security;
alter table public.external_action_receipts enable row level security;

revoke all on public.channel_capabilities, public.channel_profile_snapshots,
  public.channel_profile_change_proposals, public.external_action_requests,
  public.external_action_attempts, public.external_action_receipts
  from public, anon, authenticated;
grant select on public.channel_capabilities, public.channel_profile_snapshots,
  public.channel_profile_change_proposals, public.external_action_requests,
  public.external_action_attempts, public.external_action_receipts to authenticated;
grant select, insert, update, delete on public.channel_capabilities, public.channel_profile_snapshots,
  public.channel_profile_change_proposals, public.external_action_requests,
  public.external_action_attempts, public.external_action_receipts to service_role;
revoke all on table private.supervised_session_references from public, anon, authenticated;
grant select, insert, update, delete on table private.supervised_session_references to service_role;

create policy "workspace members can read channel capabilities"
on public.channel_capabilities for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace members can read profile snapshots"
on public.channel_profile_snapshots for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace members can read profile proposals"
on public.channel_profile_change_proposals for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace members can read external action requests"
on public.external_action_requests for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace members can read external action attempts"
on public.external_action_attempts for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace members can read external action receipts"
on public.external_action_receipts for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create function private.external_action_actor_is_operator(p_workspace_id uuid, p_actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'manager')
  );
$$;

create function public.save_channel_profile_snapshot(
  p_workspace_id uuid, p_actor_user_id uuid, p_channel text, p_target_external_id text,
  p_target_label text, p_fields jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare snapshot_id uuid;
begin
  if not private.external_action_actor_is_operator(p_workspace_id, p_actor_user_id)
    or p_channel not in ('naver_place', 'daangn_business')
    or jsonb_typeof(p_fields) <> 'object' then
    raise exception '외부 프로필 스냅샷을 저장할 권한이 없습니다.';
  end if;
  insert into public.channel_profile_snapshots (
    workspace_id, channel, target_external_id, target_label, fields, observed_at, observed_by
  ) values (
    p_workspace_id, p_channel, p_target_external_id, p_target_label, p_fields,
    statement_timestamp(), p_actor_user_id
  ) returning id into snapshot_id;
  return snapshot_id;
end;
$$;

create function public.approve_profile_change_proposal(
  p_workspace_id uuid, p_proposal_id uuid, p_actor_user_id uuid, p_expected_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.external_action_actor_is_operator(p_workspace_id, p_actor_user_id) then
    raise exception '외부 프로필 변경을 승인할 권한이 없습니다.';
  end if;
  update public.channel_profile_change_proposals
  set status = 'approved', decided_by = p_actor_user_id, decided_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = p_proposal_id
    and status = 'proposed' and proposal_fingerprint = p_expected_fingerprint;
  return found;
end;
$$;

create function public.claim_external_action(
  p_workspace_id uuid, p_action_id uuid, p_actor_user_id uuid, p_expected_approval_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare action_row public.external_action_requests%rowtype;
begin
  if not private.external_action_actor_is_operator(p_workspace_id, p_actor_user_id) then
    raise exception '외부 작업을 만들 권한이 없습니다.';
  end if;
  select * into action_row from public.external_action_requests
  where workspace_id = p_workspace_id and id = p_action_id for update;
  if not found or action_row.status not in ('prepared', 'approval_required')
    or action_row.approval_id is null
    or action_row.approval_fingerprint is distinct from p_expected_approval_fingerprint
    or not exists (
      select 1 from public.approvals as approval
      where approval.workspace_id = p_workspace_id and approval.id = action_row.approval_id
        and approval.status = 'approved' and approval.fingerprint = p_expected_approval_fingerprint
    ) then
    return false;
  end if;
  update public.external_action_requests
  set status = 'executing', claimed_by = p_actor_user_id, claimed_at = statement_timestamp(), failure_code = null
  where workspace_id = p_workspace_id and id = p_action_id;
  insert into public.external_action_attempts (
    workspace_id, action_request_id, attempt_number, status, created_by
  ) values (
    p_workspace_id, p_action_id,
    (select coalesce(max(attempt_number), 0) + 1 from public.external_action_attempts where action_request_id = p_action_id),
    'claimed', p_actor_user_id
  );
  return true;
end;
$$;

create function public.record_external_action_result(
  p_workspace_id uuid, p_action_id uuid, p_status text, p_provider_reference text, p_failure_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare next_status text;
declare latest_attempt_id uuid;
declare action_creator_id uuid;
begin
  if p_status not in ('submitted', 'provider_review', 'succeeded', 'failed', 'manual_assist_required', 'unknown_result')
    or (p_failure_code is not null and p_failure_code not in (
      'REAUTH_REQUIRED', 'UI_DRIFT', 'TARGET_MISMATCH', 'POLICY_RESTRICTION',
      'DOCUMENT_REQUIRED', 'DUPLICATE_AMBIGUOUS', 'UNKNOWN_RESULT', 'BROKER_UNAVAILABLE'
    )) then return false; end if;
  select status into next_status from public.external_action_requests
  where workspace_id = p_workspace_id and id = p_action_id for update;
  if next_status <> 'executing' then return false; end if;
  select id into latest_attempt_id from public.external_action_attempts
  where workspace_id = p_workspace_id and action_request_id = p_action_id and status = 'claimed'
  order by attempt_number desc limit 1;
  select created_by into action_creator_id from public.external_action_requests
  where workspace_id = p_workspace_id and id = p_action_id;
  update public.external_action_requests
  set status = p_status, failure_code = p_failure_code
  where workspace_id = p_workspace_id and id = p_action_id;
  update public.external_action_attempts
  set status = case when p_status in ('failed', 'manual_assist_required', 'unknown_result') then p_status else p_status end,
      provider_reference = p_provider_reference, failure_code = p_failure_code, finished_at = statement_timestamp()
  where id = latest_attempt_id;
  if p_status in ('submitted', 'provider_review', 'succeeded', 'manual_assist_required') then
    insert into public.external_action_receipts (
      workspace_id, action_request_id, attempt_id, receipt_kind, provider_reference, recorded_by
    ) values (
      p_workspace_id, p_action_id, latest_attempt_id,
      case p_status
        when 'provider_review' then 'provider_review'
        when 'succeeded' then 'observed_result'
        when 'manual_assist_required' then 'manual_assist'
        else 'submission'
      end,
      p_provider_reference, action_creator_id
    );
  end if;
  return true;
end;
$$;

create function public.reconcile_external_action(
  p_workspace_id uuid, p_action_id uuid, p_observed_result_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_observed_result_url is null or char_length(p_observed_result_url) > 2048 then return false; end if;
  update public.external_action_requests
  set status = 'unknown_result', failure_code = 'UNKNOWN_RESULT'
  where workspace_id = p_workspace_id and id = p_action_id and status in ('executing', 'submitted', 'provider_review');
  return found;
end;
$$;

revoke all on function private.prevent_external_receipt_mutation() from public, anon, authenticated;
revoke all on function private.external_action_actor_is_operator(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_channel_profile_snapshot(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.approve_profile_change_proposal(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_external_action(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_external_action_result(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.reconcile_external_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.save_channel_profile_snapshot(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.approve_profile_change_proposal(uuid, uuid, uuid, text) to service_role;
grant execute on function public.claim_external_action(uuid, uuid, uuid, text) to service_role;
grant execute on function public.record_external_action_result(uuid, uuid, text, text, text) to service_role;
grant execute on function public.reconcile_external_action(uuid, uuid, text) to service_role;
