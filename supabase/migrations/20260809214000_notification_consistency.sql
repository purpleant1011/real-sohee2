alter table public.notifications add column if not exists event_key text;

create unique index if not exists notifications_workspace_user_event_key_key
  on public.notifications (workspace_id, user_id, event_key)
  where event_key is not null;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
