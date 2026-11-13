create table public.workspace_lifecycles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  status text not null check (status in ('applied','information_pending','contract_review','consent_pending','channel_pending','payment_pending','ready_for_activation','active','paused','terminated')),
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason)),
  version bigint not null default 1 check (version > 0),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('service_agreement','privacy_consent','publishing_delegation')),
  version text not null check (char_length(version) between 1 and 80),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz not null,
  expires_at timestamptz,
  status text not null check (status in ('draft','active','retired')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at is null or expires_at >= effective_at)
);
create unique index legal_document_versions_active_type_key on public.legal_document_versions(document_type) where status = 'active';

create table public.workspace_agreements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_version_id uuid not null references public.legal_document_versions(id) on delete restrict,
  agreement_type text not null check (agreement_type in ('service_agreement','privacy_consent')),
  status text not null check (status in ('accepted','withdrawn','expired')),
  accepted_by uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete restrict,
  withdrawn_at timestamptz,
  expires_at timestamptz,
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason)),
  created_at timestamptz not null default statement_timestamp(),
  check ((status = 'accepted' and accepted_by is not null and accepted_at is not null and withdrawn_by is null and withdrawn_at is null) or (status in ('withdrawn','expired') and accepted_by is not null and accepted_at is not null)),
  check (expires_at is null or accepted_at is null or expires_at >= accepted_at)
);
create index workspace_agreements_lookup_idx on public.workspace_agreements(workspace_id, agreement_type, created_at desc);

create table public.channel_delegations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('instagram','threads','naver_blog','naver_place','daangn_business')),
  status text not null check (status in ('accepted','withdrawn','expired')),
  document_version_id uuid not null references public.legal_document_versions(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete restrict,
  withdrawn_at timestamptz,
  expires_at timestamptz,
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason)),
  created_at timestamptz not null default statement_timestamp(),
  check ((status = 'accepted' and accepted_by is not null and accepted_at is not null and withdrawn_by is null and withdrawn_at is null) or (status in ('withdrawn','expired') and accepted_by is not null and accepted_at is not null)),
  check (expires_at is null or accepted_at is null or expires_at >= accepted_at)
);
create index channel_delegations_lookup_idx on public.channel_delegations(workspace_id, channel, created_at desc);

alter table public.workspace_lifecycles enable row level security;
alter table public.legal_document_versions enable row level security;
alter table public.workspace_agreements enable row level security;
alter table public.channel_delegations enable row level security;
revoke all on public.workspace_lifecycles, public.legal_document_versions, public.workspace_agreements, public.channel_delegations from public, anon, authenticated;
grant select, insert, update on public.workspace_lifecycles to service_role;
grant select, insert on public.legal_document_versions, public.workspace_agreements, public.channel_delegations to service_role;

alter table public.platform_audit_events drop constraint if exists platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check check (action in (
  'agreement.verify.requested', 'agreement.verify.approved',
  'channel.disconnect.requested', 'channel.disconnect.approved',
  'publish.retry.requested', 'publish.retry.approved',
  'credit.adjust.requested', 'credit.adjust.approved',
  'admin.role.change.workspace.requested', 'admin.role.change.workspace.approved',
  'admin.role.change.global.requested', 'admin.role.change.global.approved',
  'audit.export.workspace.requested', 'audit.export.workspace.approved',
  'audit.export.global.requested', 'audit.export.global.approved',
  'admin.account.activated',
  'workspace.activation.requested'
));

