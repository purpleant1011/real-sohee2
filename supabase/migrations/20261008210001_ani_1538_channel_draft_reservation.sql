-- ANI-1538: claim model-generation slots atomically per workspace before provider calls.
create function public.reserve_channel_draft_ani1538(
  p_workspace_id uuid, p_request_key uuid, p_created_by uuid,
  p_topic text, p_knowledge_version integer, p_basis_notes jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_recent integer;
  v_draft public.channel_drafts%rowtype;
begin
  -- Per-workspace transaction lock serializes both the count and reservation insert.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ani1538:' || p_workspace_id::text, 0));
  select * into v_draft from public.channel_drafts
    where workspace_id = p_workspace_id and request_key = p_request_key;
  if found then
    return case when jsonb_array_length(v_draft.variants) > 0 then 'existing' else 'pending' end;
  end if;
  select count(*) into v_recent from public.channel_drafts
    where workspace_id = p_workspace_id and created_at >= now() - interval '24 hours';
  if v_recent >= 10 then return 'limit'; end if;
  insert into public.channel_drafts (workspace_id, request_key, topic, knowledge_version, basis_notes, variants, created_by)
    values (p_workspace_id, p_request_key, p_topic, p_knowledge_version, p_basis_notes, '[]'::jsonb, p_created_by);
  return 'acquired';
end;
$$;
revoke all on function public.reserve_channel_draft_ani1538(uuid,uuid,uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_channel_draft_ani1538(uuid,uuid,uuid,text,integer,jsonb) to service_role;

create function public.release_channel_draft_ani1538(p_workspace_id uuid, p_request_key uuid, p_created_by uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- Only empty reservations owned by the current generation request can be released.
  delete from public.channel_drafts
    where workspace_id = p_workspace_id and request_key = p_request_key and created_by = p_created_by
      and variants = '[]'::jsonb;
end;
$$;
revoke all on function public.release_channel_draft_ani1538(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.release_channel_draft_ani1538(uuid,uuid,uuid) to service_role;

-- Rollback: drop function public.release_channel_draft_ani1538(uuid,uuid,uuid);
-- Rollback: drop function public.reserve_channel_draft_ani1538(uuid,uuid,uuid,text,integer,jsonb);
