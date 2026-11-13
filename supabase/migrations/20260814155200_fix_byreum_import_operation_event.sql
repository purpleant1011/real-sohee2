do $migration$
declare
  function_signature regprocedure := 'public.import_byreum_campaign_pair(uuid,uuid,text,text,text[],text,text[],text,uuid[],uuid)'::regprocedure;
  definition text;
begin
  select pg_catalog.pg_get_functiondef(function_signature) into definition;

  if pg_catalog.strpos(definition, '''content.publish_requested''') = 0 then
    raise exception 'BYREUM_IMPORT_FUNCTION_SHAPE_UNEXPECTED';
  end if;

  definition := pg_catalog.replace(
    definition,
    '''content.publish_requested''',
    '''schedule.confirmed'''
  );
  execute definition;
  notify pgrst, 'reload schema';
end;
$migration$;
