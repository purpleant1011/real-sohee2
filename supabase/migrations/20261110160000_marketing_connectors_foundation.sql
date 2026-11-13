-- Marketing Connectors Foundation Ledger (MC-03/08)
-- Dedicated namespace: marketing_connector_*
-- Strict workspace isolation, owner/manager active role enforcement, atomic consent generation, and revocation

create table if not exists public.marketing_connector_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connector_id text not null check (
    connector_id in (
      'gmail', 'google_calendar', 'apple_calendar', 'apple_reminders',
      'google_docs', 'google_sheets', 'outlook_mail', 'threads',
      'instagram', 'instagram_messages', 'google_drive'
    )
  ),
  status text not null default 'disconnected' check (
    status in ('connected', 'reauth_required', 'disconnected', 'error', 'revoked')
  ),
  consent_generation integer not null default 1 check (consent_generation >= 1),
  encrypted_credential_ref text check (
    encrypted_credential_ref is null or char_length(encrypted_credential_ref) between 1 and 500
  ),
  account_label text check (account_label is null or char_length(account_label) <= 120),
  external_account_id text check (external_account_id is null or char_length(external_account_id) <= 255),
  capabilities text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  last_sync_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint marketing_connector_connections_workspace_connector_key unique (workspace_id, connector_id)
);

create index if not exists marketing_connector_connections_workspace_status_idx
  on public.marketing_connector_connections (workspace_id, status, connector_id);

create table if not exists public.marketing_connector_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connector_id text not null check (
    connector_id in (
      'gmail', 'google_calendar', 'apple_calendar', 'apple_reminders',
      'google_docs', 'google_sheets', 'outlook_mail', 'threads',
      'instagram', 'instagram_messages', 'google_drive'
    )
  ),
  source_id text not null check (char_length(source_id) between 1 and 500),
  revision text not null check (char_length(revision) between 1 and 255),
  consent_generation integer not null check (consent_generation >= 1),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  purpose text not null check (purpose in ('marketing', 'booking')),
  text text not null check (char_length(text) between 1 and 100000),
  derived_from_google boolean not null default false,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index if not exists marketing_connector_evidence_lookup_idx
  on public.marketing_connector_evidence (workspace_id, connector_id, consent_generation);

create index if not exists marketing_connector_evidence_latest_lookup_idx
  on public.marketing_connector_evidence (workspace_id, connector_id, source_id, consent_generation, observed_at desc);

create table if not exists public.marketing_connector_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connector_id text not null check (
    connector_id in (
      'gmail', 'google_calendar', 'apple_calendar', 'apple_reminders',
      'google_docs', 'google_sheets', 'outlook_mail', 'threads',
      'instagram', 'instagram_messages', 'google_drive'
    )
  ),
  consent_generation integer not null check (consent_generation >= 1),
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed', 'blocked', 'cancelled')
  ),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index if not exists marketing_connector_sync_jobs_status_idx
  on public.marketing_connector_sync_jobs (workspace_id, connector_id, status);

create table if not exists public.marketing_connector_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connector_id text not null check (
    connector_id in (
      'gmail', 'google_calendar', 'apple_calendar', 'apple_reminders',
      'google_docs', 'google_sheets', 'outlook_mail', 'threads',
      'instagram', 'instagram_messages', 'google_drive'
    )
  ),
  consent_generation integer not null check (consent_generation >= 1),
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed')
  ),
  encrypted_credential_ref text check (
    encrypted_credential_ref is null or char_length(encrypted_credential_ref) between 1 and 500
  ),
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index if not exists marketing_connector_deletion_jobs_status_idx
  on public.marketing_connector_deletion_jobs (workspace_id, connector_id, status);

-- Row Level Security
alter table public.marketing_connector_connections enable row level security;
alter table public.marketing_connector_evidence enable row level security;
alter table public.marketing_connector_sync_jobs enable row level security;
alter table public.marketing_connector_deletion_jobs enable row level security;

-- Permissions: revoke all from public, anon
revoke all on table public.marketing_connector_connections from public, anon;
revoke all on table public.marketing_connector_evidence from public, anon;
revoke all on table public.marketing_connector_sync_jobs from public, anon;
revoke all on table public.marketing_connector_deletion_jobs from public, anon;

-- Explicitly disallow authenticated direct mutations
revoke insert, update, delete on table public.marketing_connector_connections from authenticated;
revoke insert, update, delete on table public.marketing_connector_evidence from authenticated;
revoke insert, update, delete on table public.marketing_connector_sync_jobs from authenticated;
revoke insert, update, delete on table public.marketing_connector_deletion_jobs from authenticated;

