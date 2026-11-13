create function public.preview_v08_automation_budget(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_scheduled_for timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.automation_rules%rowtype;
  v_account public.credit_accounts%rowtype;
  v_per_run_cap integer;
  v_daily_cap integer;
  v_weekly_cap integer;
  v_day_start timestamptz;
  v_week_start timestamptz;
  v_daily_usage integer := 0;
  v_weekly_usage integer := 0;
  v_available integer := 0;
begin
  select * into v_rule
  from public.automation_rules
  where workspace_id = p_workspace_id
    and id = p_rule_id
    and active
    and kind in ('daily_performance_report', 'twice_daily_performance_report', 'weekly_plan_proposal');
  if not found or p_scheduled_for is null
    or jsonb_typeof(v_rule.configuration -> 'perRunCreditCap') <> 'number'
    or jsonb_typeof(v_rule.configuration -> 'dailyCreditCap') <> 'number'
    or jsonb_typeof(v_rule.configuration -> 'weeklyCreditCap') <> 'number' then
    return jsonb_build_object('allowed', false, 'reason', 'balance');
  end if;

  v_per_run_cap := (v_rule.configuration ->> 'perRunCreditCap')::integer;
  v_daily_cap := (v_rule.configuration ->> 'dailyCreditCap')::integer;
  v_weekly_cap := (v_rule.configuration ->> 'weeklyCreditCap')::integer;
  if v_per_run_cap < 1 then return jsonb_build_object('allowed', false, 'reason', 'per_run_cap'); end if;
  if v_daily_cap < v_per_run_cap or v_weekly_cap < v_daily_cap then return jsonb_build_object('allowed', false, 'reason', 'balance'); end if;

  select * into v_account
  from public.credit_accounts
  where id = private.ensure_v08_preview_credit_account(p_workspace_id, p_scheduled_for);
  if not found then return jsonb_build_object('allowed', false, 'reason', 'balance'); end if;

  v_day_start := date_trunc('day', p_scheduled_for at time zone v_rule.timezone) at time zone v_rule.timezone;
  v_week_start := date_trunc('week', p_scheduled_for at time zone v_rule.timezone) at time zone v_rule.timezone;

  select coalesce(sum(case
    when reservation.state = 'reserved' then reservation.requested_credits - reservation.released_credits
    when reservation.state = 'settled' then reservation.settled_credits
    else 0
  end), 0) into v_daily_usage
  from public.credit_reservations as reservation
  where reservation.workspace_id = p_workspace_id and reservation.account_id = v_account.id
    and reservation.action = 'performance_report'
    and reservation.created_at >= v_day_start and reservation.created_at < v_day_start + interval '1 day';

  select coalesce(sum(case
    when reservation.state = 'reserved' then reservation.requested_credits - reservation.released_credits
    when reservation.state = 'settled' then reservation.settled_credits
    else 0
  end), 0) into v_weekly_usage
  from public.credit_reservations as reservation
  where reservation.workspace_id = p_workspace_id and reservation.account_id = v_account.id
    and reservation.action = 'performance_report'
    and reservation.created_at >= v_week_start and reservation.created_at < v_week_start + interval '7 days';

  select coalesce(sum(amount) filter (where kind = 'grant'), 0)
      + coalesce(sum(amount) filter (where kind = 'adjustment'), 0)
      + coalesce(sum(amount) filter (where kind = 'release'), 0)
      - coalesce(sum(amount) filter (where kind = 'consume'), 0)
      - coalesce(sum(amount) filter (where kind = 'reserve'), 0)
  into v_available
  from public.credit_ledger_entries
  where workspace_id = p_workspace_id and account_id = v_account.id;

  if v_daily_usage + 1 > v_daily_cap then return jsonb_build_object('allowed', false, 'reason', 'daily_cap'); end if;
  if v_weekly_usage + 1 > v_weekly_cap then return jsonb_build_object('allowed', false, 'reason', 'weekly_cap'); end if;
  if v_available < 1 then return jsonb_build_object('allowed', false, 'reason', 'balance'); end if;
  return jsonb_build_object('allowed', true, 'reason', null);
end;
$$;

revoke all on function public.preview_v08_automation_budget(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.preview_v08_automation_budget(uuid, uuid, timestamptz) to service_role;
