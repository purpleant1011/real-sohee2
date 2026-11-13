-- ANI-1538: one transaction verifies the exact prior variant, replaces it, and appends an immutable vault version.
-- Only server-side service role callers may invoke the function. No external publishing calls.
create function public.edit_channel_draft_variant_ani1538(
  p_workspace_id uuid, p_request_key uuid, p_channel text,
  p_expected jsonb, p_next jsonb, p_created_by uuid, p_content_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_draft public.channel_drafts%rowtype;
  v_position integer;
  v_previous jsonb;
  v_result jsonb;
  v_content uuid;
  v_version uuid;
  v_number integer;
  v_caption text;
  v_title text;
  v_tags text[];
  v_media jsonb;
  v_asset uuid;
  v_fingerprint text;
  v_link_count integer := 0;
begin
  -- Function EXECUTE is revoked from public/authenticated; SECURITY INVOKER retains table RLS.
  -- Isolated replay runs as the owning test role rather than Supabase's service_role.
  if p_channel not in ('instagram', 'threads', 'naver_blog', 'daangn_business')
    or p_expected->>'channel' is distinct from p_channel or p_next->>'channel' is distinct from p_channel
    or p_created_by is null or jsonb_typeof(p_next->'payload') is distinct from 'object' then
    raise exception 'Invalid channel edit' using errcode = '22023';
  end if;
  select * into v_draft from public.channel_drafts
    where workspace_id = p_workspace_id and request_key = p_request_key for update;
  if not found or jsonb_array_length(v_draft.variants) = 0 then return null; end if;
  select (index - 1)::integer, item into v_position, v_previous
    from jsonb_array_elements(v_draft.variants) with ordinality as variants(item, index)
    where item->>'channel' = p_channel limit 1;
  if not found or v_previous is distinct from p_expected then return null; end if;
  -- Only trusted server-supplied fields are materialised. A READY edit always gets a new version.
  v_result := p_next;
  if p_next->>'status' = 'READY' and (p_next->>'vaultSavable')::boolean is true then
    v_caption := case when p_channel = 'instagram' then p_next->'payload'->>'caption' else p_next->'payload'->>'text' end;
    v_title := case when p_channel = 'naver_blog' then p_next->'payload'->>'title' else v_draft.topic end;
    if v_caption is null or char_length(v_caption) not between 1 and 2200
      or v_title is null or char_length(v_title) not between 1 and 200 then
      raise exception 'Invalid content length' using errcode = '22023';
    end if;
    select coalesce(array_agg(tag order by position), '{}'::text[]) into v_tags
      from jsonb_array_elements_text(coalesce(p_next->'payload'->'hashtags', '[]'::jsonb)) with ordinality as entries(tag, position);
    if cardinality(v_tags) > 30 then raise exception 'Too many hashtags' using errcode = '22023'; end if;
    v_content := nullif(v_previous->>'contentId', '')::uuid;
    -- A previously flagged variant has no active contentId. Keep any older content item
    -- if it belonged to this channel, otherwise create one for the newly READY variant.
    if v_content is not null and v_content is distinct from p_content_id then
      raise exception 'Content mismatch' using errcode = '22023';
    end if;
    v_content := p_content_id;
    insert into public.content_items (id, workspace_id, channel, title, created_by)
      values (v_content, p_workspace_id, p_channel, v_title, p_created_by)
      on conflict (id) do nothing;
    perform 1 from public.content_items
      where workspace_id = p_workspace_id and id = v_content and channel = p_channel;
    if not found then raise exception 'Invalid content' using errcode = '22023'; end if;
    select coalesce(max(version_number), 0) + 1 into v_number from public.content_versions
      where workspace_id = p_workspace_id and content_id = v_content;
    v_version := pg_catalog.gen_random_uuid();
    v_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.concat_ws(':', p_workspace_id, p_request_key, p_channel, v_number, v_caption), 'sha256'), 'hex');
    insert into public.content_versions (id, workspace_id, content_id, version_number, caption, hashtags, fingerprint, created_by)
      values (v_version, p_workspace_id, v_content, v_number, v_caption, v_tags, v_fingerprint, p_created_by);
    -- Reuse only media already bound to the preceding version and still owned by this workspace.
    v_media := p_next->'payload'->'media';
    if jsonb_typeof(v_media) = 'array' then
      for v_asset in select (regexp_match(item->>'src', '^/api/workspaces/' || p_workspace_id::text || '/media/([0-9a-f-]{36})$'))[1]::uuid
        from jsonb_array_elements(v_media) item
        where item->>'src' ~ ('^/api/workspaces/' || p_workspace_id::text || '/media/[0-9a-f-]{36}$')
      loop
        perform 1 from public.media_assets where workspace_id = p_workspace_id and id = v_asset and kind = 'content';
        if not found then raise exception 'Media missing' using errcode = '22023'; end if;
        insert into public.content_version_media (workspace_id, version_id, media_asset_id, position)
          values (p_workspace_id, v_version, v_asset, v_link_count);
        v_link_count := v_link_count + 1;
      end loop;
    end if;
    v_result := jsonb_set(jsonb_set(v_result, '{contentId}', pg_catalog.to_jsonb(v_content)), '{versionId}', pg_catalog.to_jsonb(v_version));
  else
    v_result := jsonb_set(jsonb_set(jsonb_set(v_result, '{contentId}', 'null'::jsonb), '{versionId}', 'null'::jsonb), '{vaultSavable}', 'false'::jsonb);
  end if;
  update public.channel_drafts set variants = jsonb_set(variants, array[v_position::text], v_result)
    where workspace_id = p_workspace_id and request_key = p_request_key
    returning pg_catalog.jsonb_build_object('workspace_id', workspace_id, 'request_key', request_key,
      'topic', topic, 'created_at', created_at, 'basis_notes', basis_notes, 'image_notice', image_notice,
      'variants', variants) into v_result;
  return v_result;
end;
$$;
revoke all on function public.edit_channel_draft_variant_ani1538(uuid,uuid,text,jsonb,jsonb,uuid,uuid) from public, anon, authenticated;
grant execute on function public.edit_channel_draft_variant_ani1538(uuid,uuid,text,jsonb,jsonb,uuid,uuid) to service_role;
-- Rollback (only when no new edits exist): drop function public.edit_channel_draft_variant_ani1538(uuid,uuid,text,jsonb,jsonb,uuid,uuid);