-- Column-level privilege: authenticated can ONLY select non-sensitive columns
-- encrypted_credential_ref remains strictly server-only on both connections and deletion_jobs
revoke select on table public.marketing_connector_connections from authenticated;
grant select (
  id, workspace_id, connector_id, status, consent_generation,
  account_label, external_account_id, capabilities, metadata,
  last_sync_at, last_error_code, revoked_at, created_at, updated_at
) on public.marketing_connector_connections to authenticated;

grant select on table public.marketing_connector_evidence to authenticated;
grant select on table public.marketing_connector_sync_jobs to authenticated;

revoke select on table public.marketing_connector_deletion_jobs from authenticated;
grant select (
  id, workspace_id, connector_id, consent_generation, status,
  requested_by, created_at, updated_at
) on public.marketing_connector_deletion_jobs to authenticated;

grant select, insert, update, delete on table public.marketing_connector_connections to service_role;
grant select, insert, update, delete on table public.marketing_connector_evidence to service_role;
grant select, insert, update, delete on table public.marketing_connector_sync_jobs to service_role;
grant select, insert, update, delete on table public.marketing_connector_deletion_jobs to service_role;

-- RLS Policies: Current active owner or manager only (no eternal creator bypass)
create policy "workspace managers can view marketing connector connections"
  on public.marketing_connector_connections for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = marketing_connector_connections.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

-- Helper to determine if an evidence row is the single authoritative latest revision for its source,
-- verified within tenant boundaries by an active owner/manager, avoiding self-SELECT recursion in RLS.
create or replace function public.is_valid_marketing_connector_evidence(
  p_evidence_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_ev record;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    return false;
  end if;

  -- 1. Read target evidence row in security definer context (bypasses RLS to avoid self-SELECT recursion)
  select e.id, e.workspace_id, e.connector_id, e.source_id, e.consent_generation,
         e.observed_at, e.expires_at, e.revoked_at
  into v_ev
  from public.marketing_connector_evidence e
  where e.id = p_evidence_id;

  if not found then
    return false;
  end if;

  -- 2. Tenant isolation & role check: caller must be active owner or manager of this workspace
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = v_ev.workspace_id
      and wm.user_id = v_caller_id
      and wm.status = 'active'
      and wm.role in ('owner', 'manager')
  ) then
    return false;
  end if;

  -- 3. Connection check: workspace connector must be connected, unrevoked, matching consent generation
  if not exists (
    select 1 from public.marketing_connector_connections mcc
    where mcc.workspace_id = v_ev.workspace_id
      and mcc.connector_id = v_ev.connector_id
      and mcc.status = 'connected'
      and mcc.consent_generation = v_ev.consent_generation
      and mcc.revoked_at is null
  ) then
    return false;
  end if;

  -- 4. Source latest check (MUST precede validity check):
  -- - Latest revision check is source-wide regardless of purpose (intended design policy):
  --   if a newer revision for the same source exists with a different purpose (e.g. booking),
  --   the source is evaluated by that newer revision and older facts (e.g. marketing) are never resurrected.
  -- - Evaluated strictly within the current consent_generation (generation isolation).
  -- - Fail closed: if any other row has a later observed_at, or a tie on observed_at with a different id, exclude.
  if exists (
    select 1 from public.marketing_connector_evidence o
    where o.workspace_id = v_ev.workspace_id
      and o.connector_id = v_ev.connector_id
      and o.source_id = v_ev.source_id
      and o.consent_generation = v_ev.consent_generation
      and (
        o.observed_at > v_ev.observed_at
        or (o.observed_at = v_ev.observed_at and o.id <> v_ev.id)
      )
  ) then
    return false;
  end if;

  -- 5. Validity checks on the confirmed latest revision
  -- Calling convention contract: DB uses statement_timestamp() as authoritative current timestamp.
  -- Clock skew allowance: up to 300 seconds (5 minutes) in the future is allowed. Exceeding +300s quarantines source.
  if v_ev.observed_at > (pg_catalog.statement_timestamp() + interval '300 seconds') then
    return false;
  end if;

  if v_ev.revoked_at is not null then
    return false;
  end if;

  if v_ev.expires_at <= pg_catalog.statement_timestamp() then
    return false;
  end if;

  if v_ev.observed_at < (pg_catalog.statement_timestamp() - interval '30 days') then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.is_valid_marketing_connector_evidence(uuid) from public, anon;
grant execute on function public.is_valid_marketing_connector_evidence(uuid) to authenticated, service_role;

