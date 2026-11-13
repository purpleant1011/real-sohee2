-- Migration: 20261009040000_admin_formal_member_overview.sql
-- Description: Authoritative formal member overview, operator list overload, and bulk credit grant alignment.
-- Policy: "진짜 회원은 사업자 회원. 사업자 인증을 받았거나, 인스타·스레드를 연결했거나, 요금제를 결제한 곳만 회원(정회원)으로 인정. 구글 로그인만 한 가입자는 회원이 아님."

-- 1. Authoritative workspace membership overview function (service_role only)
create or replace function public.workspace_membership_overview()
returns table(
  workspace_id uuid,
  is_formal boolean,
  via_business boolean,
  via_sns boolean,
  via_paid boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  with evaluated as (
    select
      w.id as ws_id,
      exists (
        select 1 from public.business_verifications bv
        where bv.workspace_id = w.id and bv.status = 'VERIFIED'
      ) as v_business,
      exists (
        select 1 from public.channel_connections cc
        where cc.workspace_id = w.id
          and lower(cc.channel) in ('instagram', 'threads')
          and cc.status in ('connected', 'verified')
          and cc.account_label is not null
          and btrim(cc.account_label) <> ''
      ) as v_sns,
      (
        exists (
          select 1 from public.workspace_credit_states cs
          where cs.workspace_id = w.id
            and (cs.purchased_credits > 0 or cs.commercial_state = 'ACTIVE')
        )
        or exists (
          select 1 from public.workspace_billing_entitlements wbe
          where wbe.workspace_id = w.id
            and wbe.state = 'active'
            and wbe.plan_code in ('growth', 'operations', 'focus')
            and wbe.effective_from <= statement_timestamp()
            and (wbe.effective_until is null or wbe.effective_until > statement_timestamp())
        )
        or exists (
          select 1 from public.workspace_entitlements we
          where we.workspace_id = w.id
            and we.status = 'ACTIVE'
            and we.source = 'PAYMENT_VERIFIED'
            and (we.expires_at is null or we.expires_at > statement_timestamp())
        )
      ) as v_paid
    from public.workspaces w
  )
  select
    e.ws_id as workspace_id,
    (e.v_business or e.v_sns or e.v_paid) as is_formal,
    e.v_business as via_business,
    e.v_sns as via_sns,
    e.v_paid as via_paid
  from evaluated e;
end;
$$;

revoke all on function public.workspace_membership_overview() from public, anon, authenticated;
grant execute on function public.workspace_membership_overview() to service_role;

-- 2. Replace list_operator_workspaces with unified 7-parameter signature (default null for p_member_filter)
-- Drop existing 6-parameter signature to prevent PostgREST/RPC 'function is not unique' ambiguity.
drop function if exists public.list_operator_workspaces(timestamptz, uuid, text, text, text, integer);

create or replace function public.list_operator_workspaces(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_fingerprint text default null,
  p_query text default null,
  p_status text default null,
  p_limit integer default 50,
  p_member_filter text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  normalized_query text := nullif(btrim(p_query), '');
  scope_fingerprint text;
  scope_is_all boolean;
  scope_ids uuid[];
  row_data jsonb;
  next_cursor jsonb;
  selected_count integer;
  last_created_at timestamptz;
  last_id uuid;
begin
  if actor_id is null or claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'AUTH_REQUIRED'; end if;
  if private.operator_mfa_required(actor_id) and claims ->> 'aal' is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not exists (
    select 1 from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'workspace.read'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if p_status is not null and p_status not in ('applied','information_pending','contract_review','consent_pending','channel_pending','payment_pending','ready_for_activation','active','paused','terminated') then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if normalized_query is not null and char_length(normalized_query) > 120 then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if p_member_filter is not null and p_member_filter not in ('formal', 'applicant', 'all') then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) or (p_cursor_created_at is null) <> (p_cursor_fingerprint is null) then raise exception 'CURSOR_INVALID'; end if;

  scope_is_all := exists (
    select 1 from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'workspace.read' and assignment.workspace_id is null
  );
  select coalesce(array_agg(distinct assignment.workspace_id order by assignment.workspace_id), '{}'::uuid[])
    into scope_ids
  from public.platform_admin_role_assignments assignment
  join public.platform_role_permissions permission on permission.role_key = assignment.role_key
  where assignment.user_id = actor_id and permission.permission_key = 'workspace.read' and assignment.workspace_id is not null;

  scope_fingerprint := encode(extensions.digest((jsonb_build_object(
    'query', normalized_query,
    'status', p_status,
    'member_filter', coalesce(p_member_filter, 'all'),
    'scope', case when scope_is_all then '"all"'::jsonb else to_jsonb(scope_ids) end
  ))::text, 'sha256'), 'hex');
  if p_cursor_fingerprint is not null and p_cursor_fingerprint <> scope_fingerprint then raise exception 'CURSOR_INVALID'; end if;

  with selected as (
    select workspace.id, workspace.created_at, overview.is_formal
    from public.workspaces workspace
    left join public.workspace_lifecycles lifecycle on lifecycle.workspace_id = workspace.id
    left join public.business_profiles profile on profile.workspace_id = workspace.id
    join public.workspace_membership_overview() overview on overview.workspace_id = workspace.id
    where workspace.workspace_kind <> 'integration'
      and (scope_is_all or workspace.id = any(scope_ids))
      and (normalized_query is null or position(lower(normalized_query) in lower(workspace.name)) > 0 or position(lower(normalized_query) in lower(coalesce(profile.business_name, ''))) > 0)
      and (p_status is null or lifecycle.status = p_status)
      and (
        p_member_filter is null
        or p_member_filter = 'all'
        or (p_member_filter = 'formal' and overview.is_formal)
        or (p_member_filter = 'applicant' and not overview.is_formal)
      )
      and (p_cursor_created_at is null or workspace.created_at < p_cursor_created_at or (workspace.created_at = p_cursor_created_at and workspace.id < p_cursor_id))
    order by workspace.created_at desc, workspace.id desc
    limit p_limit + 1
  ), page as (
    select * from selected order by created_at desc, id desc limit p_limit
  )
  select
    coalesce(jsonb_agg(
      (private.operator_workspace_admin_projection(page.id) || jsonb_build_object(
        'member_status', case when page.is_formal then 'FORMAL' else 'APPLICANT' end
      ))
      order by page.created_at desc, page.id desc
    ), '[]'::jsonb),
    (select count(*)::integer from selected),
    (select page.created_at from page order by page.created_at desc, page.id desc offset p_limit - 1 limit 1),
    (select page.id from page order by page.created_at desc, page.id desc offset p_limit - 1 limit 1)
  into row_data, selected_count, last_created_at, last_id
  from page;

  next_cursor := case when selected_count > p_limit then jsonb_build_object('created_at', last_created_at, 'id', last_id, 'cursor_fingerprint', scope_fingerprint) else null end;
  return jsonb_build_object('items', row_data, 'next_cursor', next_cursor);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED','MFA_REQUIRED','OPERATOR_DISABLED','PERMISSION_DENIED','OPERATOR_SCOPE_DENIED','WORKSPACE_INPUT_INVALID','CURSOR_INVALID') then raise; end if;
  raise exception 'WORKSPACE_LIST_UNAVAILABLE';
end;
$$;

revoke all on function public.list_operator_workspaces(timestamptz, uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.list_operator_workspaces(timestamptz, uuid, text, text, text, integer, text) to authenticated, service_role;

-- 3. Update preview_bulk_credit_grant & grant_bulk_credits to target ONLY formal members
create or replace function public.preview_bulk_credit_grant(p_audience text, p_recent_days integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_audience not in ('all_active', 'recent_signups') or p_audience is null
     or (p_audience = 'all_active' and p_recent_days is not null)
     or (p_audience = 'recent_signups' and (p_recent_days is null or p_recent_days not between 1 and 30)) then
    raise exception 'BULK_GRANT_INPUT_INVALID' using errcode = 'P0001';
  end if;
  with eligible as materialized (
    select distinct on (w.id) w.id, w.name, w.created_at
    from public.workspaces w
    join public.business_profiles b on b.workspace_id = w.id
    join public.credit_accounts a on a.workspace_id = w.id
    join public.workspace_membership_overview() overview on overview.workspace_id = w.id and overview.is_formal = true
    left join public.workspace_lifecycles l on l.workspace_id = w.id
    where w.workspace_kind = 'production'
      and w.name not like '%쇼케이스%' and b.business_name not like '%쇼케이스%'
      and l.status is distinct from 'terminated'
      and (p_audience = 'all_active' or w.created_at >= statement_timestamp() - make_interval(days => p_recent_days))
    order by w.id, a.created_at desc, a.id desc
  ), sampled as (
    select name from eligible order by created_at desc, id desc limit 5
  )
  select jsonb_build_object('target_count', (select count(*) from eligible),
    'sample_names', coalesce((select jsonb_agg(name) from sampled), '[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.preview_bulk_credit_grant(text, integer) from public, anon, authenticated;
grant execute on function public.preview_bulk_credit_grant(text, integer) to service_role;

create or replace function public.grant_bulk_credits(
  p_operator_id uuid, p_audience text, p_recent_days integer,
  p_amount integer, p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  campaign public.credit_grant_campaigns%rowtype;
  target record;
  n integer := 0;
  skipped integer := 0;
  first_workspace uuid;
  entry_key text;
begin
  if p_operator_id is null or not exists (select 1 from public.platform_admin_members m where m.user_id = p_operator_id and m.status = 'active')
    or not exists (select 1 from public.platform_admin_role_assignments a
      join public.platform_role_permissions p on p.role_key = a.role_key
      where a.user_id = p_operator_id and p.permission_key = 'credit.adjust.approve'
        and a.workspace_id is null) then
    raise exception 'BULK_GRANT_OPERATOR_DENIED' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount not between 1 and 50000 or p_reason is null or length(btrim(p_reason)) not between 1 and 2000
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120 then
    raise exception 'BULK_GRANT_INPUT_INVALID' using errcode = 'P0001';
  end if;
  perform public.preview_bulk_credit_grant(p_audience, p_recent_days);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));
  select * into campaign from public.credit_grant_campaigns where idempotency_key = p_idempotency_key;
  if found then
    if campaign.created_by is distinct from p_operator_id or campaign.audience is distinct from p_audience
      or campaign.recent_days is distinct from p_recent_days or campaign.amount_per_workspace is distinct from p_amount
      or campaign.reason is distinct from btrim(p_reason) then
      raise exception 'BULK_GRANT_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object('campaign_id', campaign.id, 'target_count', campaign.target_count,
      'granted_count', campaign.granted_count, 'skipped_count', campaign.skipped_count);
  end if;
  for target in
    select distinct on (w.id) w.id as workspace_id, a.id as account_id
    from public.workspaces w
    join public.business_profiles b on b.workspace_id = w.id
    join public.credit_accounts a on a.workspace_id = w.id
    join public.workspace_membership_overview() overview on overview.workspace_id = w.id and overview.is_formal = true
    left join public.workspace_lifecycles l on l.workspace_id = w.id
    where w.workspace_kind = 'production'
      and w.name not like '%쇼케이스%' and b.business_name not like '%쇼케이스%'
      and l.status is distinct from 'terminated'
      and (p_audience = 'all_active' or w.created_at >= statement_timestamp() - make_interval(days => p_recent_days))
    order by w.id, a.created_at desc, a.id desc
  loop
    if first_workspace is null then first_workspace := target.workspace_id; end if;
    if campaign.id is null then
      insert into public.credit_grant_campaigns(created_by,audience,recent_days,amount_per_workspace,reason,idempotency_key,target_count)
      values (p_operator_id,p_audience,p_recent_days,p_amount,btrim(p_reason),p_idempotency_key,0) returning * into campaign;
    end if;
    entry_key := 'bulk:' || campaign.id::text || ':' || target.workspace_id::text;
    insert into public.credit_ledger_entries(workspace_id,account_id,kind,action,amount,idempotency_key,occurred_at)
    values (target.workspace_id,target.account_id,'adjustment',null,p_amount,entry_key,now())
    on conflict (workspace_id,idempotency_key,kind) do nothing;
    if found then n := n + 1; else skipped := skipped + 1; end if;
  end loop;
  if first_workspace is null then
    raise exception 'BULK_GRANT_NO_TARGETS' using errcode = 'P0001';
  end if;
  update public.credit_grant_campaigns set target_count = n + skipped, granted_count = n, skipped_count = skipped
    where id = campaign.id;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,metadata)
  values (first_workspace,p_operator_id,'admin_bulk_credit_grant','credit_grant_campaign',campaign.id,
    jsonb_build_object('target_count',n + skipped,'granted_count',n,'skipped_count',skipped));
  return jsonb_build_object('campaign_id',campaign.id,'target_count',n + skipped,'granted_count',n,'skipped_count',skipped);
end;
$$;
revoke all on function public.grant_bulk_credits(uuid,text,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.grant_bulk_credits(uuid,text,integer,integer,text,text) to service_role;
