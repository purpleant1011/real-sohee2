alter table public.content_version_media
  drop constraint content_version_media_position_check,
  add constraint content_version_media_position_check
  check (position between 0 and 19);

alter table public.content_plan_entries
  drop constraint content_plan_entries_images_per_post_check,
  add constraint content_plan_entries_images_per_post_check
  check (images_per_post between 0 and (
    case when channel = 'naver_blog' then 20 else 10 end
  ));

do $$
declare
  definition text;
  previous_rule constant text := 'if media_count > 10 or (content_channel <> ''threads'' and media_count < 1) then';
  channel_rule constant text := 'if media_count > (case when content_channel = ''naver_blog'' then 20 else 10 end)'
    || chr(10) || '    or (content_channel <> ''threads'' and media_count < 1) then';
begin
  select pg_get_functiondef(
    'private.create_content_version_internal(uuid,uuid,text,text[],text,jsonb)'::regprocedure
  ) into definition;

  if position(channel_rule in definition) > 0 then
    return;
  end if;

  if position(previous_rule in definition) = 0 then
    raise exception 'create_content_version_internal media limit contract changed';
  end if;

  execute replace(definition, previous_rule, channel_rule);
end;
$$;
