create or replace function public.release_unstarted_conversation_job_credit(
  p_job_id uuid,
  p_worker_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
  v_reservation public.credit_reservations%rowtype;
  v_remaining integer;
begin
  if p_reason !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'CONVERSATION_JOB_RELEASE_REASON_INVALID' using errcode = '22023';
  end if;

  select * into v_job from public.conversation_jobs
  where id = p_job_id
    and worker_id = p_worker_id
    and status in ('running', 'cancel_requested')
  for update;
  if v_job.id is null then return false; end if;

  select * into v_reservation from public.credit_reservations
  where id = v_job.reservation_id and workspace_id = v_job.workspace_id
  for update;
  if v_reservation.id is null then return false; end if;

  v_remaining := v_reservation.requested_credits
    - v_reservation.settled_credits
    - v_reservation.released_credits;
  if v_remaining > 0 then
    perform public.release_credit_reservation(
      v_job.workspace_id,
      v_reservation.id,
      v_remaining,
      v_job.id::text || ':unstarted-provider-release'
    );
  end if;
  return true;
end;
$$;

revoke all on function public.release_unstarted_conversation_job_credit(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.release_unstarted_conversation_job_credit(uuid, uuid, text)
to service_role;
