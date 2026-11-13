do $migration$
declare
  function_signature regprocedure := 'public.import_byreum_campaign_pair(uuid,uuid,text,text,text[],text,text[],text,uuid[],uuid)'::regprocedure;
  definition text;
begin
  select pg_catalog.pg_get_functiondef(function_signature) into definition;

  if pg_catalog.strpos(definition, 'event_key text :=') = 0
    or pg_catalog.strpos(definition, 'operation_events.event_key = event_key') = 0
    or pg_catalog.strpos(definition, 'pg_catalog.hashtextextended(p_workspace_id::text || '':'' || event_key, 0)') = 0 then
    raise exception 'BYREUM_IMPORT_FUNCTION_SHAPE_UNEXPECTED';
  end if;

  definition := pg_catalog.replace(definition, 'event_key text :=', 'import_event_key text :=');
  definition := pg_catalog.replace(
    definition,
    'pg_catalog.hashtextextended(p_workspace_id::text || '':'' || event_key, 0)',
    'pg_catalog.hashtextextended(p_workspace_id::text || '':'' || import_event_key, 0)'
  );
  definition := pg_catalog.replace(
    definition,
    'operation_events.event_key = event_key',
    'operation_events.event_key = import_event_key'
  );
  definition := pg_catalog.replace(
    definition,
    E'    event_key,\n    ''content_item'',',
    E'    import_event_key,\n    ''content_item'','
  );

  execute definition;
end;
$migration$;
