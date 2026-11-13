do $migration$
declare
  recovered integer;
begin
  with safe_attempts as (
    update public.publish_attempts
    set status = 'failed',
      error_code = 'TEMPORARY_NETWORK',
      finished_at = statement_timestamp(),
      lease_expires_at = null,
      recovery_status = 'retry_ready'
    where id in (
      'c7d25f8c-5338-4423-9810-bec4e794b9c5'::uuid,
      '2a23598c-eb30-43a4-b766-38e188cc2f21'::uuid
    )
      and workspace_id = 'fdd5ef41-ab5c-406c-8965-8a2e473d8a2e'::uuid
      and status = 'pending'
      and provider_request_id is null
      and provider_reference is null
    returning workspace_id, schedule_id
  ), updated_schedules as (
    update public.schedules as schedule
    set status = 'failed', updated_at = statement_timestamp()
    from safe_attempts as attempt
    where schedule.workspace_id = attempt.workspace_id
      and schedule.id = attempt.schedule_id
    returning schedule.id
  )
  select count(*)::integer into recovered from updated_schedules;

  -- This migration also runs during a fresh local reset, where the historical
  -- production attempts are intentionally absent. Preserve the strict count
  -- check whenever either target row is present, while allowing a clean no-op.
  if recovered not in (0, 2) then
    raise exception 'BYREUM_SAFE_RECOVERY_COUNT_INVALID: %', recovered;
  end if;
end;
$migration$;
