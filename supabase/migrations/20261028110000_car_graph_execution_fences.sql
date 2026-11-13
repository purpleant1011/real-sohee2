-- CAR-04/05/06: reuse the canonical job owner and 15-minute heartbeat boundary.
-- No takeover of an expired running dispatch: its result requires reconciliation.
-- Rollback: revoke/drop the two execution RPCs, then the approval-fence helper.
-- No table or data rewrite is needed.
create or replace function public.car_graph_approval_fence(p_workspace_id uuid, p_run_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
    'leaseExpired', a.expires_at is not null and a.expires_at <= clock_timestamp()
  ) order by a.id), '[]'::jsonb)
  from public.agent_approvals a
  where a.workspace_id = p_workspace_id and (
    a.action_run_id = p_run_id or a.proposed_value->>'action_run_id' = p_run_id::text
  );
$$;

create or replace function public.car_claim_graph_execution(
  p_workspace_id uuid, p_run_id uuid, p_worker_id uuid, p_checkpoint_at text,
  p_expected_plan jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.conversation_jobs%rowtype;
  v_approvals jsonb;
begin
  select * into v_job from public.conversation_jobs
    where id = p_run_id and workspace_id = p_workspace_id for update;
  if v_job.id is null or v_job.status <> 'running' or v_job.cancel_requested_at is not null
    or p_worker_id is null then return null; end if;
  if v_job.worker_id is not null then
    if v_job.heartbeat_at is null or v_job.heartbeat_at < clock_timestamp() - interval '15 minutes' then
      update public.conversation_jobs set status = 'needs_attention',
        safe_error_code = 'PROVIDER_RESULT_UNKNOWN', completed_at = clock_timestamp()
        where id = v_job.id;
    end if;
    return null;
  end if;
  if (v_job.plan_data->>'checkpointAt') is distinct from p_checkpoint_at
    or v_job.plan_data is distinct from p_expected_plan then return null; end if;
  v_approvals := public.car_graph_approval_fence(p_workspace_id, p_run_id);
  if exists (select 1 from jsonb_array_elements(v_approvals) a
    where a->>'status' in ('REJECTED', 'EXPIRED') or (a->>'leaseExpired')::boolean)
    then return null; end if;
  update public.conversation_jobs set worker_id = p_worker_id,
    heartbeat_at = clock_timestamp(), attempt_count = attempt_count + 1 where id = v_job.id;
  return jsonb_build_object('planFence', jsonb_build_object(
    'planData', v_job.plan_data, 'approvals', v_approvals
  ));
end;
$$;

create or replace function public.car_checkpoint_graph_execution(
  p_workspace_id uuid, p_run_id uuid, p_worker_id uuid, p_plan_fence jsonb,
  p_graph jsonb, p_steps jsonb default '[]'::jsonb, p_checkpoint_at text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.conversation_jobs%rowtype;
  v_plan jsonb;
  v_step jsonb;
  v_approvals jsonb;
begin
  select * into v_job from public.conversation_jobs
    where id = p_run_id and workspace_id = p_workspace_id for update;
  if v_job.id is null or v_job.status <> 'running' or v_job.cancel_requested_at is not null
    or p_graph->>'runId' is distinct from p_run_id::text
    or p_graph->>'workspaceId' is distinct from p_workspace_id::text then return null; end if;
  v_approvals := public.car_graph_approval_fence(p_workspace_id, p_run_id);
  if p_worker_id is null then
    if v_job.worker_id is not null or (v_job.plan_data->>'checkpointAt') is distinct from p_checkpoint_at
      or (v_job.plan_data ? 'actionGraph' and v_job.plan_data is distinct from p_plan_fence->'planData')
      then return null; end if;
  elsif v_job.worker_id is distinct from p_worker_id
    or v_job.heartbeat_at is null or v_job.heartbeat_at < clock_timestamp() - interval '15 minutes'
    or v_job.plan_data is distinct from p_plan_fence->'planData'
    or v_approvals is distinct from p_plan_fence->'approvals'
    then return null;
  end if;
  v_plan := v_job.plan_data || jsonb_build_object('actionGraph', p_graph, 'checkpointAt', p_graph->>'checkpointAt');
  update public.conversation_jobs set plan_data = v_plan, updated_at = clock_timestamp(),
    heartbeat_at = clock_timestamp(),
    worker_id = case when p_graph->>'status' in ('COMPLETED', 'FAILED', 'BLOCKED') then null else worker_id end
    where id = v_job.id;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    if v_step->>'workspace_id' is distinct from p_workspace_id::text
      or v_step->>'job_id' is distinct from p_run_id::text then
      raise exception 'GRAPH_STEP_SCOPE_MISMATCH' using errcode = '22023';
    end if;
    insert into public.conversation_job_steps (
      workspace_id, job_id, provider_call_key, step_index, capability_id, risk_tier,
      state, status, input_payload, output_payload, idempotency_key,
      external_receipt_id, safe_error_code, error, completed_at
    ) values (
      p_workspace_id, p_run_id, v_step->>'provider_call_key', (v_step->>'step_index')::integer,
      v_step->>'capability_id', v_step->>'risk_tier', v_step->>'state', v_step->>'status',
      v_step->'input_payload', v_step->'output_payload', v_step->>'idempotency_key',
      (v_step->>'external_receipt_id')::uuid, v_step->>'safe_error_code', v_step->>'error',
      (v_step->>'completed_at')::timestamptz
    ) on conflict (job_id, provider_call_key) do update set
      state = excluded.state, status = excluded.status, input_payload = excluded.input_payload,
      output_payload = excluded.output_payload, idempotency_key = excluded.idempotency_key,
      external_receipt_id = excluded.external_receipt_id, safe_error_code = excluded.safe_error_code,
      error = excluded.error, completed_at = excluded.completed_at;
  end loop;
  return jsonb_build_object('planFence', jsonb_build_object(
    'planData', v_plan, 'approvals', v_approvals
  ));
end;
$$;

revoke all on function public.car_graph_approval_fence(uuid, uuid) from public, anon, authenticated;
grant execute on function public.car_graph_approval_fence(uuid, uuid) to service_role;
revoke all on function public.car_claim_graph_execution(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.car_checkpoint_graph_execution(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.car_claim_graph_execution(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.car_checkpoint_graph_execution(uuid, uuid, uuid, jsonb, jsonb, jsonb, text) to service_role;
