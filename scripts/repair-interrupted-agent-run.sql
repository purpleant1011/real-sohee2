-- Operator-only repair for a CONFIRMED stopped, pre-intake chat executor.
-- Not a migration, watchdog, retry, credit settlement, or execution resume.
-- Use psql -X -v workspace_id=... -v run_id=... -v expected_updated_at=...
--   -v executor_stopped=confirmed -f scripts/repair-interrupted-agent-run.sql
-- Default: ROLLBACK. Only an explicitly approved -v apply=true commits.
-- Never infer executor termination merely from age or zero ledger rows.
\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
select set_config('sohee.repair_workspace', :'workspace_id', true) as repair_workspace,
  set_config('sohee.repair_run', :'run_id', true) as repair_run,
  set_config('sohee.repair_snapshot', :'expected_updated_at', true) as repair_snapshot,
  set_config('sohee.repair_executor_stopped', :'executor_stopped', true) as repair_executor_stopped
\gset

do $$
declare
  job public.conversation_jobs%rowtype;
  target uuid := current_setting('sohee.repair_run')::uuid;
  workspace uuid := current_setting('sohee.repair_workspace')::uuid;
begin
  if current_setting('sohee.repair_executor_stopped') <> 'confirmed' then
    raise exception 'AGENT_REPAIR_BLOCKED: executor termination not confirmed';
  end if;
  -- Same lock order as append_agent_activity. Row lock also serializes status writers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text, 1887));
  select * into job from public.conversation_jobs
    where id=target and workspace_id=workspace for update;
  if not found then raise exception 'AGENT_REPAIR_BLOCKED: scoped run unavailable'; end if;

  -- An exact repeat never changes timestamps or turns this into a retry.
  if job.status='needs_attention' and job.safe_error_code='AGENT_INTAKE_INTERRUPTED'
    and job.completed_at is not null then return; end if;

  if job.status <> 'running' or job.kind <> 'chat'
    or job.updated_at is distinct from current_setting('sohee.repair_snapshot')::timestamptz
    or job.updated_at is null or job.updated_at > now() - interval '15 minutes'
    or job.queued_at is null or job.queued_at > now() - interval '15 minutes'
    or job.heartbeat_at is not null or job.started_at is not null or job.completed_at is not null
    or job.assistant_message_id is not null or job.worker_id is not null
    or job.reservation_id is not null or job.queue_dispatched_at is not null
    or job.attempt_count is distinct from 0 or job.safe_error_code is not null
    or exists(select 1 from public.conversation_job_steps where job_id=target)
    or exists(select 1 from public.agent_activity_events where run_id=target)
  then
    raise exception 'AGENT_REPAIR_BLOCKED: snapshot or pre-intake invariants changed';
  end if;

  update public.conversation_jobs
    set status='needs_attention', safe_error_code='AGENT_INTAKE_INTERRUPTED',
      completed_at=now(), updated_at=now()
    where id=target and workspace_id=workspace and status='running';
end $$;

-- Minimal readback: no prompts, plan data, customer information or tool arguments.
select status, safe_error_code, completed_at is not null as terminal
  from public.conversation_jobs
  where id=:'run_id'::uuid and workspace_id=:'workspace_id'::uuid;
\if :apply
  commit;
\else
  rollback;
\endif
