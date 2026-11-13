do $migration$
begin
  if to_regclass('public.messages') is not null then
    grant insert (completed_at) on public.messages to authenticated;
  end if;
end
$migration$;
