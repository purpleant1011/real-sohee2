create table public.report_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  insight_key text not null check (char_length(insight_key) between 1 and 240),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end >= period_start),
  observed_facts jsonb not null check (jsonb_typeof(observed_facts) = 'array'),
  hypothesis text not null check (char_length(hypothesis) between 1 and 1000),
  change_variable text not null check (change_variable in ('opening', 'format', 'cta', 'timing', 'other')),
  invariants jsonb not null check (jsonb_typeof(invariants) = 'array'),
  customer_signal_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(customer_signal_ids) = 'array'),
  owner_note text check (owner_note is null or char_length(owner_note) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'conversation_started', 'experiment_planned', 'result_ready', 'learning_candidate')),
  conversation_thread_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint report_decisions_workspace_id_id_key unique (workspace_id, id),
  foreign key (workspace_id, conversation_thread_id)
    references public.conversation_threads(workspace_id, id) on delete set null
);

create index report_decisions_workspace_created_idx
  on public.report_decisions (workspace_id, created_at desc);
create index report_decisions_workspace_status_idx
  on public.report_decisions (workspace_id, status, updated_at desc);
create trigger report_decisions_set_updated_at before update
  on public.report_decisions for each row execute function private.set_updated_at();

create table public.report_decision_evidence (
  workspace_id uuid not null,
  decision_id uuid not null,
  content_version_id uuid not null,
  position smallint not null check (position >= 0 and position < 100),
  created_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, decision_id, content_version_id),
  unique (workspace_id, decision_id, position),
  foreign key (workspace_id, decision_id)
    references public.report_decisions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, content_version_id)
    references public.content_versions(workspace_id, id) on delete restrict
);

create index report_decision_evidence_version_idx
  on public.report_decision_evidence (workspace_id, content_version_id, decision_id);

create table public.report_experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  decision_id uuid not null,
  hypothesis text not null check (char_length(hypothesis) between 1 and 1000),
  change_variable text not null check (change_variable in ('opening', 'format', 'cta', 'timing', 'other')),
  invariant_keys jsonb not null check (jsonb_typeof(invariant_keys) = 'array'),
  variant_a_content_version_id uuid not null,
  variant_b_content_version_id uuid not null,
  variant_a_scheduled_at timestamptz not null,
  variant_b_scheduled_at timestamptz not null,
  primary_metric text not null check (char_length(primary_metric) between 1 and 80),
  secondary_metrics jsonb not null default '[]'::jsonb check (jsonb_typeof(secondary_metrics) = 'array'),
  guardrail_metrics jsonb not null default '[]'::jsonb check (jsonb_typeof(guardrail_metrics) = 'array'),
  collection_cadence_hours jsonb not null default '[4,24,168]'::jsonb check (jsonb_typeof(collection_cadence_hours) = 'array'),
  review_at timestamptz not null,
  approval_state text not null default 'not_requested' check (approval_state in ('not_requested', 'pending', 'approved')),
  status text not null default 'planned' check (status in ('planned', 'running', 'result_ready', 'completed', 'cancelled')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint report_experiments_workspace_id_id_key unique (workspace_id, id),
  constraint report_experiments_distinct_versions check (variant_a_content_version_id <> variant_b_content_version_id),
  constraint report_experiments_distinct_schedule_times check (variant_a_scheduled_at <> variant_b_scheduled_at),
  constraint report_experiments_review_after_variants check (review_at > greatest(variant_a_scheduled_at, variant_b_scheduled_at)),
  foreign key (workspace_id, decision_id)
    references public.report_decisions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, variant_a_content_version_id)
    references public.content_versions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, variant_b_content_version_id)
    references public.content_versions(workspace_id, id) on delete restrict
);

create index report_experiments_workspace_status_idx
  on public.report_experiments (workspace_id, status, updated_at desc);
create index report_experiments_decision_idx
  on public.report_experiments (workspace_id, decision_id, created_at desc);
create index report_experiments_variant_a_idx
  on public.report_experiments (workspace_id, variant_a_content_version_id);
create index report_experiments_variant_b_idx
  on public.report_experiments (workspace_id, variant_b_content_version_id);
create trigger report_experiments_set_updated_at before update
  on public.report_experiments for each row execute function private.set_updated_at();

alter table public.report_decisions enable row level security;
alter table public.report_decision_evidence enable row level security;
alter table public.report_experiments enable row level security;

revoke all on table public.report_decisions from public, anon, authenticated;
revoke all on table public.report_decision_evidence from public, anon, authenticated;
revoke all on table public.report_experiments from public, anon, authenticated;

grant select, insert, update on table public.report_decisions to authenticated;
grant select, insert, delete on table public.report_decision_evidence to authenticated;
grant select, insert, update on table public.report_experiments to authenticated;
grant select, insert, update, delete on table public.report_decisions to service_role;
grant select, insert, update, delete on table public.report_decision_evidence to service_role;
grant select, insert, update, delete on table public.report_experiments to service_role;

create policy "workspace members read report decisions"
  on public.report_decisions for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "workspace managers create report decisions"
  on public.report_decisions for insert to authenticated
  with check (
    (select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[]))
    and created_by = (select auth.uid())
  );
create policy "workspace managers update report decisions"
  on public.report_decisions for update to authenticated
  using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
  with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace members read report decision evidence"
  on public.report_decision_evidence for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "workspace managers create report decision evidence"
  on public.report_decision_evidence for insert to authenticated
  with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));
create policy "workspace managers delete report decision evidence"
  on public.report_decision_evidence for delete to authenticated
  using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));

create policy "workspace members read report experiments"
  on public.report_experiments for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy "workspace managers create report experiments"
  on public.report_experiments for insert to authenticated
  with check (
    (select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[]))
    and created_by = (select auth.uid())
  );
create policy "workspace managers update report experiments"
  on public.report_experiments for update to authenticated
  using ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])))
  with check ((select private.has_workspace_role(workspace_id, array['owner', 'manager']::text[])));
