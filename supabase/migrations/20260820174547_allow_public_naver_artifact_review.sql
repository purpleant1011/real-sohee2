do $$
declare
  definition text;
  previous_rule constant text := 'payload ->> ''visibility'' is distinct from ''private''';
  exact_rule constant text := 'coalesce(payload ->> ''visibility'', '''') not in (''private'', ''public'')';
begin
  select pg_get_functiondef(
    'private.save_conversation_artifact_to_work_internal(uuid,uuid)'::regprocedure
  ) into definition;
  if position(exact_rule in definition) > 0 then
    return;
  end if;
  if position(previous_rule in definition) = 0 then
    raise exception 'Naver artifact visibility contract changed';
  end if;
  execute replace(definition, previous_rule, exact_rule);
end;
$$;
