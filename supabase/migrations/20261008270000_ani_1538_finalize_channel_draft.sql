-- ANI-1538: materialise vault content and finalize its preview in one transaction.
create function public.finalize_channel_draft_ani1538(
  p_workspace_id uuid, p_request_key uuid, p_created_by uuid,
  p_topic text, p_knowledge_version integer, p_basis_notes jsonb,
  p_image_notice text, p_variants jsonb, p_media_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_draft public.channel_drafts%rowtype;
  v_variant jsonb;
  v_asset uuid;
  v_content uuid;
  v_version uuid;
  v_channel text;
  v_caption text;
  v_title text;
  v_tags text[];
  v_position integer;
  v_result jsonb;
begin
  if p_created_by is null or jsonb_typeof(p_variants) <> 'array'
    or pg_catalog.cardinality(p_media_ids) > 10
    or pg_catalog.cardinality(p_media_ids) <> (select count(distinct id)::integer from pg_catalog.unnest(p_media_ids) id)
    or pg_catalog.array_position(p_media_ids, null) is not null then
    raise exception 'Invalid draft input' using errcode = '22023';
  end if;

  -- Preserve direct repository callers while the service normally reserves before generation.
  insert into public.channel_drafts
    (workspace_id, request_key, topic, knowledge_version, basis_notes, image_notice, variants, created_by)
  values (p_workspace_id, p_request_key, p_topic, p_knowledge_version, p_basis_notes,
    p_image_notice, '[]'::jsonb, p_created_by)
  on conflict (workspace_id, request_key) do nothing;
  select * into v_draft from public.channel_drafts
    where workspace_id = p_workspace_id and request_key = p_request_key for update;
  if not found then raise exception 'Reserved draft unavailable' using errcode = '22023'; end if;
  if v_draft.variants <> '[]'::jsonb then
    return pg_catalog.jsonb_build_object('workspace_id', v_draft.workspace_id, 'request_key', v_draft.request_key,
      'topic', v_draft.topic, 'created_at', v_draft.created_at, 'basis_notes', v_draft.basis_notes,
      'image_notice', v_draft.image_notice, 'variants', v_draft.variants);
  end if;
  if v_draft.created_by <> p_created_by then
    raise exception 'Reservation owner mismatch' using errcode = '22023';
  end if;
  if jsonb_array_length(p_variants) = 0 then
    raise exception 'Empty draft cannot be finalized' using errcode = '22023';
  end if;

  -- Verify metadata again under the write transaction; never trust a prior client-side lookup.
  for v_asset in select pg_catalog.unnest(p_media_ids) loop
    perform 1 from public.media_assets
      where workspace_id = p_workspace_id and id = v_asset and kind = 'content'
        and mime_type like 'image/%' and sha256_digest is not null;
    if not found then raise exception 'Media unavailable' using errcode = '22023'; end if;
  end loop;

  for v_variant in select value from jsonb_array_elements(p_variants) loop
    v_channel := v_variant->>'channel';
    if v_channel not in ('instagram', 'threads', 'naver_blog', 'daangn_business')
      or jsonb_typeof(v_variant->'payload') <> 'object' then
      raise exception 'Invalid channel variant' using errcode = '22023';
    end if;
    if v_variant->>'status' = 'READY' and v_variant->>'contentId' is not null then
      v_content := (v_variant->>'contentId')::uuid;
      v_version := (v_variant->>'versionId')::uuid;
      v_title := case when v_channel = 'naver_blog' then v_variant->'payload'->>'title' else v_draft.topic end;
      v_caption := case when v_channel = 'instagram' then v_variant->'payload'->>'caption'
        when v_channel = 'naver_blog' and nullif(v_variant->'payload'->>'text', '') is null then
          (select pg_catalog.string_agg(block->>'text', E'\n\n' order by ordinal)
            from jsonb_array_elements(coalesce(v_variant->'payload'->'blocks', '[]'::jsonb)) with ordinality as b(block, ordinal)
            where nullif(block->>'text', '') is not null)
        else v_variant->'payload'->>'text' end;
      if v_caption is null or pg_catalog.char_length(v_caption) not between 1 and 2200
        or v_title is null or pg_catalog.char_length(v_title) not between 1 and 200 then
        raise exception 'Invalid content length' using errcode = '22023';
      end if;
      select coalesce(pg_catalog.array_agg(tag order by ordinal), '{}'::text[]) into v_tags
        from jsonb_array_elements_text(coalesce(v_variant->'payload'->'hashtags', '[]'::jsonb)) with ordinality as entries(tag, ordinal);
      if pg_catalog.cardinality(v_tags) > 30 then raise exception 'Too many hashtags' using errcode = '22023'; end if;
      insert into public.content_items (id, workspace_id, channel, title, created_by)
        values (v_content, p_workspace_id, v_channel, v_title, p_created_by);
      insert into public.content_versions
        (id, workspace_id, content_id, version_number, caption, hashtags, fingerprint, created_by)
      values (v_version, p_workspace_id, v_content, 1, v_caption, v_tags,
        pg_catalog.encode(extensions.digest(pg_catalog.concat_ws(':', p_workspace_id, p_request_key, v_channel, 1, v_caption), 'sha256'), 'hex'), p_created_by);
      v_position := 0;
      for v_asset in select pg_catalog.unnest(p_media_ids) loop
        insert into public.content_version_media (workspace_id, version_id, media_asset_id, position)
          values (p_workspace_id, v_version, v_asset, v_position);
        v_position := v_position + 1;
      end loop;
    end if;
  end loop;

  update public.channel_drafts set variants = p_variants, image_notice = p_image_notice
    where workspace_id = p_workspace_id and request_key = p_request_key and variants = '[]'::jsonb
    returning pg_catalog.jsonb_build_object('workspace_id', workspace_id, 'request_key', request_key,
      'topic', topic, 'created_at', created_at, 'basis_notes', basis_notes,
      'image_notice', image_notice, 'variants', variants) into v_result;
  if v_result is null then raise exception 'Reserved draft unavailable' using errcode = '22023'; end if;
  return v_result;
end;
$$;
revoke all on function public.finalize_channel_draft_ani1538(uuid,uuid,uuid,text,integer,jsonb,text,jsonb,uuid[]) from public, anon, authenticated;
grant execute on function public.finalize_channel_draft_ani1538(uuid,uuid,uuid,text,integer,jsonb,text,jsonb,uuid[]) to service_role;
-- Rollback (only when not in use): drop function public.finalize_channel_draft_ani1538(uuid,uuid,uuid,text,integer,jsonb,text,jsonb,uuid[]);
