-- 20261008270000 is already occupied by the channel-draft migration on main.
-- A separate later version preserves immutable migration history.
create table public.credit_grant_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  audience text not null check (audience in ('all_active', 'recent_signups')),
  recent_days integer check (recent_days between 1 and 30),
  amount_per_workspace integer not null check (amount_per_workspace between 1 and 50000),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  target_count integer not null check (target_count >= 0),
  granted_count integer not null default 0 check (granted_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 120),
  status text not null default 'completed' check (status = 'completed'),
  created_at timestamptz not null default now(),
  check (granted_count + skipped_count = target_count),
  check ((audience = 'all_active' and recent_days is null) or (audience = 'recent_signups' and recent_days between 1 and 30))
);
alter table public.credit_grant_campaigns enable row level security;
revoke all on public.credit_grant_campaigns from public, anon, authenticated;
grant select, insert, update on public.credit_grant_campaigns to service_role;
create index credit_grant_campaigns_recent_idx on public.credit_grant_campaigns(created_at desc, id desc);

-- One shared selector guarantees preview and execution use exactly the same eligibility:
-- production tenant, no showcase name (the billing UI's demo exclusion), business profile,
-- credit account, and no terminated lifecycle. Missing lifecycle remains eligible for new signups.
create function public.preview_bulk_credit_grant(p_audience text, p_recent_days integer)
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

create function public.grant_bulk_credits(
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
  -- Validate BEFORE replay: the same key cannot silently change amount or audience.
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
  -- Serialise only calls with the same key; unique constraint remains the final guard.
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
  -- A consistent snapshot of ids/accounts; workspace edits in this transaction are protected by
  -- the FK on the ledger. If any insert or audit fails, the entire RPC rolls back.
  for target in
    select distinct on (w.id) w.id as workspace_id, a.id as account_id
    from public.workspaces w
    join public.business_profiles b on b.workspace_id = w.id
    join public.credit_accounts a on a.workspace_id = w.id
    left join public.workspace_lifecycles l on l.workspace_id = w.id
    where w.workspace_kind = 'production'
      and w.name not like '%쇼케이스%' and b.business_name not like '%쇼케이스%'
      and l.status is distinct from 'terminated'
      and (p_audience = 'all_active' or w.created_at >= statement_timestamp() - make_interval(days => p_recent_days))
    order by w.id, a.created_at desc, a.id desc
  loop
    if first_workspace is null then first_workspace := target.workspace_id; end if;
    -- Insert campaign before any ledger row, once the first eligible target is known.
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
  -- audit_events requires a workspace_id; use only the first eligible workspace as a pointer.
  -- Metadata contains counts only: no names, identities, or free-text reason.
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,metadata)
  values (first_workspace,p_operator_id,'admin_bulk_credit_grant','credit_grant_campaign',campaign.id,
    jsonb_build_object('target_count',n + skipped,'granted_count',n,'skipped_count',skipped));
  return jsonb_build_object('campaign_id',campaign.id,'target_count',n + skipped,'granted_count',n,'skipped_count',skipped);
end;
$$;
revoke all on function public.grant_bulk_credits(uuid,text,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.grant_bulk_credits(uuid,text,integer,integer,text,text) to service_role;
