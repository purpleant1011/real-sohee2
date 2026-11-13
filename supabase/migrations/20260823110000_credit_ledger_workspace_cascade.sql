create or replace function private.prevent_credit_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (
       select 1
       from public.workspaces
       where id = old.workspace_id
     ) then
    return old;
  end if;

  raise exception 'CREDIT_LEDGER_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

revoke execute on function private.prevent_credit_ledger_mutation()
from public, anon, authenticated, service_role;
