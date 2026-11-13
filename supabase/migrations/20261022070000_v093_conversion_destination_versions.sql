-- ANI-1597: explicit owner-confirmed conversion settings, not inferred business website URLs.
-- Append-only server commands. Workspace/dataset/revision PK is the final CAS authority;
-- workspace/dataset/command uniqueness makes retries converge without replacing history.
-- No public landing/inquiry is enabled by this migration. No provider writes.

create table public.workspace_conversion_versions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dataset_mode text not null check (dataset_mode in ('ACTUAL', 'SHOWCASE_DEMO', 'TEST')),
  revision integer not null check (revision > 0),
  command_id uuid not null,
  command_digest text not null check (command_digest ~ '^[0-9a-f]{64}$'),
  booking_url text check (booking_url is null or (char_length(booking_url) between 1 and 2048 and booking_url ~ '^https://[^[:space:]]+$')),
  booking_expires_at timestamptz,
  confirmed_at timestamptz not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint workspace_conversion_versions_pkey primary key (workspace_id, dataset_mode, revision),
  constraint workspace_conversion_versions_command_key unique (workspace_id, dataset_mode, command_id),
  constraint workspace_conversion_versions_expiry_check check (booking_expires_at is null or booking_expires_at > confirmed_at)
);

comment on table public.workspace_conversion_versions is
  'Owner-confirmed booking destination command history. Human confirmation is not HTTP/provider verification. API enforces workspace and ACTUAL dataset isolation.';

alter table public.workspace_conversion_versions enable row level security;
-- Override any inherited default table grants explicitly. Private settings are not a public Data API.
revoke all on table public.workspace_conversion_versions from public, anon, authenticated, service_role;
grant select, insert on table public.workspace_conversion_versions to service_role;

create policy conversion_versions_service_select on public.workspace_conversion_versions
  for select to service_role using (true);
create policy conversion_versions_service_insert on public.workspace_conversion_versions
  for insert to service_role with check (true);

-- No UPDATE/DELETE grants: application writes append a version. Account deletion can anonymize
-- confirmed_by through its FK, and authorized workspace offboarding can cascade its own rows.
-- Rollback plan: disable the conversion command routes, preserve this history, and prepare any
-- destructive schema rollback separately after checking active approval/landing dependencies.