create or replace function public.get_operator_onboarding_overview(p_workspace_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); claims jsonb := (select auth.jwt()); result jsonb;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select m.mfa_required from public.platform_admin_members m where m.user_id = actor_id), true) then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members m where m.user_id = actor_id and m.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not exists (
    select 1 from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'agreement.read'
  ) then raise exception 'OPERATOR_PERMISSION_DENIED'; end if;
  if p_workspace_id is not null and not exists (select 1 from public.workspaces where id = p_workspace_id) then raise exception 'WORKSPACE_NOT_FOUND'; end if;
  if p_workspace_id is not null and not private.has_platform_permission('agreement.read', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;
  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb) into result
  from (
    select w.created_at, jsonb_build_object(
      'workspace_id', w.id, 'workspace_name', w.name,
      'lifecycle', jsonb_build_object('state', case when l.workspace_id is null then 'unknown' else 'fresh' end, 'status', l.status, 'version', l.version, 'changed_at', l.changed_at),
      'agreements', jsonb_build_object('state', case when agreement_data.items = '[]'::jsonb then 'empty' else 'fresh' end, 'items', agreement_data.items),
      'delegations', jsonb_build_object('state', case when delegation_data.items = '[]'::jsonb then 'empty' else 'fresh' end, 'items', delegation_data.items),
      'activation', jsonb_build_object(
        'ready', agreement_data.has_service and agreement_data.has_privacy and delegation_data.has_delegation and technical_data.has_channel,
        'missing', array_remove(array[
          case when agreement_data.has_service then null else 'service_agreement' end,
          case when agreement_data.has_privacy then null else 'privacy_consent' end,
          case when delegation_data.has_delegation then null else 'publishing_delegation' end,
          case when technical_data.has_channel then null else 'technical_channel' end
        ]::text[], null)
      ),
      'source_timestamps', jsonb_build_object('workspace', w.updated_at, 'lifecycle', l.updated_at), 'read_state', 'fresh'
    ) as row_data
    from public.workspaces w left join public.workspace_lifecycles l on l.workspace_id = w.id
    cross join lateral (
      select
        coalesce(jsonb_agg(jsonb_build_object('agreement_type', a.agreement_type, 'status', a.status, 'accepted_at', a.accepted_at, 'withdrawn_at', a.withdrawn_at, 'expires_at', a.expires_at) order by a.created_at desc), '[]'::jsonb) as items,
        coalesce(bool_or(a.agreement_type = 'service_agreement' and a.status = 'accepted' and (a.expires_at is null or a.expires_at > statement_timestamp()) and document.status = 'active'), false) as has_service,
        coalesce(bool_or(a.agreement_type = 'privacy_consent' and a.status = 'accepted' and (a.expires_at is null or a.expires_at > statement_timestamp()) and document.status = 'active'), false) as has_privacy
      from public.workspace_agreements a
      join public.legal_document_versions document on document.id = a.document_version_id
      where a.workspace_id = w.id
    ) agreement_data
    cross join lateral (
      select
        coalesce(jsonb_agg(jsonb_build_object('channel', d.channel, 'status', d.status, 'accepted_at', d.accepted_at, 'withdrawn_at', d.withdrawn_at, 'expires_at', d.expires_at) order by d.created_at desc), '[]'::jsonb) as items,
        coalesce(bool_or(d.status = 'accepted' and (d.expires_at is null or d.expires_at > statement_timestamp()) and document.status = 'active'), false) as has_delegation
      from public.channel_delegations d
      join public.legal_document_versions document on document.id = d.document_version_id
      where d.workspace_id = w.id
    ) delegation_data
    cross join lateral (
      select exists (
        select 1
        from public.channel_delegations delegation
        join public.legal_document_versions document on document.id = delegation.document_version_id and document.status = 'active'
        join public.channel_connections connection on connection.workspace_id = delegation.workspace_id and connection.channel = delegation.channel and connection.status = 'connected'
        where delegation.workspace_id = w.id
          and delegation.status = 'accepted'
          and (delegation.expires_at is null or delegation.expires_at > statement_timestamp())
      ) as has_channel
    ) technical_data
    where (p_workspace_id is null or w.id = p_workspace_id)
      and private.has_platform_permission('agreement.read', w.id)
  ) rows;
  return result;
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','OPERATOR_PERMISSION_DENIED','OPERATOR_SCOPE_DENIED','WORKSPACE_NOT_FOUND') then raise; end if;
  raise exception 'ONBOARDING_OVERVIEW_UNAVAILABLE';
end; $$;

