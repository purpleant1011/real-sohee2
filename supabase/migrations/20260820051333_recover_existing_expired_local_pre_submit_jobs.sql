do $$
declare
  candidate record;
begin
  for candidate in
    select lease.workspace_id, lease.device_id, lease.action_request_id
    from private.local_publish_leases as lease
    join public.external_action_requests as request
      on request.workspace_id = lease.workspace_id
     and request.id = lease.action_request_id
     and request.status = 'executing'
    where lease.status = 'active'
      and lease.current_phase in (
        'claimed', 'account_verified', 'editor_ready', 'content_filled', 'preflight_verified'
      )
      and lease.submit_permit_digest is null
      and lease.submit_permit_issued_at is null
      and lease.expires_at < statement_timestamp()
  loop
    perform public.recover_expired_local_publish_before_submit(
      candidate.workspace_id,
      candidate.device_id,
      candidate.action_request_id
    );
  end loop;
end;
$$;
