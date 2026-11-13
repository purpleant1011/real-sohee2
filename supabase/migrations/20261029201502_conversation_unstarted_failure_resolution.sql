-- Known pre-provider read failures have no effect to reconcile and must not wedge later work.
-- Ambiguous outcomes retain needs_attention and their existing reservation/intent fences.
create or replace function public.resolve_unstarted_conversation_job_attention(
  p_workspace_id uuid, p_job_id uuid, p_worker_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
begin
  if p_workspace_id is null or p_job_id is null or p_worker_id is null then return false; end if;
  select * into v_job from public.conversation_jobs
  where id = p_job_id and workspace_id = p_workspace_id and worker_id = p_worker_id
    and status = 'needs_attention'
    and safe_error_code in ('CONVERSATION_CONTEXT_UNAVAILABLE', 'CREDIT_STATE_UNAVAILABLE')
  for update;
  if not found then return false; end if;
  if not exists (select 1 from public.credit_reservations
      where id = v_job.reservation_id and workspace_id = p_workspace_id and state = 'released')
    or exists (select 1 from public.conversation_job_steps where job_id = p_job_id)
    or exists (select 1 from public.ai_usage_events where job_id = p_job_id)
  then return false; end if;
  if v_job.attention_resolved_at is not null then return v_job.attention_resolution = 'ended'; end if;
  update public.conversation_jobs
  set attention_resolved_at = statement_timestamp(), attention_resolution = 'ended'
  where id = p_job_id and workspace_id = p_workspace_id and worker_id = p_worker_id
    and status = 'needs_attention' and attention_resolved_at is null;
  return found;
end;
$$;

revoke all on function public.resolve_unstarted_conversation_job_attention(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.resolve_unstarted_conversation_job_attention(uuid, uuid, uuid) to service_role;

-- Repair only the proven zero-effect failures created before this guard was deployed.
-- No message, usage, billing amount, or execution outcome is rewritten.
do $$
begin
  perform public.resolve_unstarted_conversation_job_attention(job.workspace_id, job.id, job.worker_id)
  from public.conversation_jobs job
  where job.status = 'needs_attention' and job.attention_resolved_at is null and job.worker_id is not null
    and job.safe_error_code in ('CONVERSATION_CONTEXT_UNAVAILABLE', 'CREDIT_STATE_UNAVAILABLE');
end;
$$;
notify pgrst, 'reload schema';
