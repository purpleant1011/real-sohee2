-- ANI-1887: mutable job/step snapshots cannot replay an ordered history.
-- Add only public-safe append-only facts linked to the canonical job. No raw JSON.
-- Deployment is separate; this migration is verified against a disposable local database.
begin;

create table public.agent_activity_events (
  event_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  run_id uuid not null references public.conversation_jobs(id),
  mission_id uuid references public.marketing_missions(id),
  step_id text check (step_id ~ '^[1-9][0-9]{0,8}$'),
  sequence bigint not null check (sequence > 0 and sequence <= 9007199254740991),
  observed_at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in (
    'request_received','planning_summary','tool_read_started','tool_read_failed',
    'capability_checked','approval_needed','result_unknown','partial','blocked',
    'pause_applied','human_handoff','recovered'
  )),
  simulated boolean not null default false,
  dedupe_key text not null check (length(dedupe_key) between 1 and 128),
  unique (run_id, sequence),
  unique (run_id, dedupe_key)
);
create index agent_activity_workspace_run_seq on public.agent_activity_events(workspace_id, run_id, sequence);
alter table public.agent_activity_events enable row level security;
revoke all on public.agent_activity_events from public, anon, authenticated, service_role;
grant select on public.agent_activity_events to authenticated, service_role;
create policy activity_member_read on public.agent_activity_events for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));

create function public.append_agent_activity(
  p_workspace_id uuid, p_run_id uuid, p_step_id text, p_kind text,
  p_dedupe_key text, p_simulated boolean
) returns setof public.agent_activity_events
language plpgsql security definer set search_path = '' as $$
declare
  v_mission_id uuid;
  v_plan jsonb;
  v_thread_id uuid;
  v_bound boolean;
  v_seq bigint;
begin
  -- Serialize writers for this run before checking the idempotency key and sequence.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_run_id::text, 1887));
  select j.plan_data, j.thread_id into v_plan, v_thread_id from public.conversation_jobs j
    where j.id=p_run_id and j.workspace_id=p_workspace_id for share;
  if not found then raise exception 'ACTIVITY_RUN_NOT_FOUND' using errcode='42501'; end if;
  -- A mutable checkpoint is not authoritative for an already-bound mission.
  select e.mission_id into v_mission_id from public.agent_activity_events e
    where e.run_id=p_run_id order by e.sequence limit 1;
  v_bound := found;
  -- Bind the initial run to its resolved session. Later navigation may move that
  -- session to another thread; it must not invalidate an already-running job.
  if nullif(v_plan->>'sessionId','') is not null and not v_bound then
    perform 1 from public.agent_sessions s
      where s.workspace_id=p_workspace_id and s.session_id=v_plan->>'sessionId'
        and s.thread_id=v_thread_id for share;
    if not found then raise exception 'ACTIVITY_SESSION_MISMATCH' using errcode='42501'; end if;
  end if;
  if v_bound then
    if nullif(v_plan->>'missionId','') is not null
      and (v_plan->>'missionId') is distinct from v_mission_id::text then
      raise exception 'ACTIVITY_MISSION_MISMATCH' using errcode='42501';
    end if;
    if v_mission_id is not null then
      perform 1 from public.marketing_missions m
        where m.id=v_mission_id and m.workspace_id=p_workspace_id for share;
      if not found then raise exception 'ACTIVITY_MISSION_MISMATCH' using errcode='42501'; end if;
    end if;
  elsif nullif(v_plan->>'missionId','') is not null then
    select m.id into v_mission_id from public.marketing_missions m
      where m.id::text=v_plan->>'missionId' and m.workspace_id=p_workspace_id for share;
    if not found then raise exception 'ACTIVITY_MISSION_MISMATCH' using errcode='42501'; end if;
  end if;
  if exists(select 1 from public.agent_activity_events e where e.run_id=p_run_id and e.dedupe_key=p_dedupe_key) then
    if not exists(select 1 from public.agent_activity_events e where e.run_id=p_run_id and e.dedupe_key=p_dedupe_key
      and e.kind=p_kind and e.step_id is not distinct from p_step_id and e.simulated=p_simulated) then
      raise exception 'ACTIVITY_IDEMPOTENCY_CONFLICT';
    end if;
    return query select e.* from public.agent_activity_events e where e.run_id=p_run_id and e.dedupe_key=p_dedupe_key;
    return;
  end if;
  select coalesce(max(e.sequence),0)+1 into v_seq from public.agent_activity_events e where e.run_id=p_run_id;
  return query insert into public.agent_activity_events(workspace_id,run_id,mission_id,step_id,sequence,kind,dedupe_key,simulated)
    values(p_workspace_id,p_run_id,v_mission_id,p_step_id,v_seq,p_kind,p_dedupe_key,p_simulated) returning *;
end;
$$;
revoke all on function public.append_agent_activity(uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.append_agent_activity(uuid,uuid,text,text,text,boolean) to service_role;
commit;
