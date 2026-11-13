create function public.recover_expired_local_publish_before_submit(
  p_workspace_id uuid,
  p_device_id uuid,
  p_action_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lease private.local_publish_leases%rowtype;
  recovered_status text;
begin
  select candidate.* into lease
  from private.local_publish_leases as candidate
  join public.external_action_requests as request
    on request.workspace_id = candidate.workspace_id
   and request.id = candidate.action_request_id
   and request.status = 'executing'
  where candidate.workspace_id = p_workspace_id
    and candidate.device_id = p_device_id
    and candidate.action_request_id = p_action_id
    and candidate.status = 'active'
    and candidate.current_phase in (
      'claimed', 'account_verified', 'editor_ready', 'content_filled', 'preflight_verified'
    )
    and candidate.submit_permit_digest is null
    and candidate.submit_permit_issued_at is null
    and candidate.expires_at < statement_timestamp()
  order by candidate.created_at desc
  limit 1
  for update of candidate;

  if not found then return false; end if;

  select case
    when request.scheduled_at is null then 'ready'
    when statement_timestamp() < request.scheduled_at then 'prepared'
    when statement_timestamp() <= request.auto_execute_until then 'ready'
    else 'reconfirmation_required'
  end into recovered_status
  from public.external_action_requests as request
  where request.workspace_id = p_workspace_id
    and request.id = p_action_id;

  update private.local_publish_leases
  set status = 'released',
      current_phase = 'device_offline',
      updated_at = statement_timestamp()
  where id = lease.id;

  update public.external_action_attempts
  set status = 'failed',
      failure_code = 'DEVICE_OFFLINE',
      finished_at = statement_timestamp()
  where workspace_id = p_workspace_id
    and id = lease.attempt_id
    and status = 'claimed';

  update public.external_action_requests
  set status = recovered_status,
      failure_code = case when recovered_status = 'reconfirmation_required' then 'DEADLINE_EXPIRED' else null end,
      claimed_by = null,
      claimed_at = null,
      updated_at = statement_timestamp()
  where workspace_id = p_workspace_id
    and id = p_action_id
    and status = 'executing';

  return found;
end;
$$;

revoke all on function public.recover_expired_local_publish_before_submit(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.recover_expired_local_publish_before_submit(uuid, uuid, uuid)
to service_role;

comment on function public.recover_expired_local_publish_before_submit(uuid, uuid, uuid)
is 'Releases only an expired local connector lease that never received a submit permit, preserving the original exact-version request for a guarded retry.';
