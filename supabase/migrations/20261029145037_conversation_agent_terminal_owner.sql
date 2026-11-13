-- Stage prepared-agent responses under the current actor/lease. The runner owns terminalization after billing.
create or replace function public.stage_conversation_agent_response(
  p_workspace_id uuid, p_job_id uuid, p_worker_id uuid, p_user_id uuid,
  p_content text, p_successful boolean, p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
  v_message public.messages%rowtype;
  v_marker jsonb;
begin
  if p_content is null or char_length(btrim(p_content)) not between 1 and 20000
    or p_successful is null
    or (p_error_code is not null and char_length(p_error_code) not between 1 and 120)
  then
    raise exception 'CONVERSATION_RESPONSE_INVALID' using errcode = '22023';
  end if;

  perform 1 from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id
    and status = 'active' and role in ('owner', 'manager', 'reviewer')
  for share;
  if not found then
    raise exception 'CONVERSATION_AUTHORITY_LOST' using errcode = '42501';
  end if;
  perform 1 from public.conversation_threads
  where workspace_id = p_workspace_id and status = 'active'
    and id = (select thread_id from public.conversation_jobs where id = p_job_id and workspace_id = p_workspace_id)
  for share;
  if not found then
    raise exception 'CONVERSATION_AUTHORITY_LOST' using errcode = '42501';
  end if;

  select job.* into v_job from public.conversation_jobs job
  where job.id = p_job_id and job.workspace_id = p_workspace_id
    and job.worker_id = p_worker_id and job.status = 'running'
    and exists (select 1 from public.messages message
      where message.id = job.user_message_id and message.workspace_id = p_workspace_id
        and message.created_by_user_id = p_user_id)
  for update;
  if not found then
    raise exception 'CONVERSATION_AUTHORITY_LOST' using errcode = '42501';
  end if;

  select * into v_message from public.messages
  where workspace_id = p_workspace_id and id = v_job.assistant_message_id and role = 'sohee'
  for update;
  if not found or v_message.status not in ('queued', 'streaming') then
    raise exception 'CONVERSATION_RESPONSE_UNAVAILABLE' using errcode = '22023';
  end if;
  v_marker := jsonb_build_object('successful', p_successful, 'errorCode', p_error_code);
  if v_job.plan_data ? 'preparedAgentResponse' then
    if v_job.plan_data->'preparedAgentResponse' is distinct from v_marker
      or v_message.content is distinct from btrim(p_content)
    then
      raise exception 'CONVERSATION_RESPONSE_CONFLICT' using errcode = '23505';
    end if;
    return true;
  end if;

  update public.messages set content = btrim(p_content), status = 'streaming',
    error_code = p_error_code, completed_at = null
  where id = v_message.id and workspace_id = p_workspace_id;
  update public.conversation_jobs
  set plan_data = plan_data || jsonb_build_object('preparedAgentResponse', v_marker),
      heartbeat_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = v_job.id;
  return true;
end;
$$;

create or replace function public.complete_conversation_job_v2(
  p_job_id uuid, p_worker_id uuid, p_status text, p_safe_error_code text, p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.conversation_jobs%rowtype;
begin
  if p_status is null or p_status not in ('succeeded', 'needs_attention', 'cancelled') or p_now is null then
    raise exception 'CONVERSATION_JOB_STATUS_INVALID' using errcode = '22023';
  end if;
  select * into v_job from public.conversation_jobs where id = p_job_id for update;
  if not found or p_worker_id is null or v_job.worker_id is distinct from p_worker_id then
    raise exception 'CONVERSATION_AUTHORITY_LOST' using errcode = '42501';
  end if;
  if v_job.status in ('succeeded', 'needs_attention', 'cancelled') then
    if v_job.status = p_status and v_job.safe_error_code is not distinct from p_safe_error_code then
      return jsonb_build_object('job', to_jsonb(v_job));
    end if;
    raise exception 'CONVERSATION_TERMINAL_CONFLICT' using errcode = '23505';
  end if;
  if v_job.status not in ('running', 'cancel_requested') then
    raise exception 'CONVERSATION_AUTHORITY_LOST' using errcode = '42501';
  end if;
  if p_status = 'succeeded' then
    if v_job.status = 'cancel_requested' then
      raise exception 'CONVERSATION_CANCEL_REQUESTED' using errcode = '22023';
    end if;
    if v_job.reservation_id is not null and not exists (
      select 1 from public.credit_reservations
      where id = v_job.reservation_id and workspace_id = v_job.workspace_id and state in ('settled', 'released')
    ) then
      raise exception 'CONVERSATION_CREDITS_UNSETTLED' using errcode = '22023';
    end if;
    if v_job.plan_data ? 'preparedAgentResponse'
      and v_job.plan_data->'preparedAgentResponse'->>'successful' is distinct from 'true'
    then
      raise exception 'CONVERSATION_RESPONSE_CONFLICT' using errcode = '22023';
    end if;
  end if;

  update public.conversation_jobs
  set status = p_status, safe_error_code = p_safe_error_code, completed_at = p_now, heartbeat_at = p_now
  where id = v_job.id returning * into v_job;

  if v_job.plan_data ? 'preparedAgentResponse' or p_status in ('needs_attention', 'cancelled') then
    update public.messages
    set status = case when p_status = 'succeeded' then 'completed' when p_status = 'cancelled' then 'cancelled' else 'failed' end,
        completed_at = p_now,
        content = case when p_status = 'needs_attention' and content = '작업을 준비하고 있습니다.' then '작업 결과를 확인해 주세요.' else content end
    where id = v_job.assistant_message_id and workspace_id = v_job.workspace_id and status in ('queued', 'streaming');
  end if;
  return jsonb_build_object('job', to_jsonb(v_job));
end;
$$;

revoke all on function public.stage_conversation_agent_response(uuid, uuid, uuid, uuid, text, boolean, text)
from public, anon, authenticated;
grant execute on function public.stage_conversation_agent_response(uuid, uuid, uuid, uuid, text, boolean, text)
to service_role;
revoke all on function public.complete_conversation_job_v2(uuid, uuid, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.complete_conversation_job_v2(uuid, uuid, text, text, timestamptz)
to service_role;
