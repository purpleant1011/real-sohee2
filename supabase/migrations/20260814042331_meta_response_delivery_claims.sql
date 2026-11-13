alter table public.channel_response_jobs
  add column if not exists draft_fingerprint text;

alter table public.channel_response_jobs
  add constraint channel_response_jobs_draft_fingerprint_check
  check (draft_fingerprint is null or draft_fingerprint ~ '^[a-f0-9]{64}$');

alter table public.channel_response_jobs
  drop constraint channel_response_jobs_status_check;
alter table public.channel_response_jobs
  add constraint channel_response_jobs_status_check
  check (status in ('needs_draft', 'draft', 'approved', 'sending', 'sent', 'failed', 'unknown', 'cancelled'));

alter table public.channel_delivery_attempts
  add column if not exists claim_token_hash text,
  add column if not exists provider_request_id text;

alter table public.channel_delivery_attempts
  add constraint channel_delivery_attempts_claim_token_hash_check
    check (claim_token_hash is null or claim_token_hash ~ '^[a-f0-9]{64}$'),
  add constraint channel_delivery_attempts_provider_request_id_check
    check (provider_request_id is null or char_length(provider_request_id) between 1 and 255);

alter table public.channel_delivery_attempts
  drop constraint channel_delivery_attempts_status_check;
alter table public.channel_delivery_attempts
  add constraint channel_delivery_attempts_status_check
  check (status in ('pending', 'succeeded', 'failed', 'unknown'));

create or replace function public.approve_and_claim_channel_response(
  p_workspace_id uuid,
  p_response_job_id uuid,
  p_draft_text text,
  p_draft_fingerprint text,
  p_claim_token text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.channel_response_jobs%rowtype;
  connection public.channel_connections%rowtype;
  existing_attempt public.channel_delivery_attempts%rowtype;
  attempt_id uuid;
  attempt_number integer;
  attempt_key text;
begin
  if not (select private.has_workspace_role(p_workspace_id, array['owner', 'manager']::text[])) then
    raise exception '채널 응답을 승인하고 전송할 권한이 없습니다.';
  end if;
  if p_draft_text is null or char_length(p_draft_text) not between 1 and 2200 then
    raise exception '응답 문안을 확인해 주세요.';
  end if;
  if p_draft_fingerprint is null
    or p_draft_fingerprint !~ '^[a-f0-9]{64}$'
    or encode(extensions.digest(p_draft_text, 'sha256'), 'hex') <> p_draft_fingerprint then
    raise exception '응답 문안 버전을 다시 확인해 주세요.';
  end if;
  if p_claim_token is null or char_length(p_claim_token) not between 32 and 128
    or p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then
    raise exception '응답 전송 요청을 확인해 주세요.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('channel-response:' || p_response_job_id::text, 0));

  select response.* into job
  from public.channel_response_jobs as response
  where response.workspace_id = p_workspace_id
    and response.id = p_response_job_id
  for update;
  if job.id is null or job.response_kind not in ('instagram_comment_reply', 'instagram_dm', 'threads_reply') then
    raise exception '응답 작업을 확인해 주세요.';
  end if;

  select channel.* into connection
  from public.channel_connections as channel
  where channel.workspace_id = p_workspace_id
    and channel.id = job.channel_connection_id
    and channel.status = 'connected'
    and (
      (job.response_kind in ('instagram_comment_reply', 'instagram_dm') and channel.channel = 'instagram')
      or (job.response_kind = 'threads_reply' and channel.channel = 'threads')
    );
  if connection.id is null or connection.external_account_id is null then
    raise exception '채널 연결을 다시 확인해 주세요.';
  end if;

  select attempt.* into existing_attempt
  from public.channel_delivery_attempts as attempt
  where attempt.workspace_id = p_workspace_id
    and attempt.response_job_id = p_response_job_id
    and attempt.status in ('succeeded', 'unknown', 'pending')
  order by case attempt.status when 'succeeded' then 0 when 'unknown' then 1 else 2 end,
           attempt.attempt_number desc
  limit 1;

  if existing_attempt.id is not null then
    return jsonb_build_object(
      'attemptId', existing_attempt.id,
      'status', existing_attempt.status,
      'providerReference', existing_attempt.provider_reference,
      'errorCode', existing_attempt.error_code,
      'isNew', false,
      'workspaceId', p_workspace_id,
      'responseJobId', job.id,
      'connectionId', connection.id,
      'provider', connection.channel,
      'externalAccountId', connection.external_account_id,
      'responseKind', job.response_kind,
      'externalTargetId', job.external_target_id,
      'draftText', job.draft_text,
      'draftFingerprint', job.draft_fingerprint,
      'idempotencyKey', existing_attempt.idempotency_key
    );
  end if;

  update public.channel_response_jobs
  set draft_text = p_draft_text,
      draft_fingerprint = p_draft_fingerprint,
      status = 'sending',
      approved_by = (select auth.uid()),
      approved_at = now(),
      provider_reference = null,
      last_error_code = null
  where workspace_id = p_workspace_id and id = p_response_job_id;

  select coalesce(max(attempt.attempt_number), 0) + 1 into attempt_number
  from public.channel_delivery_attempts as attempt
  where attempt.workspace_id = p_workspace_id and attempt.response_job_id = p_response_job_id;
  attempt_key := encode(extensions.digest(p_idempotency_key || ':' || attempt_number::text, 'sha256'), 'hex');

  insert into public.channel_delivery_attempts (
    workspace_id, response_job_id, attempt_number, idempotency_key, status, claim_token_hash
  ) values (
    p_workspace_id, p_response_job_id, attempt_number, attempt_key, 'pending',
    encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
  )
  returning id into attempt_id;

  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
  ) values (
    p_workspace_id,
    'channel.response.approved',
    'channel.response.approved:' || attempt_id::text,
    'channel_response_job',
    p_response_job_id,
    jsonb_build_object('draftFingerprint', p_draft_fingerprint, 'attemptId', attempt_id),
    now()
  ) on conflict (workspace_id, event_key) do nothing;

  return jsonb_build_object(
    'attemptId', attempt_id,
    'status', 'pending',
    'providerReference', null,
    'errorCode', null,
    'isNew', true,
    'workspaceId', p_workspace_id,
    'responseJobId', job.id,
    'connectionId', connection.id,
    'provider', connection.channel,
    'externalAccountId', connection.external_account_id,
    'responseKind', job.response_kind,
    'externalTargetId', job.external_target_id,
    'draftText', p_draft_text,
    'draftFingerprint', p_draft_fingerprint,
    'idempotencyKey', attempt_key
  );
