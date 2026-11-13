create or replace function private.restore_ready_conversation_job_result(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.conversation_jobs%rowtype;
  reservation public.credit_reservations%rowtype;
  recorded_credits integer := 0;
  credits_to_settle integer := 0;
  credits_to_release integer := 0;
begin
  select candidate.* into job
  from public.conversation_jobs as candidate
  where candidate.id = p_job_id
    and candidate.status = 'needs_attention'
    and candidate.attention_resolved_at is null
  for update;

  if job.id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.message_artifacts as link
    join public.conversation_artifacts as artifact
      on artifact.workspace_id = link.workspace_id
     and artifact.id = link.artifact_id
    where link.workspace_id = job.workspace_id
      and link.message_id = job.assistant_message_id
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.message_artifacts as link
    join public.conversation_artifacts as artifact
      on artifact.workspace_id = link.workspace_id
     and artifact.id = link.artifact_id
    where link.workspace_id = job.workspace_id
      and link.message_id = job.assistant_message_id
      and artifact.status <> 'ready_for_review'
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.message_artifacts as link
    join public.conversation_artifacts as artifact
      on artifact.workspace_id = link.workspace_id
     and artifact.id = link.artifact_id
    where link.workspace_id = job.workspace_id
      and link.message_id = job.assistant_message_id
      and (
        not exists (
          select 1
          from public.artifact_slides as slide
          where slide.workspace_id = artifact.workspace_id
            and slide.artifact_id = artifact.id
        )
        or exists (
          select 1
          from public.artifact_slides as slide
          where slide.workspace_id = artifact.workspace_id
            and slide.artifact_id = artifact.id
            and (slide.status <> 'succeeded' or slide.media_asset_id is null)
        )
      )
  ) then
    return false;
  end if;

  select candidate.* into reservation
  from public.credit_reservations as candidate
  where candidate.id = job.reservation_id
    and candidate.workspace_id = job.workspace_id
  for update;

  if reservation.id is not null then
    select coalesce(sum(usage.computed_credits), 0)::integer into recorded_credits
    from public.ai_usage_events as usage
    where usage.workspace_id = job.workspace_id
      and usage.job_id = job.id;

    credits_to_settle := least(
      greatest(recorded_credits - reservation.settled_credits, 0),
      greatest(
        reservation.requested_credits
          - reservation.settled_credits
          - reservation.released_credits,
        0
      )
    );

    if credits_to_settle > 0 then
      perform public.settle_credit_reservation(
        job.workspace_id,
        reservation.id,
        credits_to_settle,
        job.id::text || ':restored-result-settle'
      );
    end if;

    select candidate.* into reservation
    from public.credit_reservations as candidate
    where candidate.id = job.reservation_id
      and candidate.workspace_id = job.workspace_id
    for update;

    credits_to_release := greatest(
      reservation.requested_credits
        - reservation.settled_credits
        - reservation.released_credits,
      0
    );

    if credits_to_release > 0 then
      perform public.release_credit_reservation(
        job.workspace_id,
        reservation.id,
        credits_to_release,
        job.id::text || ':restored-result-release'
      );
    end if;
  end if;

  update public.messages
  set status = 'completed', completed_at = coalesce(completed_at, statement_timestamp())
  where workspace_id = job.workspace_id
    and thread_id = job.thread_id
    and id = job.assistant_message_id
    and status = 'failed';

  update public.conversation_jobs
  set attention_resolved_at = statement_timestamp(),
      attention_resolution = 'result_restored'
  where id = job.id
    and workspace_id = job.workspace_id
    and status = 'needs_attention'
    and attention_resolved_at is null;

  return found;
end;
$$;

create or replace function private.restore_ready_conversation_job_result_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'needs_attention'
    and new.attention_resolved_at is null
  then
    perform private.restore_ready_conversation_job_result(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists restore_ready_conversation_job_result_after_attention
on public.conversation_jobs;

create trigger restore_ready_conversation_job_result_after_attention
after update of status on public.conversation_jobs
for each row
when (new.status = 'needs_attention')
execute function private.restore_ready_conversation_job_result_trigger();

create or replace function private.restore_ready_conversation_job_results()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  restored_count integer := 0;
begin
  for candidate in
    select job.id
    from public.conversation_jobs as job
    where job.status = 'needs_attention'
      and job.attention_resolved_at is null
    order by job.completed_at, job.id
  loop
    if private.restore_ready_conversation_job_result(candidate.id) then
      restored_count := restored_count + 1;
    end if;
  end loop;
  return restored_count;
end;
$$;

revoke all on function private.restore_ready_conversation_job_result(uuid) from public, anon, authenticated;
revoke all on function private.restore_ready_conversation_job_result_trigger() from public, anon, authenticated;
revoke all on function private.restore_ready_conversation_job_results() from public, anon, authenticated;

select private.restore_ready_conversation_job_results();
