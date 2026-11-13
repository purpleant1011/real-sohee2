create function public.retry_local_publish_before_submit(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_action_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request public.external_action_requests%rowtype;
  retry_status text;
begin
  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'manager')
  ) then return false; end if;

  select candidate.* into request
  from public.external_action_requests as candidate
  join public.content_versions as version
    on version.workspace_id = candidate.workspace_id
   and version.id = candidate.content_version_id
  join public.content_items as content
    on content.workspace_id = version.workspace_id
   and content.id = version.content_id
   and content.current_version_id = version.id
  join public.approvals as approval
    on approval.workspace_id = candidate.workspace_id
   and approval.id = candidate.approval_id
   and approval.version_id = version.id
   and approval.status = 'approved'
   and approval.fingerprint = version.fingerprint
   and approval.fingerprint = candidate.approval_fingerprint
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_action_id
    and candidate.channel = 'naver_blog'
    and candidate.status = 'failed'
    and candidate.failure_code = 'UI_DRIFT'
  for update of candidate;

  if not found then return false; end if;

  if exists (
    select 1 from public.external_action_receipts as receipt
    where receipt.workspace_id = p_workspace_id
      and receipt.action_request_id = p_action_id
  ) then return false; end if;

  if not exists (
    select 1
    from public.external_action_attempts as attempt
    join private.local_publish_leases as lease
      on lease.workspace_id = attempt.workspace_id
     and lease.attempt_id = attempt.id
     and lease.action_request_id = attempt.action_request_id
    where attempt.workspace_id = p_workspace_id
      and attempt.action_request_id = p_action_id
      and attempt.status = 'failed'
      and attempt.failure_code = 'UI_DRIFT'
      and attempt.provider_request_id is null
      and attempt.provider_reference is null
      and lease.status = 'released'
      and lease.current_phase = 'failed_before_submit'
      and lease.submit_permit_digest is null
      and lease.submit_permit_issued_at is null
      and not exists (
        select 1 from private.local_publish_leases as later
        where later.workspace_id = lease.workspace_id
          and later.action_request_id = lease.action_request_id
          and later.created_at > lease.created_at
      )
  ) then return false; end if;

  retry_status := case
    when request.scheduled_at is null then 'ready'
    when statement_timestamp() < request.scheduled_at then 'prepared'
    when statement_timestamp() <= request.auto_execute_until then 'ready'
    else 'reconfirmation_required'
  end;

  update public.external_action_requests
  set status = retry_status,
      failure_code = case when retry_status = 'reconfirmation_required' then 'DEADLINE_EXPIRED' else null end,
      claimed_by = null,
      claimed_at = null,
      updated_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = p_action_id;

  return true;
end;
$$;

revoke all on function public.retry_local_publish_before_submit(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.retry_local_publish_before_submit(uuid, uuid, uuid)
to service_role;

comment on function public.retry_local_publish_before_submit(uuid, uuid, uuid)
is 'Retries only the current exact approved Naver version after a proven UI failure before any submit permit or receipt.';
