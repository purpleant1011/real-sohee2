create function public.recover_expired_local_publish_jobs(
  p_workspace_id uuid,
  p_device_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate record;
  recovered_count integer := 0;
begin
  for candidate in
    select lease.action_request_id
    from private.local_publish_leases as lease
    join public.external_action_requests as request
      on request.workspace_id = lease.workspace_id
     and request.id = lease.action_request_id
     and request.status = 'executing'
    where lease.workspace_id = p_workspace_id
      and lease.device_id = p_device_id
      and lease.status = 'active'
      and lease.current_phase in (
        'claimed', 'account_verified', 'editor_ready', 'content_filled', 'preflight_verified'
      )
      and lease.submit_permit_digest is null
      and lease.submit_permit_issued_at is null
      and lease.expires_at < statement_timestamp()
    order by lease.created_at
  loop
    if public.recover_expired_local_publish_before_submit(
      p_workspace_id,
      p_device_id,
      candidate.action_request_id
    ) then
      recovered_count := recovered_count + 1;
    end if;
  end loop;
  return recovered_count;
end;
$$;

revoke all on function public.recover_expired_local_publish_jobs(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.recover_expired_local_publish_jobs(uuid, uuid)
to service_role;

comment on function public.recover_expired_local_publish_jobs(uuid, uuid)
is 'Recovers this connector device expired pre-submit leases before it claims another exact-version job.';
