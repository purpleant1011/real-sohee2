do $$
declare
  definition text;
  previous_statement constant text := 'payload := artifact.structured_payload || jsonb_build_object(''imagePlacements'', image_placements);';
  publish_statement constant text := 'payload := (artifact.structured_payload - ''editorBlueprint'') || jsonb_build_object(''imagePlacements'', image_placements);';
begin
  select pg_get_functiondef(
    'private.save_conversation_artifact_to_work_internal(uuid,uuid)'::regprocedure
  ) into definition;
  if position(publish_statement in definition) > 0 then
    return;
  end if;
  if position(previous_statement in definition) = 0 then
    raise exception 'save_conversation_artifact_to_work_internal payload contract changed';
  end if;
  execute replace(definition, previous_statement, publish_statement);
end;
$$;
