create or replace function public.create_performance_learning_candidate(
  p_workspace_id uuid, p_actor_user_id uuid, p_observation jsonb, p_interpretation jsonb, p_proposed_impact jsonb, p_stop_condition jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare candidate_id uuid;
begin
  if (select auth.uid()) is distinct from p_actor_user_id then
    raise exception 'performance_learning_candidate_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_actor_user_id and status = 'active' and role in ('owner','manager'))
    or jsonb_typeof(p_observation) <> 'object' or jsonb_typeof(p_interpretation) <> 'object' or jsonb_typeof(p_proposed_impact) <> 'object' or jsonb_typeof(p_stop_condition) <> 'object' then
    raise exception 'performance_learning_candidate_forbidden' using errcode = '42501';
  end if;
  insert into public.performance_learning_candidates (workspace_id, observation, interpretation, proposed_impact, stop_condition, status, created_by)
  values (p_workspace_id, p_observation, p_interpretation, p_proposed_impact, p_stop_condition, 'review_required', p_actor_user_id) returning id into candidate_id;
  return candidate_id;
end;
$$;
