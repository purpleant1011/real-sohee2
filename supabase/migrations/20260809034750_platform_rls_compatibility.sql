-- Supabase stopped installing this helper automatically when new tables stopped
-- being exposed to the Data API by default. Keep the historical hardening
-- migration reproducible without changing that already-shipped migration.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  command record;
begin
  for command in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if command.schema_name = 'public' then
      execute format(
        'alter table if exists %s enable row level security',
        command.object_identity
      );
    end if;
  end loop;
end;
$$;
