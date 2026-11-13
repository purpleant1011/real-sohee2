-- Marketing Connector OAuth Transactions (ANI-2149 / F02)
-- Ephemeral OAuth state and PKCE verifier storage with atomic single-use consumption.
-- Secrets (code_verifier) are strictly protected and inaccessible from public/authenticated direct queries.

create table if not exists public.marketing_connector_oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null check (
    provider_id in ('google', 'microsoft', 'meta', 'apple')
  ),
  state_hash text not null unique check (char_length(state_hash) between 32 and 128),
  code_verifier text not null check (char_length(code_verifier) between 43 and 128),
  code_challenge text not null check (char_length(code_challenge) between 43 and 128),
  requested_scopes text[] not null default '{}'::text[],
  redirect_uri text not null check (char_length(redirect_uri) between 1 and 2000),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

-- Partial index for active unconsumed transactions to support atomic lookup & conditional update
create index if not exists marketing_connector_oauth_transactions_active_idx
  on public.marketing_connector_oauth_transactions (state_hash)
  where consumed_at is null;

-- Workspace & user index for auditing and session cleanup
create index if not exists marketing_connector_oauth_transactions_workspace_idx
  on public.marketing_connector_oauth_transactions (workspace_id, user_id, provider_id);

-- Row Level Security
alter table public.marketing_connector_oauth_transactions enable row level security;

-- Revoke all direct client access (both anon and authenticated)
-- Transactions are strictly server-only with service_role to protect PKCE code_verifier
revoke all on table public.marketing_connector_oauth_transactions from public, anon;
revoke all on table public.marketing_connector_oauth_transactions from authenticated;

-- Service role has full access
grant select, insert, update, delete on table public.marketing_connector_oauth_transactions to service_role;