end;
$$;

create or replace function public.record_channel_response_provider_request(
  p_workspace_id uuid,
  p_attempt_id uuid,
  p_idempotency_key text,
  p_claim_token text,
  p_provider_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception '서비스 역할만 응답 전송을 기록할 수 있습니다.';
  end if;
  if p_provider_request_id is null or char_length(p_provider_request_id) not between 1 and 255 then
    raise exception '공급자 요청 기록을 확인해 주세요.';
  end if;
  update public.channel_delivery_attempts
  set provider_request_id = p_provider_request_id
  where workspace_id = p_workspace_id
    and id = p_attempt_id
    and idempotency_key = p_idempotency_key
    and claim_token_hash = encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
    and status = 'pending'
    and (provider_request_id is null or provider_request_id = p_provider_request_id)
  returning id into recorded_id;
  if recorded_id is null then raise exception '공급자 요청 기록을 저장하지 못했습니다.'; end if;
  return recorded_id;
end;
$$;

create or replace function public.complete_channel_response_delivery(
  p_workspace_id uuid,
  p_attempt_id uuid,
  p_idempotency_key text,
  p_claim_token text,
  p_status text,
  p_provider_reference text,
  p_error_code text,
  p_provider_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_id uuid;
  response_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception '서비스 역할만 응답 전송을 완료할 수 있습니다.';
  end if;
  if p_status not in ('succeeded', 'failed', 'unknown') then
    raise exception '응답 전송 상태를 확인해 주세요.';
  end if;

  update public.channel_delivery_attempts
  set status = p_status,
      provider_reference = case when p_status = 'succeeded' then p_provider_reference else null end,
      error_code = case when p_status = 'succeeded' then null else p_error_code end,
      finished_at = now()
  where workspace_id = p_workspace_id
    and id = p_attempt_id
    and idempotency_key = p_idempotency_key
    and claim_token_hash = encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
    and status = 'pending'
    and (
      provider_request_id = p_provider_request_id
      or (provider_request_id is null and p_provider_request_id is null)
    )
  returning id, response_job_id into completed_id, response_id;
  if completed_id is null then raise exception '응답 전송 완료 기록을 저장하지 못했습니다.'; end if;

  update public.channel_response_jobs
  set status = case p_status when 'succeeded' then 'sent' when 'unknown' then 'unknown' else 'failed' end,
      provider_reference = case when p_status = 'succeeded' then p_provider_reference else null end,
      last_error_code = case when p_status = 'succeeded' then null else p_error_code end
  where workspace_id = p_workspace_id and id = response_id;

  if p_status in ('succeeded', 'failed') then
    insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
    ) values (
      p_workspace_id,
      case when p_status = 'succeeded' then 'channel.response.sent' else 'channel.response.failed' end,
      'channel.response.delivery:' || completed_id::text || ':' || p_status,
      'channel_response_job',
      response_id,
      jsonb_build_object('attemptId', completed_id, 'status', p_status, 'errorCode', p_error_code),
      now()
    ) on conflict (workspace_id, event_key) do nothing;
  end if;
  return completed_id;
end;
$$;

revoke all on function public.approve_and_claim_channel_response(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.approve_and_claim_channel_response(uuid, uuid, text, text, text, text) to authenticated;

revoke all on function public.record_channel_response_provider_request(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_channel_response_provider_request(uuid, uuid, text, text, text) to service_role;

revoke all on function public.complete_channel_response_delivery(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_channel_response_delivery(uuid, uuid, text, text, text, text, text, text) to service_role;
