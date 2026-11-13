create or replace function private.ensure_workspace_weekly_entitlement(
  p_workspace_id uuid,
  p_at timestamptz default statement_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period record;
  v_policy record;
  v_account_id uuid;
  v_existing_allowance integer := 0;
  v_entry_kind text;
  v_entry_amount integer;
  v_grant_key text;
begin
  select * into v_period from private.v08_preview_credit_period(p_at);
  select * into v_policy from private.resolve_workspace_weekly_credit_policy(p_workspace_id, p_at);

  if v_policy.policy_version is null or v_policy.weekly_credits is null then
    raise exception 'CREDIT_POLICY_UNAVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.credit_accounts (workspace_id, period_start, period_end, timezone)
  values (p_workspace_id, v_period.period_start, v_period.period_end, v_period.period_timezone)
  on conflict (workspace_id, period_start, period_end) do nothing
  returning id into v_account_id;

  if v_account_id is null then
    select id into v_account_id
    from public.credit_accounts
    where workspace_id = p_workspace_id
      and period_start = v_period.period_start
      and period_end = v_period.period_end;
  end if;

  if v_account_id is null then
    raise exception 'CREDIT_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount) filter (
    where kind = 'grant'
      or (kind = 'adjustment' and idempotency_key like '%:allowance')
  ), 0)
  into v_existing_allowance
  from public.credit_ledger_entries
  where workspace_id = p_workspace_id and account_id = v_account_id;

  if v_existing_allowance > v_policy.weekly_credits then
    raise exception 'CREDIT_ENTITLEMENT_PERIOD_CONFLICT' using errcode = 'P0001';
  end if;

  if v_existing_allowance < v_policy.weekly_credits then
    v_entry_kind := case when v_existing_allowance = 0 then 'grant' else 'adjustment' end;
    v_entry_amount := v_policy.weekly_credits - v_existing_allowance;
    v_grant_key := v_policy.policy_version || ':' || v_period.period_start::text || ':allowance';
    insert into public.credit_ledger_entries (
      workspace_id, account_id, reservation_id, kind, action, amount, idempotency_key
    ) values (
      p_workspace_id, v_account_id, null, v_entry_kind, null, v_entry_amount, v_grant_key
    ) on conflict (workspace_id, idempotency_key, kind) do nothing;
  end if;

  return v_account_id;
end;
$$;

revoke all on function private.ensure_workspace_weekly_entitlement(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function private.ensure_workspace_weekly_entitlement(uuid, timestamptz)
to service_role;
