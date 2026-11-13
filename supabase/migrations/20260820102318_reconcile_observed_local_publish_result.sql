create function public.reconcile_local_publish_observed_result(
  p_workspace_id uuid,
  p_action_id uuid,
  p_result_url text,
  p_provider_reference text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request public.external_action_requests%rowtype;
  lease private.local_publish_leases%rowtype;
  recorded_by_user uuid;
begin
  if p_result_url is null or char_length(p_result_url) > 2048
    or p_result_url !~ '^https://blog\.naver\.com/PostView\.naver\?'
    or p_provider_reference !~ '^[0-9]+$' then return false; end if;

  select candidate.* into request
  from public.external_action_requests as candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_action_id
    and candidate.channel = 'naver_blog'
    and candidate.status = 'unknown_result'
    and candidate.failure_code = 'UNKNOWN_RESULT'
  for update;
  if not found then return false; end if;

  if position('blogId=' || request.target_external_id in p_result_url) = 0
    or position('logNo=' || p_provider_reference in p_result_url) = 0 then return false; end if;

  select candidate.* into lease
  from private.local_publish_leases as candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.action_request_id = p_action_id
  order by candidate.created_at desc
  limit 1
  for update;
  if not found or lease.status <> 'submitted'
    or lease.current_phase <> 'unknown_after_submit'
    or lease.submit_permit_digest is null
    or lease.submit_permit_issued_at is null then return false; end if;

  if not exists (
    select 1 from public.external_action_attempts as attempt
    where attempt.workspace_id = p_workspace_id
      and attempt.id = lease.attempt_id
      and attempt.action_request_id = p_action_id
      and attempt.status = 'unknown_result'
      and attempt.failure_code = 'UNKNOWN_RESULT'
  ) or not exists (
    select 1 from public.external_action_receipts as receipt
    where receipt.workspace_id = p_workspace_id
      and receipt.action_request_id = p_action_id
      and receipt.attempt_id = lease.attempt_id
      and receipt.receipt_kind = 'submission'
  ) or exists (
    select 1 from public.external_action_receipts as receipt
    where receipt.workspace_id = p_workspace_id
      and receipt.action_request_id = p_action_id
      and receipt.receipt_kind = 'observed_result'
  ) then return false; end if;

  select created_by into recorded_by_user
  from public.connector_devices
  where workspace_id = p_workspace_id and id = lease.device_id;
  if recorded_by_user is null then return false; end if;

  update public.external_action_requests
  set status = 'succeeded', failure_code = null, updated_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = p_action_id;

  update public.external_action_attempts
  set status = 'succeeded', failure_code = null,
      provider_reference = p_provider_reference, finished_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = lease.attempt_id;

  insert into public.external_action_receipts (
    workspace_id, action_request_id, attempt_id, receipt_kind,
    provider_reference, result_url, observed_payload, recorded_by
  ) values (
    p_workspace_id, p_action_id, lease.attempt_id, 'observed_result',
    p_provider_reference, p_result_url,
    jsonb_build_object('source', 'authenticated_naver_post_list', 'visibility', request.exact_payload ->> 'visibility'),
    recorded_by_user
  );

  update private.local_publish_leases
  set status = 'completed', current_phase = 'succeeded', updated_at = statement_timestamp()
  where id = lease.id;
  return true;
end;
$$;

revoke all on function public.reconcile_local_publish_observed_result(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.reconcile_local_publish_observed_result(uuid, uuid, text, text)
to service_role;

comment on function public.reconcile_local_publish_observed_result(uuid, uuid, text, text)
is 'Reconciles one submitted unknown local Naver action only from an authenticated observed result URL without resubmitting.';

do $$
declare
  matching_count integer;
  matched_workspace_id uuid;
  matched_action_id uuid;
begin
  select count(*)::integer, min(workspace_id::text)::uuid, min(id::text)::uuid
  into matching_count, matched_workspace_id, matched_action_id
  from public.external_action_requests
  where channel = 'naver_blog'
    and target_external_id = 'findk3'
    and status = 'unknown_result'
    and failure_code = 'UNKNOWN_RESULT'
    and approval_fingerprint = 'c4c719ac8348e3757abfcd2e093855e07c9cde21be74918a5ce54b0716c67343';

  if matching_count > 1 then
    raise exception 'multiple matching observed Naver actions require manual reconciliation';
  end if;
  if matching_count = 1 and not public.reconcile_local_publish_observed_result(
    matched_workspace_id,
    matched_action_id,
    'https://blog.naver.com/PostView.naver?blogId=findk3&logNo=224384788447',
    '224384788447'
  ) then
    raise exception 'observed Naver action reconciliation failed';
  end if;
end;
$$;