-- Evidence policy: delegated to server-only security definer helper to ensure latest revision is confirmed before validity filter
create policy "workspace managers can view valid marketing connector evidence"
  on public.marketing_connector_evidence for select
  to authenticated
  using (
    public.is_valid_marketing_connector_evidence(id)
  );

create policy "workspace managers can view marketing connector sync jobs"
  on public.marketing_connector_sync_jobs for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = marketing_connector_sync_jobs.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

create policy "workspace managers can view marketing connector deletion jobs"
  on public.marketing_connector_deletion_jobs for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = marketing_connector_deletion_jobs.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

-- Atomic & Idempotent Disconnection RPC
create or replace function public.disconnect_marketing_connector(
  p_workspace_id uuid,
  p_connector_id text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_id uuid;
  v_conn record;
  v_old_ref text;
  v_job_status text;
  v_pending boolean;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'AUTH_REQUIRED: authentication required' using errcode = '42501';
  end if;

  if p_actor_user_id is not null and p_actor_user_id <> v_caller_id then
    raise exception 'FORBIDDEN: actor parameter mismatch' using errcode = '42501';
  end if;

  -- Role guard: caller must be current active owner or manager (no eternal creator bypass)
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = v_caller_id
      and status = 'active'
      and role in ('owner', 'manager')
  ) then
    raise exception 'FORBIDDEN: caller must be an active workspace owner or manager' using errcode = '42501';
  end if;

  -- Social connectors cannot be revoked here; must use existing channel management
  if p_connector_id in ('instagram', 'threads', 'instagram_messages') then
    raise exception 'SOCIAL_CHANNEL_MANAGEMENT_REQUIRED: social connectors must be managed via /app/channels' using errcode = '22000';
  end if;

  -- Lock existing connection row
  select * into v_conn
  from public.marketing_connector_connections
  where workspace_id = p_workspace_id
    and connector_id = p_connector_id
  for update;

  -- If connection does not exist, reject fail-closed without fabricating records
  if not found then
    raise exception 'CONNECTOR_NOT_FOUND: connector connection not found' using errcode = 'P0002';
  end if;

  -- Idempotency check: if already revoked, return actual current deletion job status
  if v_conn.status = 'revoked' then
    select status into v_job_status
    from public.marketing_connector_deletion_jobs
    where workspace_id = p_workspace_id
      and connector_id = p_connector_id
      and consent_generation = v_conn.consent_generation
    order by created_at desc
    limit 1;

    if v_job_status is null then
      raise exception 'DELETION_JOB_NOT_FOUND: durable deletion job record missing for revoked connector' using errcode = 'XX000';
    end if;

    v_pending := (v_job_status <> 'completed');

    return jsonb_build_object(
      'connector_id', p_connector_id,
      'consent_generation', v_conn.consent_generation,
      'status', 'revoked',
      'pending_deletion', v_pending
    );
  end if;

  v_old_ref := v_conn.encrypted_credential_ref;

  -- Atomic update: increment generation, clear capabilities, move credential ref to deletion job, mark revoked
  update public.marketing_connector_connections
  set consent_generation = public.marketing_connector_connections.consent_generation + 1,
      status = 'revoked',
      capabilities = '{}'::text[],
      encrypted_credential_ref = null,
      revoked_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where workspace_id = p_workspace_id
    and connector_id = p_connector_id
  returning * into v_conn;

  -- Enqueue durable deletion job with snapshot of the revoked generation credential ref
  insert into public.marketing_connector_deletion_jobs (
    workspace_id,
    connector_id,
    consent_generation,
    status,
    encrypted_credential_ref,
    requested_by,
    created_at,
    updated_at
  )
  values (
    p_workspace_id,
    p_connector_id,
    v_conn.consent_generation,
    'pending',
    v_old_ref,
    v_caller_id,
    statement_timestamp(),
    statement_timestamp()
  );

  -- Invalidate and block running/pending sync jobs for this connector
  update public.marketing_connector_sync_jobs
  set status = 'blocked',
      error_code = 'CONSENT_REVOKED',
      updated_at = statement_timestamp()
  where workspace_id = p_workspace_id
    and connector_id = p_connector_id
    and status in ('pending', 'running');

  -- Mark existing evidence as revoked
  update public.marketing_connector_evidence
  set revoked_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where workspace_id = p_workspace_id
    and connector_id = p_connector_id;

  return jsonb_build_object(
    'connector_id', p_connector_id,
    'consent_generation', v_conn.consent_generation,
    'status', 'revoked',
    'pending_deletion', true
  );
end;
$$;

revoke all on function public.disconnect_marketing_connector(uuid, text, uuid) from public, anon;
grant execute on function public.disconnect_marketing_connector(uuid, text, uuid) to authenticated, service_role;
