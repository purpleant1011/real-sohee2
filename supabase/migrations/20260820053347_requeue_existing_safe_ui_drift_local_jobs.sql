update public.external_action_requests as request
set status = 'ready',
    failure_code = null,
    claimed_by = null,
    claimed_at = null,
    updated_at = statement_timestamp()
where request.status = 'failed'
  and request.failure_code = 'UI_DRIFT'
  and request.channel in ('naver_blog', 'daangn_business')
  and exists (
    select 1
    from private.local_publish_leases as lease
    where lease.workspace_id = request.workspace_id
      and lease.action_request_id = request.id
      and lease.status = 'released'
      and lease.current_phase = 'failed_before_submit'
      and lease.submit_permit_digest is null
      and lease.submit_permit_issued_at is null
      and not exists (
        select 1
        from private.local_publish_leases as later
        where later.workspace_id = lease.workspace_id
          and later.action_request_id = lease.action_request_id
          and later.created_at > lease.created_at
      )
  );
