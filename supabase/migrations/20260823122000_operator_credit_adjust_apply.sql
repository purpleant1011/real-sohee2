alter table public.credit_accounts
  add column if not exists version integer not null default 1;
alter table public.credit_accounts
  add constraint credit_accounts_version_check check (version > 0);

alter table public.platform_audit_events
  drop constraint if exists platform_audit_events_action_check;
alter table public.platform_audit_events
  add constraint platform_audit_events_action_check check (action in (
    'agreement.verify.requested', 'agreement.verify.approved',
    'channel.disconnect.requested', 'channel.disconnect.approved',
    'publish.retry.requested', 'publish.retry.approved', 'publish.retry.applied',
    'credit.adjust.requested', 'credit.adjust.approved', 'credit.adjust.applied',
    'admin.role.change.workspace.requested', 'admin.role.change.workspace.approved',
    'admin.role.change.global.requested', 'admin.role.change.global.approved',
    'audit.export.workspace.requested', 'audit.export.workspace.approved',
    'audit.export.global.requested', 'audit.export.global.approved',
    'admin.account.activated', 'workspace.activation.requested',
    'document.version.draft_created', 'document.version.reviewed', 'document.version.activated'
  ));

create or replace function public.apply_approved_credit_adjustment(p_approval_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_current_operator_aal2_actor();
  request_row public.admin_approval_requests%rowtype;
  account_row public.credit_accounts%rowtype;
  existing_entry_id uuid;
  ledger_entry_id uuid;
  adjustment_amount integer;
  next_version integer;
  adjustment_key text;
  audit_key text;
  replay_summary jsonb;
  replay_ledger_id uuid;
  replay_version integer;
begin
  if p_approval_request_id is null then raise exception 'BILLING_INPUT_INVALID'; end if;
  if not exists (select 1 from public.platform_admin_members where user_id = actor_id and status = 'active') then
    raise exception 'OPERATOR_DISABLED';
  end if;

  select * into request_row
  from public.admin_approval_requests
  where id = p_approval_request_id
  for update;
  if not found or request_row.action_type <> 'credit.adjust' then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if not private.has_platform_permission('credit.adjust.approve', request_row.workspace_id) then raise exception 'PERMISSION_DENIED'; end if;
  if request_row.target_type <> 'credit_account' or request_row.expected_version is null then raise exception 'BILLING_INPUT_INVALID'; end if;
  if jsonb_typeof(request_row.request_payload) <> 'object'
    or (select count(*) from jsonb_object_keys(request_row.request_payload)) <> 3
    or not request_row.request_payload ?& array['direction', 'amount', 'reason_code']
    or request_row.request_payload ->> 'direction' not in ('credit', 'debit')
    or request_row.request_payload ->> 'reason_code' not in ('billing_correction', 'service_recovery', 'manual_promotion')
    or jsonb_typeof(request_row.request_payload -> 'amount') <> 'number'
    or request_row.request_payload ->> 'amount' !~ '^[0-9]{1,6}$'
  then raise exception 'BILLING_INPUT_INVALID'; end if;
  adjustment_amount := (request_row.request_payload ->> 'amount')::integer;
  if adjustment_amount not between 1 and 100000 then raise exception 'BILLING_INPUT_INVALID'; end if;
  if request_row.request_payload ->> 'direction' = 'debit' then adjustment_amount := -adjustment_amount; end if;

  select * into account_row
  from public.credit_accounts
  where workspace_id = request_row.workspace_id and id = request_row.target_id::uuid
  for update;
  if not found then raise exception 'BILLING_ACCOUNT_NOT_FOUND'; end if;

  adjustment_key := encode(extensions.digest('approved-credit-adjust:' || request_row.id::text, 'sha256'), 'hex');
  if request_row.status = 'applied' then
    replay_summary := request_row.result_summary;
    replay_ledger_id := case when (select count(*) from jsonb_object_keys(replay_summary)) = 2 and replay_summary ?& array['ledger_entry_id', 'account_version'] and (replay_summary ->> 'ledger_entry_id') ~ '^[0-9a-f-]{36}$' then (replay_summary ->> 'ledger_entry_id')::uuid else null end;
    replay_version := case when replay_summary ? 'account_version' and jsonb_typeof(replay_summary -> 'account_version') = 'number' then (replay_summary ->> 'account_version')::integer else null end;
    if replay_ledger_id is null or replay_version is null or replay_version < 1 then raise exception 'BILLING_WRITE_UNAVAILABLE'; end if;
    if not exists (select 1 from public.credit_ledger_entries where id = replay_ledger_id and workspace_id = account_row.workspace_id and account_id = account_row.id and kind = 'adjustment' and idempotency_key = adjustment_key) then raise exception 'BILLING_WRITE_UNAVAILABLE'; end if;
    return jsonb_build_object('ledger_entry_id', replay_ledger_id, 'account_version', replay_version, 'status', 'applied');
  end if;

  if request_row.status <> 'approved' then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if statement_timestamp() >= request_row.expires_at then raise exception 'APPROVAL_EXPIRED'; end if;
  if account_row.version <> request_row.expected_version then raise exception 'BILLING_ACCOUNT_VERSION_CONFLICT'; end if;

  insert into public.credit_ledger_entries (
    workspace_id, account_id, kind, action, amount, idempotency_key
  ) values (
    account_row.workspace_id, account_row.id, 'adjustment', null, adjustment_amount, adjustment_key
  ) returning id into ledger_entry_id;

  next_version := account_row.version + 1;
  update public.credit_accounts
  set version = next_version
  where id = account_row.id and workspace_id = account_row.workspace_id and version = request_row.expected_version;
  if not found then raise exception 'BILLING_ACCOUNT_VERSION_CONFLICT'; end if;

  update public.admin_approval_requests
  set status = 'applied', applied_at = statement_timestamp(),
      result_summary = jsonb_build_object('ledger_entry_id', ledger_entry_id, 'account_version', next_version)
  where id = request_row.id;

  audit_key := encode(extensions.digest('credit-adjust-applied:' || request_row.id::text, 'sha256'), 'hex');
  perform private.append_platform_audit_event(
    actor_id, account_row.workspace_id, 'credit.adjust.applied', 'credit_account',
    account_row.id::text, request_row.reason, request_row.id::text, 'succeeded',
    jsonb_build_object('version', account_row.version, 'direction', request_row.request_payload ->> 'direction', 'amount', abs(adjustment_amount), 'reason_code', request_row.request_payload ->> 'reason_code'),
    jsonb_build_object('version', next_version, 'direction', request_row.request_payload ->> 'direction', 'amount', abs(adjustment_amount), 'reason_code', request_row.request_payload ->> 'reason_code'),
    audit_key, 'observed', request_row.id, null
  );
  return jsonb_build_object('ledger_entry_id', ledger_entry_id, 'account_version', next_version, 'status', 'applied');
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'APPROVAL_NOT_FOUND', 'APPROVAL_STATE_CONFLICT', 'APPROVAL_EXPIRED', 'BILLING_INPUT_INVALID', 'BILLING_ACCOUNT_NOT_FOUND', 'BILLING_ACCOUNT_VERSION_CONFLICT') then raise; end if;
  raise exception 'BILLING_WRITE_UNAVAILABLE';
