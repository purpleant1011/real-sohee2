create or replace function public.recover_expired_publish_attempt(
  p_workspace_id uuid,
  p_attempt_id uuid,
  p_user_id uuid,
  p_now timestamptz default statement_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered public.publish_attempts%rowtype;
begin
  if (select auth.uid()) is null
    or (select auth.uid()) <> p_user_id
    or not private.is_workspace_member(p_workspace_id)
  then
    raise exception 'PUBLISH_RECOVERY_FORBIDDEN' using errcode = '42501';
  end if;

  update public.publish_attempts
  set status = 'unknown',
      error_code = 'LEASE_EXPIRED',
      finished_at = p_now,
      lease_expires_at = null,
      recovery_status = 'reconcile_required'
  where workspace_id = p_workspace_id
    and id = p_attempt_id
    and status = 'pending'
    and lease_expires_at < p_now
  returning * into recovered;

  if recovered.id is null then
    raise exception 'PUBLISH_RECOVERY_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  update public.schedules
  set status = 'unknown', updated_at = p_now
  where workspace_id = recovered.workspace_id
    and id = recovered.schedule_id;

  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
  ) values (
    recovered.workspace_id,
    'publish.lease_expired',
    'publish.lease_expired:' || recovered.id::text,
    'publish_attempt',
    recovered.id,
    jsonb_build_object(
      'scheduleId', recovered.schedule_id,
      'recoveryStatus', 'reconcile_required'
    ),
    p_now
  ) on conflict (workspace_id, event_key) do nothing;

  return recovered.id;
end;
$$;

revoke all on function public.recover_expired_publish_attempt(uuid, uuid, uuid, timestamptz)
from public, anon;

grant execute on function public.recover_expired_publish_attempt(uuid, uuid, uuid, timestamptz)
to authenticated, service_role;
