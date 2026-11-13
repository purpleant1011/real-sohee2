-- Additive authenticated read facade: credit ledger RPC stays service-only.
-- Keep v1 intact for rollback. No historical rows or migration records are rewritten.
create or replace function public.get_conversation_work_status_v2(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'CONVERSATION_WORK_STATUS_FORBIDDEN' using errcode = '42501';
  end if;

  v_balance := public.get_workspace_credit_balance(p_workspace_id);
  return jsonb_build_object(
    'activeJobCount', (
      select count(*) from public.conversation_jobs
      where workspace_id = p_workspace_id and status in ('queued', 'running', 'cancel_requested')
    ),
    'attentionThreadCount', (
      select count(distinct thread_id) from public.conversation_jobs
      where workspace_id = p_workspace_id and status = 'needs_attention' and attention_resolved_at is null
    ),
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'threadId', thread.id,
        'displayStatus', case
          when thread.status = 'archived' then 'archived'
          when exists (select 1 from public.conversation_jobs active where active.workspace_id = p_workspace_id and active.thread_id = thread.id and active.status in ('queued', 'running', 'cancel_requested')) then 'working'
          when exists (select 1 from public.conversation_jobs attention where attention.workspace_id = p_workspace_id and attention.thread_id = thread.id and attention.status = 'needs_attention' and attention.attention_resolved_at is null) then 'attention'
          else 'idle'
        end,
        'activeJobCount', (select count(*) from public.conversation_jobs active where active.workspace_id = p_workspace_id and active.thread_id = thread.id and active.status in ('queued', 'running', 'cancel_requested')),
        'latestJobUpdatedAt', (select max(coalesce(job.heartbeat_at, job.completed_at, job.queued_at)) from public.conversation_jobs job where job.workspace_id = p_workspace_id and job.thread_id = thread.id)
      ) order by thread.last_message_at desc nulls last, thread.created_at desc)
      from public.conversation_threads thread where thread.workspace_id = p_workspace_id
    ), '[]'::jsonb),
    'creditBalance', v_balance,
    'observedAt', statement_timestamp()
  );
end;
$$;

revoke all on function public.get_conversation_work_status_v2(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_conversation_work_status_v2(uuid) to authenticated, service_role;
