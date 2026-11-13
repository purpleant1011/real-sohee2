create or replace function public.list_channel_interactions(p_workspace_id uuid)
returns table (
  event_id uuid,
  provider text,
  category text,
  occurred_at timestamptz,
  inbound_text text,
  response_job_id uuid,
  response_kind text,
  response_text text,
  response_status text,
  response_approved_at timestamptz,
  response_provider_reference text,
  delivery_status text,
  delivery_error_code text,
  content_id uuid,
  content_version_id uuid,
  content_title text,
  schedule_id uuid,
  publish_at timestamptz,
  schedule_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.has_workspace_role(p_workspace_id, array['owner', 'manager']::text[])) then
    raise exception '채널 대화를 볼 권한이 없습니다.';
  end if;
  return query
  select
    event.id,
    event.provider,
    event.category,
    event.occurred_at,
    event.payload ->> 'text',
    response.id,
    response.response_kind,
    response.draft_text,
    response.status,
    response.approved_at,
    response.provider_reference,
    delivery.status,
    delivery.error_code,
    schedule.content_id,
    schedule.version_id,
    content.title,
    schedule.id,
    schedule.publish_at,
    schedule.status
  from public.provider_webhook_events as event
  left join public.channel_response_jobs as response
    on response.workspace_id = event.workspace_id
   and response.inbound_event_id = event.id
  left join lateral (
    select attempt.status, attempt.error_code
    from public.channel_delivery_attempts as attempt
    where attempt.workspace_id = response.workspace_id
      and attempt.response_job_id = response.id
    order by attempt.attempt_number desc
    limit 1
  ) as delivery on true
  left join lateral (
    select candidate_schedule.*
    from public.publish_attempts as publish_attempt
    join public.schedules as candidate_schedule
      on candidate_schedule.workspace_id = publish_attempt.workspace_id
     and candidate_schedule.id = publish_attempt.schedule_id
    where publish_attempt.workspace_id = event.workspace_id
      and publish_attempt.status = 'succeeded'
      and publish_attempt.provider_reference = event.provider_post_reference
    order by publish_attempt.finished_at desc nulls last
    limit 1
  ) as schedule on true
  left join public.content_items as content
    on content.workspace_id = schedule.workspace_id
   and content.id = schedule.content_id
  where event.workspace_id = p_workspace_id
  order by event.occurred_at desc, event.id desc
  limit 100;
end;
$$;

revoke all on function public.list_channel_interactions(uuid) from public, anon;
grant execute on function public.list_channel_interactions(uuid) to authenticated;
