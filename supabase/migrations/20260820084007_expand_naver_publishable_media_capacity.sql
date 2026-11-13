do $$
declare
  definition text;
  previous_rule constant text := 'if media_count > 10 or (content_channel <> ''threads'' and media_count < 1) then';
  channel_rule constant text := 'if media_count > (case when content_channel = ''naver_blog'' then 20 else 10 end)'
    || chr(10) || '    or (content_channel <> ''threads'' and media_count < 1) then';
begin
  select pg_get_functiondef(
    'private.is_content_version_publishable(uuid,uuid)'::regprocedure
  ) into definition;

  if position(channel_rule in definition) > 0 then
    return;
  end if;
  if position(previous_rule in definition) = 0 then
    raise exception 'is_content_version_publishable media limit contract changed';
  end if;

  execute replace(definition, previous_rule, channel_rule);
end;
$$;
