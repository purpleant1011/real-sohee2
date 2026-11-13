-- Migration: 20261009020000_ani_instagram_direct_messages.sql
-- Description: Instagram Direct Message (DM) threads, messages, drafts with 2~3 direction options, and append-only audit log.
-- Invariants: Strict tenancy, workspace cascade with immutable audit exception, Instagram-only, 24-hour window, index on every FK.

-- 1. Instagram DM threads table
create table public.instagram_dm_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_connection_id uuid not null,
  channel text not null default 'instagram' check (channel = 'instagram'),
  provider_thread_id text not null check (char_length(provider_thread_id) between 1 and 255),
  customer_id text not null check (char_length(customer_id) between 1 and 255),
  customer_handle text not null check (char_length(customer_handle) between 1 and 255),
  customer_name text check (customer_name is null or char_length(customer_name) between 1 and 255),
  last_message_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'NEEDS_REPLY' check (status in (
    'NEEDS_REPLY', 'NEEDS_CHECK', 'SENT', 'DISMISSED', 'EXPIRED'
  )),
  last_message_text text not null check (char_length(last_message_text) between 1 and 4000),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint instagram_dm_threads_workspace_id_id_key unique (workspace_id, id),
  constraint instagram_dm_threads_workspace_provider_thread_unique unique (workspace_id, provider_thread_id),
  constraint instagram_dm_threads_connection_fk foreign key (workspace_id, channel_connection_id)
    references public.channel_connections (workspace_id, id) on delete cascade
);

-- Indexes for instagram_dm_threads (covering FK and hot query paths)
create index idx_instagram_dm_threads_workspace_conn on public.instagram_dm_threads (workspace_id, channel_connection_id);
create index idx_instagram_dm_threads_workspace_status on public.instagram_dm_threads (workspace_id, status, last_message_at desc);
create index idx_instagram_dm_threads_workspace_expires on public.instagram_dm_threads (workspace_id, expires_at);

-- 2. Instagram DM messages table (timeline history)
create table public.instagram_dm_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null,
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 255),
  sender_type text not null check (sender_type in ('customer', 'business')),
  sender_id text not null check (char_length(sender_id) between 1 and 255),
  text text not null check (char_length(text) between 1 and 4000),
  sent_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint instagram_dm_messages_workspace_id_id_key unique (workspace_id, id),
  constraint instagram_dm_messages_workspace_provider_msg_unique unique (workspace_id, provider_message_id),
  constraint instagram_dm_messages_thread_fk foreign key (workspace_id, thread_id)
    references public.instagram_dm_threads (workspace_id, id) on delete cascade
);

-- Index for instagram_dm_messages (covering FK and thread timeline)
create index idx_instagram_dm_messages_workspace_thread on public.instagram_dm_messages (workspace_id, thread_id, sent_at asc);

-- 3. Instagram DM drafts table (2~3 strategy direction options & selected draft text)
create table public.instagram_dm_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid not null,
  selected_option_id text check (selected_option_id is null or char_length(selected_option_id) <= 64),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  draft_text text not null check (char_length(draft_text) between 1 and 1000),
  approved_fingerprint text check (approved_fingerprint is null or approved_fingerprint ~ '^[a-f0-9]{64}$'),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint instagram_dm_drafts_workspace_id_id_key unique (workspace_id, id),
  constraint instagram_dm_drafts_workspace_thread_unique unique (workspace_id, thread_id),
  constraint instagram_dm_drafts_thread_fk foreign key (workspace_id, thread_id)
    references public.instagram_dm_threads (workspace_id, id) on delete cascade
);

-- Indexes for instagram_dm_drafts
create index idx_instagram_dm_drafts_workspace_thread on public.instagram_dm_drafts (workspace_id, thread_id);
create index idx_instagram_dm_drafts_approved_by on public.instagram_dm_drafts (approved_by);

-- 4. Append-only Instagram DM audit log
create table public.instagram_dm_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  thread_id uuid,
  actor text not null check (actor in ('owner', 'manager', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in (
    'manual_send', 'dismiss', 'select_option', 'edit_draft', 'generate_draft'
  )),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 500),
  readback_verified boolean not null default false,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  constraint instagram_dm_audit_workspace_id_id_key unique (workspace_id, id),
  constraint instagram_dm_audit_thread_fk foreign key (workspace_id, thread_id)
    references public.instagram_dm_threads (workspace_id, id) on delete set null (thread_id)
);

-- Indexes for instagram_dm_audit
create index idx_instagram_dm_audit_workspace_thread on public.instagram_dm_audit (workspace_id, thread_id);
create index idx_instagram_dm_audit_actor_user on public.instagram_dm_audit (actor_user_id);
create index idx_instagram_dm_audit_workspace_created on public.instagram_dm_audit (workspace_id, created_at desc);

-- 5. Updated_at triggers
create trigger instagram_dm_threads_set_updated_at
before update on public.instagram_dm_threads
for each row execute function private.set_updated_at();

create trigger instagram_dm_drafts_set_updated_at
before update on public.instagram_dm_drafts
for each row execute function private.set_updated_at();

-- 6. Append-only trigger for instagram_dm_audit allowing cascade delete when workspace is gone
create or replace function private.prevent_instagram_dm_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (
       select 1
       from public.workspaces
       where id = old.workspace_id
     ) then
    return old;
  end if;

  raise exception 'INSTAGRAM_DM_AUDIT_APPEND_ONLY' using errcode = '23514';
end;
$$;

create trigger instagram_dm_audit_append_only
before update or delete on public.instagram_dm_audit
for each row execute function private.prevent_instagram_dm_audit_mutation();

revoke all on function private.prevent_instagram_dm_audit_mutation() from public, anon, authenticated, service_role;

-- 7. Row Level Security & Grants
do $$
declare dm_table text;
begin
  foreach dm_table in array array['instagram_dm_threads', 'instagram_dm_messages', 'instagram_dm_drafts', 'instagram_dm_audit'] loop
    execute format('alter table public.%I enable row level security', dm_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', dm_table);
    execute format('grant select on table public.%I to authenticated', dm_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', dm_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_workspace_member(workspace_id)))',
      dm_table || '_members_select', dm_table
    );
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      dm_table || '_service_write', dm_table
    );
  end loop;
end $$;
