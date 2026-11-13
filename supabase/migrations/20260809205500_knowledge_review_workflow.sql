create or replace function public.review_knowledge_item(
  p_workspace_id uuid,
  p_knowledge_id uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_item public.knowledge_items%rowtype;
begin
  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception using errcode = '42501', message = 'knowledge_review_forbidden';
  end if;

  if p_decision not in ('review_required', 'approved', 'rejected', 'disabled') then
    raise exception using errcode = '22023', message = 'knowledge_decision_invalid';
  end if;

  select * into current_item
  from public.knowledge_items
  where workspace_id = p_workspace_id and id = p_knowledge_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'knowledge_not_found';
  end if;

  if not (
    (current_item.status = 'checking' and p_decision in ('review_required', 'rejected'))
    or (current_item.status = 'review_required' and p_decision in ('approved', 'rejected'))
    or (current_item.status = 'approved' and p_decision = 'disabled')
  ) then
    raise exception using errcode = '23514', message = 'knowledge_transition_invalid';
  end if;

  if p_decision = 'approved' then
    if coalesce(current_item.evidence -> 'fileValidated', 'false'::jsonb) <> 'true'::jsonb then
      raise exception using errcode = '23514', message = 'knowledge_file_not_validated';
    end if;

    update public.media_assets
    set rights_status = 'confirmed'
    where workspace_id = p_workspace_id
      and id = current_item.media_asset_id
      and bucket_id = 'knowledge-files'
      and kind = 'knowledge';

    if not found then
      raise exception using errcode = 'P0002', message = 'knowledge_asset_not_found';
    end if;
  elsif p_decision = 'rejected' then
    update public.media_assets
    set rights_status = 'rejected'
    where workspace_id = p_workspace_id and id = current_item.media_asset_id;
  end if;

  update public.knowledge_items
  set
    status = p_decision,
    evidence = case p_decision
      when 'review_required' then evidence || jsonb_build_object(
        'mockFileCheck', true,
        'reviewed', false
      )
      when 'approved' then evidence || jsonb_build_object(
        'reviewed', true,
        'reviewMode', 'human',
        'reviewedAt', statement_timestamp()
      )
      when 'rejected' then evidence || jsonb_build_object(
        'reviewed', true,
        'reviewMode', 'human',
        'reviewedAt', statement_timestamp()
      )
      else evidence || jsonb_build_object('disabledAt', statement_timestamp())
    end
  where workspace_id = p_workspace_id and id = p_knowledge_id;

  return p_knowledge_id;
end;
$$;

revoke execute on function public.review_knowledge_item(uuid, uuid, text)
  from public, anon;
grant execute on function public.review_knowledge_item(uuid, uuid, text)
  to authenticated;
