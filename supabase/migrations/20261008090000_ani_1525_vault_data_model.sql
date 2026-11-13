-- ANI-1525: vault is a separate release gate, not a content/schedule lifecycle status.
-- Additive only: existing approvals, version fingerprints and publish queue are untouched.

-- A three-column key also proves the chosen immutable version belongs to the chosen content.
-- The pre-existing (workspace_id, id) keys alone would allow two different contents
-- in the same workspace to be accidentally paired.
alter table public.content_versions
  add constraint content_versions_workspace_content_id_key unique (workspace_id, content_id, id);

create table public.vault_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_id uuid not null,
  version_id uuid not null,
  channel text not null check (channel in ('instagram', 'threads', 'naver_blog', 'daangn_business')),
  release_gate text check (release_gate in (
    'HELD_PROVIDER_PENDING', 'HELD_CONNECTION_PENDING', 'HELD_USER', 'RELEASE_REQUESTED'
  )),
  hold_reason text check (hold_reason in (
    'META_REVIEW_PENDING', 'CHANNEL_NOT_CONNECTED', 'USER_HELD',
    'RELEASE_REQUESTED', 'REAPPROVAL_REQUIRED'
  )),
  held_at timestamptz,
  held_by uuid references auth.users(id) on delete set null,
  target_date date, -- planning only; not part of the approved fingerprint
  approved_fingerprint text check (approved_fingerprint ~ '^[a-f0-9]{64}$'),
  fingerprint_schema_version integer check (fingerprint_schema_version in (1, 2, 3)),
  policy_version text not null check (char_length(policy_version) between 1 and 120),
  spec_version text not null check (char_length(spec_version) between 1 and 120),
  approval_state text not null default 'NEEDS_REAPPROVAL' check (
    approval_state in ('APPROVED', 'INVALIDATED', 'NEEDS_REAPPROVAL')
  ),
  approved_by uuid references auth.users(id) on delete set null,
  bundle_id uuid, -- reference only: creative_bundles excludes non-Meta channels
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vault_items_workspace_id_key unique (workspace_id, id),
  constraint vault_items_workspace_idempotency_key unique (workspace_id, idempotency_key),
  constraint vault_items_content_fk foreign key (workspace_id, content_id)
    references public.content_items(workspace_id, id) on delete restrict,
  constraint vault_items_version_fk foreign key (workspace_id, content_id, version_id)
    references public.content_versions(workspace_id, content_id, id) on delete restrict,
  constraint vault_items_approval_fingerprint_check check (
    (approval_state <> 'APPROVED') or
    (approved_fingerprint is not null and fingerprint_schema_version is not null)
  ),
  constraint vault_items_hold_check check (
    (release_gate is null and hold_reason is null and held_at is null and held_by is null)
    or (release_gate is not null and hold_reason is not null and held_at is not null)
  )
);
create index vault_items_workspace_recent_idx
  on public.vault_items(workspace_id, created_at desc, id) where deleted_at is null;
create index vault_items_workspace_content_idx
  on public.vault_items(workspace_id, content_id, channel) where deleted_at is null;

create table public.vault_variant_payloads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  vault_item_id uuid not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- Rendered previews are outputs, not fingerprint inputs. Keep separately.
  preview_artifacts jsonb not null default '{}'::jsonb check (jsonb_typeof(preview_artifacts) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vault_variant_payloads_item_unique unique (workspace_id, vault_item_id),
  constraint vault_variant_payloads_item_fk foreign key (workspace_id, vault_item_id)
    references public.vault_items(workspace_id, id) on delete cascade
);

create table public.vault_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  vault_item_id uuid not null,
  event_type text not null check (char_length(event_type) between 1 and 120),
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  constraint vault_events_item_fk foreign key (workspace_id, vault_item_id)
    references public.vault_items(workspace_id, id) on delete restrict
);
create index vault_events_workspace_item_time_idx
  on public.vault_events(workspace_id, vault_item_id, occurred_at desc, id);

create function private.prevent_vault_event_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Vault events are append-only' using errcode = '23514';
end;
$$;
create trigger vault_events_append_only before update or delete on public.vault_events
  for each row execute function private.prevent_vault_event_mutation();
revoke all on function private.prevent_vault_event_mutation() from public, anon, authenticated;

create table public.preflight_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  vault_item_id uuid not null,
  run_at timestamptz not null default now(),
  overall text not null check (overall in ('PASS', 'FAIL', 'UNKNOWN')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  triggered_by uuid references auth.users(id) on delete set null,
  constraint preflight_runs_item_fk foreign key (workspace_id, vault_item_id)
    references public.vault_items(workspace_id, id) on delete restrict
);
create index preflight_runs_workspace_item_time_idx
  on public.preflight_runs(workspace_id, vault_item_id, run_at desc, id);

create trigger vault_items_set_updated_at before update on public.vault_items
  for each row execute function private.set_updated_at();
create trigger vault_variant_payloads_set_updated_at before update on public.vault_variant_payloads
  for each row execute function private.set_updated_at();

-- No authenticated mutation policies. Grants are explicit defense in depth;
-- service_role can write even if RLS bypass privileges differ between deployments.
do $$
declare vault_table text;
begin
  foreach vault_table in array array['vault_items', 'vault_variant_payloads', 'vault_events', 'preflight_runs'] loop
    execute format('alter table public.%I enable row level security', vault_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', vault_table);
    execute format('grant select on table public.%I to authenticated', vault_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', vault_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_workspace_member(workspace_id)))',
      vault_table || '_members_select', vault_table
    );
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      vault_table || '_service_write', vault_table
    );
  end loop;
end $$;

-- Manual rollback for an isolated environment only (never run on a live vault with data):
-- drop table if exists public.preflight_runs;
-- drop table if exists public.vault_events;
-- drop function if exists private.prevent_vault_event_mutation();
-- drop table if exists public.vault_variant_payloads;
-- drop table if exists public.vault_items;
-- alter table public.content_versions drop constraint if exists content_versions_workspace_content_id_key;