end;
$$;

revoke all on function public.apply_approved_credit_adjustment(uuid) from public, anon, service_role;
grant execute on function public.apply_approved_credit_adjustment(uuid) to authenticated;

create or replace function public.list_operator_billing_overview(
  p_workspace_id uuid default null,
  p_limit integer default 100
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid()); claims jsonb := (select auth.jwt()); rows jsonb; row_count integer;
  summary_source_timestamp timestamptz; observed_at timestamptz := statement_timestamp();
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'BILLING_INPUT_INVALID'; end if;
  if actor_id is null or claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true) then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if p_workspace_id is not null and not private.has_platform_permission('billing.read', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;
  if p_workspace_id is null and not exists (select 1 from public.platform_admin_role_assignments assignment join public.platform_role_permissions permission on permission.role_key = assignment.role_key where assignment.user_id = actor_id and permission.permission_key = 'billing.read') then raise exception 'OPERATOR_PERMISSION_DENIED'; end if;
  with selected as (
    select workspace.id, workspace.name, workspace.updated_at as workspace_updated_at,
      entitlement.plan_code, entitlement.policy_version, entitlement.effective_from, entitlement.effective_until,
      plan_version.weekly_credits, account.id as account_id, account.version as account_version, account.period_start, account.period_end,
      account.created_at as account_created_at, ledger.granted, ledger.adjustments, ledger.released, ledger.consumed, ledger.reserved,
      ledger.source_timestamp as ledger_source_timestamp, checkout.state as payment_state, checkout.updated_at as payment_updated_at,
      checkout.provider_reference is not null as provider_reference_present, usage.usage_event_count, usage.computed_credits,
      usage.actual_usage_count, usage.estimated_usage_count, usage.source_timestamp as usage_source_timestamp,
      greatest(entitlement.effective_from, account.created_at, ledger.source_timestamp, checkout.updated_at, usage.source_timestamp) as source_timestamp
    from public.workspaces workspace
    left join lateral (select e.plan_code, e.policy_version, e.effective_from, e.effective_until from public.workspace_billing_entitlements e where e.workspace_id = workspace.id and e.state = 'active' and e.effective_from <= observed_at and (e.effective_until is null or e.effective_until > observed_at) order by e.effective_from desc limit 1) entitlement on true
    left join public.billing_plan_entitlement_versions plan_version on plan_version.plan_code = entitlement.plan_code and plan_version.policy_version = entitlement.policy_version and plan_version.policy_status = 'active'
    left join public.credit_accounts account on account.workspace_id = workspace.id
    left join lateral (select sum(entry.amount) filter (where entry.kind = 'grant')::integer as granted, sum(entry.amount) filter (where entry.kind = 'adjustment')::integer as adjustments, sum(entry.amount) filter (where entry.kind = 'release')::integer as released, sum(entry.amount) filter (where entry.kind = 'consume')::integer as consumed, sum(entry.amount) filter (where entry.kind = 'reserve')::integer as reserved, max(entry.occurred_at) as source_timestamp from public.credit_ledger_entries entry where entry.workspace_id = workspace.id and entry.account_id = account.id) ledger on true
    left join lateral (select c.state, c.updated_at, c.provider_reference from public.checkout_intents c where c.workspace_id = workspace.id order by c.updated_at desc, c.created_at desc limit 1) checkout on true
    left join lateral (select nullif(count(*)::integer, 0) as usage_event_count, sum(event.computed_credits)::integer as computed_credits, nullif(count(*) filter (where event.usage_source = 'actual')::integer, 0) as actual_usage_count, nullif(count(*) filter (where event.usage_source = 'estimated_missing_usage')::integer, 0) as estimated_usage_count, max(event.occurred_at) as source_timestamp from public.ai_usage_events event where event.workspace_id = workspace.id) usage on true
    where (p_workspace_id is null or workspace.id = p_workspace_id) and private.has_platform_permission('billing.read', workspace.id)
    order by workspace.updated_at desc, workspace.id desc limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', selected.id, 'workspace_name', selected.name,
    'entitlement', jsonb_build_object('state', case when selected.plan_code is null then 'empty' else 'fresh' end, 'plan_code', selected.plan_code, 'policy_version', selected.policy_version, 'weekly_limit', selected.weekly_credits, 'effective_from', selected.effective_from, 'effective_until', selected.effective_until, 'source_timestamp', selected.effective_from),
    'balance', jsonb_build_object('state', case when selected.account_id is null then 'empty' else 'fresh' end, 'version', selected.account_version, 'period_start', selected.period_start, 'period_end', selected.period_end, 'granted', selected.granted, 'adjustments', selected.adjustments, 'released', selected.released, 'consumed', selected.consumed, 'reserved', selected.reserved, 'available', case when selected.account_id is null then null else coalesce(selected.granted, 0) + coalesce(selected.adjustments, 0) + coalesce(selected.released, 0) - coalesce(selected.consumed, 0) - coalesce(selected.reserved, 0) end, 'source_timestamp', selected.ledger_source_timestamp),
    'payment', jsonb_build_object('state', case when selected.payment_state is null then 'empty' else 'fresh' end, 'latest_state', selected.payment_state, 'provider_reference_present', coalesce(selected.provider_reference_present, false), 'updated_at', selected.payment_updated_at),
    'usage', jsonb_build_object('state', case when selected.usage_event_count is null or selected.usage_event_count = 0 then 'empty' else 'fresh' end, 'usage_event_count', selected.usage_event_count, 'computed_credits', selected.computed_credits, 'actual_usage_count', selected.actual_usage_count, 'estimated_usage_count', selected.estimated_usage_count, 'source_timestamp', selected.usage_source_timestamp),
    'cost', jsonb_build_object('state', 'unknown', 'api_cost_krw', null, 'reason', 'NOT_MEASURED'),
    'freshness', jsonb_build_object('state', case when selected.source_timestamp is null then 'unknown' when selected.source_timestamp >= observed_at - interval '24 hours' then 'fresh' else 'stale' end, 'source_timestamp', selected.source_timestamp)
  ) order by selected.workspace_updated_at desc, selected.id desc), '[]'::jsonb), count(*), max(selected.source_timestamp) into rows, row_count, summary_source_timestamp from selected;
  return jsonb_build_object('items', rows, 'summary', jsonb_build_object('state', case when row_count = 0 then 'empty' when summary_source_timestamp is null then 'unknown' when summary_source_timestamp >= observed_at - interval '24 hours' then 'fresh' else 'stale' end, 'workspace_count', case when row_count = 0 then null else row_count end, 'source_timestamp', summary_source_timestamp));
exception when others then
  if sqlerrm in ('BILLING_INPUT_INVALID', 'OPERATOR_UNAUTHENTICATED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'OPERATOR_SCOPE_DENIED', 'OPERATOR_PERMISSION_DENIED', 'BILLING_SCOPE_DENIED', 'BILLING_READ_UNAVAILABLE') then raise; end if;
  raise exception 'BILLING_READ_UNAVAILABLE';
end;
$$;