create or replace function public.request_operator_workspace_activation(p_workspace_id uuid, p_reason text, p_idempotency_key uuid, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); claims jsonb := (select auth.jwt()); lifecycle_row public.workspace_lifecycles%rowtype; key text; ready boolean;
begin
  if actor_id is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'OPERATOR_UNAUTHENTICATED'; end if;
  if claims ->> 'aal' is distinct from 'aal2' and coalesce((select m.mfa_required from public.platform_admin_members m where m.user_id = actor_id), true) then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members m where m.user_id = actor_id and m.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not private.has_platform_permission('agreement.verify', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then raise exception 'WORKSPACE_NOT_FOUND'; end if;
  key := encode(extensions.digest(p_idempotency_key::text, 'sha256'), 'hex');
  if exists (
    select 1 from public.platform_audit_events
    where idempotency_key = key
      and (workspace_id is distinct from p_workspace_id or action <> 'workspace.activation.requested' or target_id <> p_workspace_id::text)
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  if exists (
    select 1 from public.platform_audit_events
    where idempotency_key = key and workspace_id = p_workspace_id and action = 'workspace.activation.requested' and target_id = p_workspace_id::text
  ) then
    return jsonb_build_object('workspace_id', p_workspace_id, 'status', 'active', 'replayed', true);
  end if;
  select * into lifecycle_row from public.workspace_lifecycles where workspace_id = p_workspace_id for update;
  if coalesce(lifecycle_row.version, 0) <> p_expected_version then raise exception 'EXPECTED_VERSION_MISMATCH'; end if;
  if lifecycle_row.status = 'active' then
    return jsonb_build_object('workspace_id', p_workspace_id, 'status', 'active', 'version', lifecycle_row.version, 'replayed', true);
  end if;
  if lifecycle_row.status = 'terminated' then raise exception 'ACTIVATION_PREREQUISITES_MISSING'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'ACTIVATION_PREREQUISITES_MISSING'; end if;
  ready := exists (select 1 from public.workspace_agreements a join public.legal_document_versions d on d.id = a.document_version_id where a.workspace_id = p_workspace_id and a.agreement_type = 'service_agreement' and a.status = 'accepted' and (a.expires_at is null or a.expires_at > statement_timestamp()) and d.status = 'active')
    and exists (select 1 from public.workspace_agreements a join public.legal_document_versions d on d.id = a.document_version_id where a.workspace_id = p_workspace_id and a.agreement_type = 'privacy_consent' and a.status = 'accepted' and (a.expires_at is null or a.expires_at > statement_timestamp()) and d.status = 'active')
    and exists (select 1 from public.channel_delegations d join public.legal_document_versions v on v.id = d.document_version_id join public.channel_connections c on c.workspace_id = d.workspace_id and c.channel = d.channel where d.workspace_id = p_workspace_id and d.status = 'accepted' and (d.expires_at is null or d.expires_at > statement_timestamp()) and v.status = 'active' and c.status = 'connected');
  if not ready then raise exception 'ACTIVATION_PREREQUISITES_MISSING'; end if;
  insert into public.workspace_lifecycles(workspace_id,status,reason,version,changed_by,changed_at,created_at,updated_at) values (p_workspace_id,'active',btrim(p_reason),p_expected_version + 1,actor_id,statement_timestamp(),coalesce(lifecycle_row.created_at, statement_timestamp()),statement_timestamp()) on conflict (workspace_id) do update set status = excluded.status, reason = excluded.reason, version = excluded.version, changed_by = excluded.changed_by, changed_at = excluded.changed_at, updated_at = excluded.updated_at;
  perform private.append_platform_audit_event(actor_id,p_workspace_id,'workspace.activation.requested','workspace_lifecycle',p_workspace_id::text,btrim(p_reason),p_idempotency_key::text,'succeeded',jsonb_build_object('version',p_expected_version),jsonb_build_object('status','active','version',p_expected_version + 1),key,'observed',null,null);
  return jsonb_build_object('workspace_id',p_workspace_id,'status','active','version',p_expected_version + 1,'replayed',false);
exception when others then
  if sqlerrm in ('OPERATOR_UNAUTHENTICATED','MFA_REQUIRED','OPERATOR_DISABLED','OPERATOR_PERMISSION_DENIED','OPERATOR_SCOPE_DENIED','WORKSPACE_NOT_FOUND','EXPECTED_VERSION_MISMATCH','ACTIVATION_PREREQUISITES_MISSING','IDEMPOTENCY_CONFLICT') then raise; end if;
  raise exception 'ACTIVATION_REQUEST_UNAVAILABLE';
end; $$;

revoke all on function public.get_operator_onboarding_overview(uuid), public.request_operator_workspace_activation(uuid,text,uuid,bigint) from public, anon, service_role;
grant execute on function public.get_operator_onboarding_overview(uuid), public.request_operator_workspace_activation(uuid,text,uuid,bigint) to authenticated;
