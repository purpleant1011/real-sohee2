create or replace function private.refund_interview_estimated_usage()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  with candidates as (
    select
      job.id as job_id,
      job.workspace_id,
      reservation.account_id,
      sum(usage.computed_credits)::integer as refund_credits
    from public.conversation_jobs job
    join public.messages assistant
      on assistant.id = job.assistant_message_id
     and assistant.workspace_id = job.workspace_id
    join public.credit_reservations reservation
      on reservation.id = job.reservation_id
     and reservation.workspace_id = job.workspace_id
    join public.ai_usage_events usage
      on usage.job_id = job.id
     and usage.workspace_id = job.workspace_id
    where job.status = 'succeeded'
      and assistant.status = 'completed'
      and assistant.usage_metadata -> 'soheeConversationInterview' ->> 'status'
        in ('collecting', 'ready_to_generate')
      and reservation.state = 'settled'
      and not exists (
        select 1
        from public.message_artifacts artifact
        where artifact.workspace_id = job.workspace_id
          and artifact.message_id = job.assistant_message_id
      )
    group by job.id, job.workspace_id, reservation.account_id
    having bool_and(usage.usage_source = 'estimated_missing_usage')
      and sum(usage.computed_credits) > 0
  ), inserted as (
    insert into public.credit_ledger_entries (
      workspace_id, account_id, reservation_id, kind, action, amount,
      idempotency_key, occurred_at
    )
    select
      candidate.workspace_id,
      candidate.account_id,
      null,
      'adjustment',
      null,
      candidate.refund_credits,
      'v08-interview-estimate-refund:' || candidate.job_id::text,
      statement_timestamp()
    from candidates candidate
    on conflict (workspace_id, idempotency_key, kind) do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function private.refund_interview_estimated_usage()
from public, anon, authenticated;
grant execute on function private.refund_interview_estimated_usage() to service_role;

select private.refund_interview_estimated_usage();
