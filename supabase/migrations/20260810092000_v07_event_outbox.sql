create table public.operation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  event_type text not null,
  event_key text not null check (
    char_length(event_key) between 2 and 200
    and event_key ~ '^[a-z0-9][a-z0-9:._/-]*$'
  ),
  subject_type text not null check (
    char_length(subject_type) between 1 and 80
    and subject_type ~ '^[a-z][a-z0-9_]*$'
  ),
  subject_id uuid not null,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint operation_events_event_type_check check (
    event_type in (
      'content.plan.created',
      'content.version.created',
      'content.review.requested',
      'content.approved',
      'content.approval.invalidated',
      'schedule.suggested',
      'schedule.confirmed',
      'publish.succeeded',
      'publish.failed',
      'report.snapshot.ready',
      'customer.conversation.needs_attention',
      'knowledge.conflict.detected',
      'harness.rule.candidate_created'
    )
  ),
  constraint operation_events_workspace_id_id_key unique (workspace_id, id),
  constraint operation_events_workspace_id_event_key_key unique (workspace_id, event_key)
);

create index operation_events_workspace_unprocessed_idx
  on public.operation_events (workspace_id, occurred_at, id)
  where processed_at is null;
create index operation_events_workspace_subject_idx
  on public.operation_events (workspace_id, subject_type, subject_id, occurred_at desc);

alter table public.operation_events enable row level security;

create policy "workspace members can read operation events"
on public.operation_events for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

revoke all on public.operation_events from anon, authenticated;
grant select on public.operation_events to authenticated;
grant select, insert, update, delete on public.operation_events to service_role;
