create index report_decisions_created_by_idx
  on public.report_decisions (created_by);

create index report_decisions_conversation_thread_idx
  on public.report_decisions (workspace_id, conversation_thread_id)
  where conversation_thread_id is not null;

create index report_experiments_created_by_idx
  on public.report_experiments (created_by);

create or replace function public.create_report_decision_with_evidence(
  p_workspace_id uuid,
  p_insight_key text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_observed_facts jsonb,
  p_hypothesis text,
  p_change_variable text,
  p_invariants jsonb,
  p_customer_signal_ids jsonb,
  p_owner_note text,
  p_evidence_version_ids uuid[]
)
returns table (id uuid, workspace_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_decision_id uuid;
begin
  if coalesce(cardinality(p_evidence_version_ids), 0) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'REPORT_EVIDENCE_COUNT_INVALID';
  end if;

  if cardinality(p_evidence_version_ids) <> cardinality(array(select distinct value from unnest(p_evidence_version_ids) as value)) then
    raise exception using errcode = '22023', message = 'REPORT_EVIDENCE_DUPLICATE';
  end if;

  insert into public.report_decisions (
    workspace_id,
    insight_key,
    period_start,
    period_end,
    observed_facts,
    hypothesis,
    change_variable,
    invariants,
    customer_signal_ids,
    owner_note
  ) values (
    p_workspace_id,
    p_insight_key,
    p_period_start,
    p_period_end,
    p_observed_facts,
    p_hypothesis,
    p_change_variable,
    p_invariants,
    p_customer_signal_ids,
    p_owner_note
  )
  returning report_decisions.id into v_decision_id;

  insert into public.report_decision_evidence (
    workspace_id,
    decision_id,
    content_version_id,
    position
  )
  select
    p_workspace_id,
    v_decision_id,
    evidence.content_version_id,
    evidence.position - 1
  from unnest(p_evidence_version_ids) with ordinality as evidence(content_version_id, position);

  return query select v_decision_id, p_workspace_id;
end;
$$;

revoke all on function public.create_report_decision_with_evidence(
  uuid, text, timestamptz, timestamptz, jsonb, text, text, jsonb, jsonb, text, uuid[]
) from public, anon;

grant execute on function public.create_report_decision_with_evidence(
  uuid, text, timestamptz, timestamptz, jsonb, text, text, jsonb, jsonb, text, uuid[]
) to authenticated, service_role;
