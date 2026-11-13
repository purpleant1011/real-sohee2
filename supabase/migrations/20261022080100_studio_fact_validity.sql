-- Append-only: keep the existing Candidate -> Fact approval transaction and add explicit validity.
-- No booking or published-content record is rewritten. Production application requires separate approval.
create or replace function public.decide_studio_proposal_with_validity(
  p_workspace_id uuid,
  p_proposal_id uuid,
  p_decision text,
  p_user_id uuid,
  p_revised_content text,
  p_valid_from timestamptz,
  p_valid_until timestamptz default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_proposal public.sohee_studio_proposals%rowtype;
  v_fact public.knowledge_facts%rowtype;
  v_result jsonb;
begin
  if p_decision is distinct from 'confirm' or p_valid_from is null
     or not pg_catalog.isfinite(p_valid_from)
     or (p_valid_until is not null and (not pg_catalog.isfinite(p_valid_until) or p_valid_until <= p_valid_from)) then
    raise exception 'invalid_argument: explicit increasing fact validity required' using errcode = '22023';
  end if;
  -- The privileged server supplies the actor; still enforce their active workspace role in SQL.
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_user_id
      and status = 'active' and role in ('owner', 'manager')
  ) then
    raise exception 'forbidden: workspace approval role required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_workspace_id::text || ':studio')::bigint);
  select * into v_proposal from public.sohee_studio_proposals
    where workspace_id = p_workspace_id and id = p_proposal_id for update;
  if not found then
    raise exception 'proposal_not_found' using errcode = 'P0002';
  end if;
  if v_proposal.kind <> 'fact' then
    raise exception 'invalid_argument: validity only applies to fact proposals' using errcode = '22023';
  end if;
  if v_proposal.status = 'confirmed' then
    select * into v_fact from public.knowledge_facts
      where workspace_id = p_workspace_id and id = v_proposal.confirmed_target_id;
    if not found or v_fact.valid_from is distinct from p_valid_from
       or v_fact.valid_until is distinct from p_valid_until then
      raise exception 'conflict: confirmed validity cannot be overwritten' using errcode = '23505';
    end if;
  end if;
  v_result := public.decide_studio_proposal(p_workspace_id, p_proposal_id, p_decision, p_user_id, p_revised_content);
  if v_proposal.status <> 'confirmed' then
    update public.knowledge_facts set valid_from = p_valid_from, valid_until = p_valid_until
      where workspace_id = p_workspace_id and id = (v_result->>'confirmed_target_id')::uuid;
    if not found then
      raise exception 'fact_not_found: approval did not create a fact' using errcode = 'P0002';
    end if;
  end if;
  return v_result || pg_catalog.jsonb_build_object('valid_from', p_valid_from, 'valid_until', p_valid_until);
end;
$$;
revoke all on function public.decide_studio_proposal_with_validity(uuid,uuid,text,uuid,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.decide_studio_proposal_with_validity(uuid,uuid,text,uuid,text,timestamptz,timestamptz) to service_role;
