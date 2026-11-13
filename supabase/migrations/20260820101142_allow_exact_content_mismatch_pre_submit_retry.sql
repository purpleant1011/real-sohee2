do $$
declare
  definition text;
  previous_request_rule constant text := 'and candidate.failure_code = ''UI_DRIFT''';
  next_request_rule constant text := 'and candidate.failure_code in (''UI_DRIFT'', ''CONTENT_MISMATCH'')';
  previous_attempt_rule constant text := 'and attempt.failure_code = ''UI_DRIFT''';
  next_attempt_rule constant text := 'and attempt.failure_code in (''UI_DRIFT'', ''CONTENT_MISMATCH'')';
begin
  select pg_get_functiondef(
    'public.retry_local_publish_before_submit(uuid,uuid,uuid)'::regprocedure
  ) into definition;

  if position(next_request_rule in definition) > 0
    and position(next_attempt_rule in definition) > 0 then
    return;
  end if;
  if position(previous_request_rule in definition) = 0
    or position(previous_attempt_rule in definition) = 0 then
    raise exception 'retry_local_publish_before_submit failure contract changed';
  end if;

  execute replace(
    replace(definition, previous_request_rule, next_request_rule),
    previous_attempt_rule, next_attempt_rule
  );
end;
$$;
