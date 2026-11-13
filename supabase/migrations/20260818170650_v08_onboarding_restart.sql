alter table public.operation_events
  drop constraint operation_events_event_type_check;
alter table public.operation_events
  add constraint operation_events_event_type_check check (
    event_type in (
      'content.plan.created', 'content.version.created', 'content.review.requested',
      'content.approved', 'content.approval.invalidated', 'schedule.suggested',
      'schedule.confirmed', 'publish.succeeded', 'publish.failed', 'publish.unknown',
      'report.snapshot.ready', 'customer.conversation.needs_attention',
      'knowledge.conflict.detected', 'harness.rule.candidate_created',
      'channel.response.created', 'channel.response.approved',
      'channel.response.sent', 'channel.response.failed',
      'channel.connection.connected', 'channel.connection.disconnected',
      'channel.connection.expired', 'channel.webhook.received',
      'publish.claimed', 'publish.lease_expired',
      'onboarding.started', 'onboarding.profile_reviewed',
      'onboarding.completed', 'onboarding.restarted'
    )
  );

alter table public.onboarding_sessions
  add column restart_client_request_id uuid;

create or replace function private.restart_v08_onboarding_internal(
  p_workspace_id uuid,
  p_session_id uuid,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  session_record public.onboarding_sessions%rowtype;
  approved_keys jsonb;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception 'WORKSPACE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_session_id is null or p_client_request_id is null then
    raise exception 'INVALID_ONBOARDING_RESTART' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_session_id::text, 808004::bigint)
  );

  select session.*
  into session_record
  from public.onboarding_sessions as session
  where session.workspace_id = p_workspace_id
    and session.id = p_session_id
    and session.user_id = actor_id
  for update;

  if session_record.id is null then
    raise exception 'ONBOARDING_SESSION_NOT_FOUND' using errcode = '22023';
  end if;

  if session_record.restart_client_request_id is distinct from p_client_request_id then
    update public.workspace_profile_candidates
    set status = 'superseded'
    where workspace_id = p_workspace_id
      and session_id = p_session_id
      and status = 'active';

    update public.onboarding_sessions
    set
      status = 'in_progress',
      active_step = 'business_identity',
      completed_at = null,
      restart_client_request_id = p_client_request_id
    where id = p_session_id
    returning * into session_record;

    insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload
    ) values (
      p_workspace_id,
      'onboarding.restarted',
      'onboarding:restart:' || p_client_request_id::text,
      'onboarding_session',
      p_session_id,
      pg_catalog.jsonb_build_object('sessionId', p_session_id)
    ) on conflict (workspace_id, event_key) do nothing;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(fact.category order by pg_catalog.array_position(
      array[
        'business_identity', 'primary_offering', 'primary_audience',
        'marketing_goal', 'approval_policy', 'channel_presence'
      ]::text[],
      fact.category
    )),
    '[]'::jsonb
  )
  into approved_keys
  from public.knowledge_facts as fact
  where fact.workspace_id = p_workspace_id
    and fact.status = 'active'
    and fact.category = any (array[
      'business_identity', 'primary_offering', 'primary_audience',
      'marketing_goal', 'approval_policy', 'channel_presence'
    ]::text[])
    and fact.valid_from <= statement_timestamp()
    and (fact.valid_until is null or fact.valid_until > statement_timestamp());

  return pg_catalog.jsonb_build_object(
    'sessionId', session_record.id,
    'workspaceId', session_record.workspace_id,
    'threadId', session_record.thread_id,
    'status', session_record.status,
    'activeStep', session_record.active_step,
    'approvedProfileKeys', approved_keys
  );
end;
$$;

create or replace function public.restart_v08_onboarding(
  p_workspace_id uuid,
  p_session_id uuid,
  p_client_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.restart_v08_onboarding_internal(
    p_workspace_id,
    p_session_id,
    p_client_request_id
  );
$$;

revoke execute on function private.restart_v08_onboarding_internal(uuid, uuid, uuid)
from public, anon;
grant execute on function private.restart_v08_onboarding_internal(uuid, uuid, uuid)
to authenticated;

revoke all on function public.restart_v08_onboarding(uuid, uuid, uuid)
from public, anon;
grant execute on function public.restart_v08_onboarding(uuid, uuid, uuid)
to authenticated;

notify pgrst, 'reload schema';
