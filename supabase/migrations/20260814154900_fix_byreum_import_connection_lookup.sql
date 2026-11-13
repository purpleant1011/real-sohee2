do $migration$
declare
  function_signature regprocedure := 'public.import_byreum_campaign_pair(uuid,uuid,text,text,text[],text,text[],text,uuid[],uuid)'::regprocedure;
  definition text;
begin
  select pg_catalog.pg_get_functiondef(function_signature) into definition;

  if pg_catalog.strpos(definition, 'select min(id) into instagram_connection_id') = 0
    or pg_catalog.strpos(definition, 'select min(id) into threads_connection_id') = 0 then
    raise exception 'BYREUM_IMPORT_FUNCTION_SHAPE_UNEXPECTED';
  end if;

  definition := pg_catalog.replace(
    definition,
    E'select min(id) into instagram_connection_id\n  from public.channel_connections\n  where workspace_id = p_workspace_id and channel = ''instagram'' and status = ''connected'';',
    E'select id into instagram_connection_id\n  from public.channel_connections\n  where workspace_id = p_workspace_id and channel = ''instagram'' and status = ''connected''\n  order by id\n  limit 1;'
  );
  definition := pg_catalog.replace(
    definition,
    E'select min(id) into threads_connection_id\n  from public.channel_connections\n  where workspace_id = p_workspace_id and channel = ''threads'' and status = ''connected'';',
    E'select id into threads_connection_id\n  from public.channel_connections\n  where workspace_id = p_workspace_id and channel = ''threads'' and status = ''connected''\n  order by id\n  limit 1;'
  );

  execute definition;
  notify pgrst, 'reload schema';
end;
$migration$;
