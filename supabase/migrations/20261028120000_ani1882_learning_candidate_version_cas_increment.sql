-- ANI-1882: Fix review_performance_learning_candidate CAS version increment, IS DISTINCT FROM fail-closed checks, and retain authenticated grants
-- Rollback:
-- 1. Restore review_performance_learning_candidate from 20260818170111_v08_automation_reporting_learning.sql (without version = version + 1)
-- 2. Restore create_performance_learning_candidate from 20260818182500_v08_learning_actor_identity_hardening.sql

create or replace function public.review_performance_learning_candidate(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid;
begin
  -- Fail-closed on NULL or invalid decision
  if p_decision is distinct from 'approved' and p_decision is distinct from 'rejected' then
    return false;
  end if;

  -- Require explicit authenticated actor; actor-less decisions are strictly forbidden
  v_actor_id := (select auth.uid());
  if v_actor_id is null then
    return false;
  end if;

  -- Verify actor has owner/manager role in the workspace
  if not (select private.has_workspace_role(p_workspace_id, array['owner','manager']::text[])) then
    return false;
  end if;

  update public.performance_learning_candidates
  set status = p_decision,
      version = version + 1,
      decided_by = v_actor_id,
      decided_at = statement_timestamp(),
      review_reason = p_reason
  where workspace_id = p_workspace_id
    and id = p_candidate_id
    and status = 'review_required'
    and version = p_expected_version;

  return found;
end;
$$;

create or replace function public.create_performance_learning_candidate(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_observation jsonb,
  p_interpretation jsonb,
  p_proposed_impact jsonb,
  p_stop_condition jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  candidate_id uuid;
  v_caller_id uuid;
begin
  -- Require authenticated actor identity matching p_actor_user_id
  v_caller_id := (select auth.uid());
  if v_caller_id is null or v_caller_id is distinct from p_actor_user_id then
    raise exception 'performance_learning_candidate_forbidden' using errcode = '42501';
  end if;

  -- Fail-closed on non-object JSON or non-active owner/manager
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role in ('owner','manager')
  )
  or jsonb_typeof(p_observation) is distinct from 'object'
  or jsonb_typeof(p_interpretation) is distinct from 'object'
  or jsonb_typeof(p_proposed_impact) is distinct from 'object'
  or jsonb_typeof(p_stop_condition) is distinct from 'object' then
    raise exception 'performance_learning_candidate_forbidden' using errcode = '42501';
  end if;

  insert into public.performance_learning_candidates (
    workspace_id, observation, interpretation, proposed_impact, stop_condition, status, created_by
  )
  values (
    p_workspace_id, p_observation, p_interpretation, p_proposed_impact, p_stop_condition, 'review_required', p_actor_user_id
  )
  returning id into candidate_id;

  return candidate_id;
end;
$$;

-- Preserve authenticated owner/manager grants alongside service_role
revoke all on function public.review_performance_learning_candidate(uuid, uuid, text, text, integer) from public, anon;
revoke all on function public.create_performance_learning_candidate(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;

grant execute on function public.review_performance_learning_candidate(uuid, uuid, text, text, integer) to authenticated, service_role;
grant execute on function public.create_performance_learning_candidate(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
