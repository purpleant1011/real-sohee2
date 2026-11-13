do $$
declare
  definition text;
  previous_rule constant text := 'in (''UI_DRIFT'', ''CONTENT_MISMATCH'')';
  next_rule constant text := 'in (''UI_DRIFT'', ''CONTENT_MISMATCH'', ''DEVICE_OFFLINE'')';
begin
  select pg_get_functiondef(
    'public.retry_local_publish_before_submit(uuid,uuid,uuid)'::regprocedure
  ) into definition;

  if position(next_rule in definition) > 0 then return; end if;
  if position(previous_rule in definition) = 0 then
    raise exception 'retry_local_publish_before_submit retryable failure contract changed';
  end if;

  execute replace(definition, previous_rule, next_rule);
end;
$$;
