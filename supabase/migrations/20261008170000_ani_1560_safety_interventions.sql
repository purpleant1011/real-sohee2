-- ANI-1560. Rollback (maintenance window only): drop trigger ani1560_guard_vault_release on public.vault_items;
-- drop function private.ani1560_guard_vault_release(); drop function public.apply_safety_intervention_ani1560(uuid,text,text,boolean,integer,text,text,uuid);
-- drop table public.safety_intervention_executions. Never remove historical audit_events or credit_ledger_entries.
create table public.safety_intervention_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  kind text not null check (kind in ('WORKSPACE','CHANNEL','GLOBAL','CREDIT')),
  channel text,
  active boolean,
  amount integer,
  reason text not null check (reason = btrim(reason) and length(reason) between 1 and 2000),
  actor_id uuid not null references auth.users(id),
  audit_event_id uuid not null references public.audit_events(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index safety_intervention_executions_workspace_time_idx on public.safety_intervention_executions(workspace_id,created_at desc);
-- Existing read policy already allows authenticated SELECT; ensure Data API table grant matches it.
grant select on public.kill_switches to authenticated;
alter table public.safety_intervention_executions enable row level security;
revoke all on public.safety_intervention_executions from public, anon, authenticated;
grant select, insert on public.safety_intervention_executions to service_role;

create function public.apply_safety_intervention_ani1560(
  p_workspace_id uuid, p_kind text, p_channel text, p_active boolean,
  p_amount integer, p_reason text, p_idempotency_key text, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_target text;
  v_existing public.safety_intervention_executions%rowtype;
  v_switch_id uuid;
  v_account_id uuid;
  v_entry_id uuid;
  v_audit_id uuid;
  v_balance integer;
  v_result jsonb;
begin
  if p_workspace_id is null or p_actor_id is null or not exists (select 1 from public.workspaces where id=p_workspace_id)
    or not exists (select 1 from auth.users where id=p_actor_id)
    or p_reason is null or p_reason <> btrim(p_reason) or length(p_reason) not between 1 and 2000
    or p_idempotency_key is null or p_idempotency_key <> btrim(p_idempotency_key) or length(p_idempotency_key) not between 1 and 128
    or p_kind not in ('WORKSPACE','CHANNEL','GLOBAL','CREDIT') or p_kind is null
    or (p_kind = 'CHANNEL' and (p_channel is null or p_channel not in ('instagram','threads','naver_blog','daangn_business')))
    or (p_kind <> 'CHANNEL' and p_channel is not null)
    or (p_kind = 'CREDIT' and (p_active is not null or p_amount is null or p_amount not between 1 and 50000))
    or (p_kind <> 'CREDIT' and (p_active is null or p_amount is not null)) then
    raise exception 'INVALID_SAFETY_INTERVENTION';
  end if;
  -- Serialize replays and changes on this target. Never return another payload's result.
  v_target := case p_kind when 'WORKSPACE' then p_workspace_id::text when 'CHANNEL' then p_channel else 'ALL' end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ani1560:' || p_kind || ':' || v_target, 0));
  select * into v_existing from public.safety_intervention_executions
    where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.kind <> p_kind or v_existing.channel is distinct from p_channel
      or v_existing.active is distinct from p_active or v_existing.amount is distinct from p_amount
      or v_existing.reason <> p_reason or v_existing.actor_id <> p_actor_id then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST';
    end if;
    return v_existing.result || jsonb_build_object('is_replay',true);
  end if;
  if p_kind = 'CREDIT' then
    select id into v_account_id from public.credit_accounts where workspace_id=p_workspace_id for update;
    if not found then raise exception 'CREDIT_ACCOUNT_REQUIRED'; end if;
    insert into public.credit_ledger_entries(workspace_id,account_id,kind,amount,idempotency_key)
      values (p_workspace_id,v_account_id,'adjustment',p_amount,'ani1560:' || p_idempotency_key) returning id into v_entry_id;
    select coalesce(sum(amount),0)::integer into v_balance from public.credit_ledger_entries
      where workspace_id=p_workspace_id and account_id=v_account_id;
    v_result := jsonb_build_object('success',true,'is_replay',false,'balance',v_balance);
  else
    insert into public.kill_switches(scope,target_id,reason,engaged_by,engaged_at,is_active)
      values(p_kind,v_target,p_reason,p_actor_id,now(),p_active)
      on conflict (scope,target_id) do update set reason=excluded.reason,
        engaged_by=excluded.engaged_by,engaged_at=excluded.engaged_at,is_active=excluded.is_active
      returning id into v_switch_id;
    v_result := jsonb_build_object('success',true,'is_replay',false,'active',p_active);
  end if;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,metadata)
    values(p_workspace_id,p_actor_id,'safety_intervention',case when p_kind='CREDIT' then 'credit_ledger' else 'kill_switch' end,
      coalesce(v_entry_id,v_switch_id),jsonb_build_object('kind',p_kind,'target',v_target,'active',p_active,'amount',p_amount,'reason',p_reason,'idempotency_key',p_idempotency_key))
    returning id into v_audit_id;
  insert into public.safety_intervention_executions(workspace_id,idempotency_key,kind,channel,active,amount,reason,actor_id,audit_event_id,result)
    values(p_workspace_id,p_idempotency_key,p_kind,p_channel,p_active,p_amount,p_reason,p_actor_id,v_audit_id,v_result);
  return v_result;
end;
$$;
revoke all on function public.apply_safety_intervention_ani1560(uuid,text,text,boolean,integer,text,text,uuid) from public, anon, authenticated;
grant execute on function public.apply_safety_intervention_ani1560(uuid,text,text,boolean,integer,text,text,uuid) to service_role;

-- Persisted release transitions are protected even if a caller skips an HTTP guard.
create function private.ani1560_guard_vault_release() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if new.release_gate = 'RELEASE_REQUESTED' and old.release_gate is distinct from 'RELEASE_REQUESTED'
    and exists(select 1 from public.kill_switches
      where is_active and ((scope='GLOBAL' and target_id='ALL')
        or (scope='WORKSPACE' and target_id=new.workspace_id::text)
        or (scope='CHANNEL' and target_id=new.channel))) then
    raise exception 'SAFETY_INTERVENTION_BLOCKED';
  end if;
  return new;
end;
$$;
create trigger ani1560_guard_vault_release before update of release_gate on public.vault_items
for each row execute function private.ani1560_guard_vault_release();
revoke all on function private.ani1560_guard_vault_release() from public, anon, authenticated;
