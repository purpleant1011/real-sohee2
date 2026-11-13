create or replace function public.complete_local_publish_job(
  p_workspace_id uuid,
  p_device_id uuid,
  p_action_id uuid,
  p_lease_id uuid,
  p_status text,
  p_provider_reference text,
  p_result_url text,
  p_failure_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lease private.local_publish_leases%rowtype;
  recorded_by_user uuid;
  current_attempt_number integer;
  retry_status text;
  auto_requeue boolean := false;
begin
  if p_status not in ('succeeded', 'failed_before_submit', 'unknown_after_submit') then return false; end if;
  if p_status = 'succeeded' and (p_result_url is null or char_length(p_result_url) > 2048) then return false; end if;
  if p_status = 'failed_before_submit' and p_failure_code is null then return false; end if;

  select candidate.* into lease
  from private.local_publish_leases as candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.device_id = p_device_id
    and candidate.action_request_id = p_action_id
    and candidate.id = p_lease_id
  for update;

  if not found or lease.status in ('completed', 'released') then return false; end if;
  if p_status in ('succeeded', 'unknown_after_submit') and lease.status <> 'submitted' then return false; end if;
  if p_status = 'failed_before_submit' and (
    lease.status <> 'active'
    or lease.submit_permit_digest is not null
    or lease.submit_permit_issued_at is not null
    or p_provider_reference is not null
    or p_result_url is not null
  ) then return false; end if;

  select attempt.attempt_number into current_attempt_number
  from public.external_action_attempts as attempt
  where attempt.workspace_id = p_workspace_id
    and attempt.id = lease.attempt_id;

  select device.created_by into recorded_by_user
  from public.connector_devices as device
  where device.workspace_id = p_workspace_id
    and device.id = lease.device_id;

  auto_requeue := p_status = 'failed_before_submit'
    and p_failure_code = 'DEVICE_OFFLINE'
    and coalesce(current_attempt_number, 3) < 3
    and not exists (
      select 1
      from public.external_action_receipts as receipt
      where receipt.workspace_id = p_workspace_id
        and receipt.action_request_id = lease.action_request_id
    );

  if auto_requeue then
    select case
      when request.scheduled_at is null then 'ready'
      when statement_timestamp() < request.scheduled_at then 'prepared'
      when statement_timestamp() <= request.auto_execute_until then 'ready'
      else 'reconfirmation_required'
    end into retry_status
    from public.external_action_requests as request
    where request.workspace_id = p_workspace_id
      and request.id = lease.action_request_id;
  end if;

  update public.external_action_requests
  set status = case
        when auto_requeue then retry_status
        when p_status = 'succeeded' then 'succeeded'
        when p_status = 'unknown_after_submit' then 'unknown_result'
        else 'failed'
      end,
      failure_code = case
        when auto_requeue and retry_status = 'reconfirmation_required' then 'DEADLINE_EXPIRED'
        when auto_requeue then null
        when p_status = 'unknown_after_submit' then 'UNKNOWN_RESULT'
        else p_failure_code
      end,
      claimed_by = case when auto_requeue then null else claimed_by end,
      claimed_at = case when auto_requeue then null else claimed_at end,
      updated_at = statement_timestamp()
  where workspace_id = p_workspace_id
    and id = lease.action_request_id;

  update public.external_action_attempts
  set status = case
        when p_status = 'succeeded' then 'succeeded'
        when p_status = 'unknown_after_submit' then 'unknown_result'
        else 'failed'
      end,
      failure_code = case when p_status = 'unknown_after_submit' then 'UNKNOWN_RESULT' else p_failure_code end,
      provider_reference = p_provider_reference,
      finished_at = statement_timestamp()
  where workspace_id = p_workspace_id
    and id = lease.attempt_id;

  if p_status = 'succeeded' then
    insert into public.external_action_receipts (
      workspace_id, action_request_id, attempt_id, receipt_kind,
      provider_reference, result_url, recorded_by
    ) values (
      p_workspace_id, lease.action_request_id, lease.attempt_id, 'observed_result',
      p_provider_reference, p_result_url, recorded_by_user
    );
  end if;

  update private.local_publish_leases
  set status = case
        when p_status = 'failed_before_submit' then 'released'
        when p_status = 'unknown_after_submit' then 'submitted'
        else 'completed'
      end,
      current_phase = p_status,
      updated_at = statement_timestamp()
  where id = p_lease_id;

  return true;
end;
$$;

revoke all on function public.complete_local_publish_job(uuid, uuid, uuid, uuid, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.complete_local_publish_job(uuid, uuid, uuid, uuid, text, text, text, text)
to service_role;

comment on function public.complete_local_publish_job(uuid, uuid, uuid, uuid, text, text, text, text)
is 'Completes a local publish attempt and automatically requeues only bounded DEVICE_OFFLINE failures proven to be before any submit permit or receipt.';
