alter table public.automation_rules drop constraint if exists automation_rules_kind_check;
alter table public.automation_rules add constraint automation_rules_kind_check check (kind in (
  'faq_safe_reply', 'schedule_reminder', 'content_draft',
  'daily_performance_report', 'twice_daily_performance_report', 'weekly_plan_proposal',
  'connection_health_check', 'approved_schedule_readiness'
));
alter table public.automation_rules
  add column timezone text not null default 'Asia/Seoul' check (char_length(timezone) between 1 and 64),
  add column next_run_at timestamptz,
  add column last_run_at timestamptz,
  add column configuration_version integer not null default 1 check (configuration_version > 0);
create index automation_rules_due_idx on public.automation_rules (next_run_at) where active and next_run_at is not null;

alter table public.automation_runs
  add column scheduled_for timestamptz,
  add column credit_reservation_id uuid,
  add column report_snapshot_id uuid references public.report_snapshots(id) on delete set null,
  add column safe_error_code text check (safe_error_code is null or char_length(safe_error_code) <= 120),
  add column claimed_by_worker_id uuid,
  add column claimed_at timestamptz;
create unique index automation_runs_rule_scheduled_for_key
  on public.automation_runs (rule_id, scheduled_for) where scheduled_for is not null;

create table public.performance_learning_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_report_snapshot_id uuid references public.report_snapshots(id) on delete set null,
  observation jsonb not null check (jsonb_typeof(observation) = 'object'),
  interpretation jsonb not null check (jsonb_typeof(interpretation) = 'object'),
  proposed_impact jsonb not null check (jsonb_typeof(proposed_impact) = 'object'),
  stop_condition jsonb not null check (jsonb_typeof(stop_condition) = 'object'),
  status text not null default 'candidate' check (status in ('candidate', 'review_required', 'approved', 'rejected', 'superseded')),
  version integer not null default 1 check (version > 0),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  review_reason text check (review_reason is null or char_length(review_reason) <= 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint performance_learning_candidates_workspace_id_id_key unique (workspace_id, id)
);
create index performance_learning_candidates_workspace_status_idx
  on public.performance_learning_candidates (workspace_id, status, updated_at desc);
create trigger performance_learning_candidates_set_updated_at before update
on public.performance_learning_candidates for each row execute function private.set_updated_at();
alter table public.performance_learning_candidates enable row level security;
revoke all on public.performance_learning_candidates from public, anon, authenticated;
grant select on public.performance_learning_candidates to authenticated;
grant select, insert, update, delete on public.performance_learning_candidates to service_role;
create policy "workspace members read performance learning candidates"
on public.performance_learning_candidates for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create function public.claim_due_v08_automation(p_now timestamptz, p_worker_id uuid)
returns table(run_id uuid, workspace_id uuid, rule_id uuid, scheduled_for timestamptz)
language plpgsql security definer set search_path = '' as $$
declare due_rule public.automation_rules%rowtype;
begin
  select * into due_rule from public.automation_rules
  where active and next_run_at is not null and next_run_at <= p_now
    and kind in ('daily_performance_report', 'twice_daily_performance_report', 'weekly_plan_proposal', 'connection_health_check', 'approved_schedule_readiness')
  order by next_run_at for update skip locked limit 1;
  if not found then return; end if;
  insert into public.automation_runs (workspace_id, rule_id, status, scheduled_for, claimed_by_worker_id, claimed_at)
  values (due_rule.workspace_id, due_rule.id, 'pending', due_rule.next_run_at, p_worker_id, statement_timestamp())
  on conflict (rule_id, scheduled_for) where scheduled_for is not null do nothing
  returning id into run_id;
  if run_id is null then return; end if;
  update public.automation_rules set last_run_at = due_rule.next_run_at, next_run_at = null
  where id = due_rule.id;
  workspace_id := due_rule.workspace_id; rule_id := due_rule.id; scheduled_for := due_rule.next_run_at;
  return next;
end;
$$;

create function public.complete_v08_automation_run(p_run_id uuid, p_status text, p_report_snapshot_id uuid, p_safe_error_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('awaiting_approval', 'succeeded', 'failed') or char_length(coalesce(p_safe_error_code, '')) > 120 then return false; end if;
  update public.automation_runs set status = p_status, report_snapshot_id = p_report_snapshot_id,
    safe_error_code = p_safe_error_code, finished_at = statement_timestamp()
  where id = p_run_id and status = 'pending';
  return found;
end;
$$;

create function public.create_performance_learning_candidate(p_workspace_id uuid, p_actor_user_id uuid, p_observation jsonb, p_interpretation jsonb, p_proposed_impact jsonb, p_stop_condition jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare candidate_id uuid;
begin
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_user_id and status = 'active' and role in ('owner','manager'))
    or jsonb_typeof(p_observation) <> 'object' or jsonb_typeof(p_interpretation) <> 'object' or jsonb_typeof(p_proposed_impact) <> 'object' or jsonb_typeof(p_stop_condition) <> 'object' then
    raise exception 'performance_learning_candidate_forbidden';
  end if;
  insert into public.performance_learning_candidates (workspace_id, observation, interpretation, proposed_impact, stop_condition, status, created_by)
  values (p_workspace_id, p_observation, p_interpretation, p_proposed_impact, p_stop_condition, 'review_required', p_actor_user_id) returning id into candidate_id;
  return candidate_id;
end;
$$;

create function public.review_performance_learning_candidate(p_workspace_id uuid, p_candidate_id uuid, p_decision text, p_reason text, p_expected_version integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_decision not in ('approved', 'rejected') or not (select private.has_workspace_role(p_workspace_id, array['owner','manager']::text[])) then return false; end if;
  update public.performance_learning_candidates set status = p_decision, decided_by = (select auth.uid()), decided_at = statement_timestamp(), review_reason = p_reason
  where workspace_id = p_workspace_id and id = p_candidate_id and status = 'review_required' and version = p_expected_version;
  return found;
end;
$$;
revoke all on function public.claim_due_v08_automation(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.complete_v08_automation_run(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.create_performance_learning_candidate(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.review_performance_learning_candidate(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_v08_automation(timestamptz, uuid) to service_role;
grant execute on function public.complete_v08_automation_run(uuid, text, uuid, text) to service_role;
grant execute on function public.create_performance_learning_candidate(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.review_performance_learning_candidate(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.create_performance_learning_candidate(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.review_performance_learning_candidate(uuid, uuid, text, text, integer) to authenticated;
