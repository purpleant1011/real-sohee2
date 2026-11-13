-- Migration: 20261009010000_ani_social_comments_inbox.sql
-- Description: Social comments, reply drafts, engagement policies, and append-only audit log.
-- Invariants: Strict tenancy, workspace cascade with immutable audit exception, index on every FK.

-- 1. Social comments table
create table public.social_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_connection_id uuid not null,
  channel text not null check (channel in ('instagram', 'threads')),
  provider_comment_id text not null check (char_length(provider_comment_id) between 1 and 255),
  provider_media_id text not null check (char_length(provider_media_id) between 1 and 255),
  author_handle text not null check (char_length(author_handle) between 1 and 255),
  author_id text check (author_id is null or char_length(author_id) between 1 and 255),
  comment_text text not null check (char_length(comment_text) between 1 and 4000),
  comment_created_at timestamptz not null,
  classification text check (classification is null or classification in (
    'THANKS', 'GREETING', 'QUESTION', 'COMPLAINT', 'SENSITIVE', 'SPAM', 'NEEDS_HUMAN'
  )),
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0.00 and confidence <= 1.00)),
  status text not null default 'RECEIVED' check (status in (
    'RECEIVED', 'CLASSIFIED', 'DRAFTED', 'APPROVED', 'SENDING', 'SENT', 'DISMISSED', 'NEEDS_CHECK', 'FAILED'
  )),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 1000),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint social_comments_workspace_id_id_key unique (workspace_id, id),
  constraint social_comments_workspace_provider_unique unique (workspace_id, channel, provider_comment_id),
  constraint social_comments_connection_fk foreign key (workspace_id, channel_connection_id)
    references public.channel_connections (workspace_id, id) on delete cascade
);

-- Indexes for social_comments (covering FK and hot query paths)
create index idx_social_comments_workspace_conn on public.social_comments (workspace_id, channel_connection_id);
create index idx_social_comments_workspace_status on public.social_comments (workspace_id, status, comment_created_at desc);
create index idx_social_comments_workspace_media on public.social_comments (workspace_id, provider_media_id);

-- 2. Comment reply drafts table
create table public.comment_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  comment_id uuid not null,
  draft_text text not null check (char_length(draft_text) between 1 and 2200),
  approved_fingerprint text check (approved_fingerprint is null or approved_fingerprint ~ '^[a-f0-9]{64}$'),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  is_auto_approved boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint comment_reply_drafts_workspace_id_id_key unique (workspace_id, id),
  constraint comment_reply_drafts_workspace_comment_unique unique (workspace_id, comment_id),
  constraint comment_reply_drafts_comment_fk foreign key (workspace_id, comment_id)
    references public.social_comments (workspace_id, id) on delete cascade
);

-- Indexes for comment_reply_drafts (covering FKs)
create index idx_comment_reply_drafts_workspace_comment on public.comment_reply_drafts (workspace_id, comment_id);
create index idx_comment_reply_drafts_approved_by on public.comment_reply_drafts (approved_by);

-- 3. Engagement policies table (defaults OFF, one policy per workspace + channel)
create table public.engagement_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null check (channel in ('instagram', 'threads')),
  auto_reply_enabled boolean not null default false,
  is_paused boolean not null default false,
  allowed_classes text[] not null default array['THANKS', 'GREETING']::text[] check (cardinality(allowed_classes) <= 10),
  min_confidence numeric(3, 2) not null default 0.85 check (min_confidence >= 0.00 and min_confidence <= 1.00),
  daily_cap integer not null default 5 check (daily_cap >= 1 and daily_cap <= 100),
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start text check (quiet_hours_start is null or quiet_hours_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  quiet_hours_end text check (quiet_hours_end is null or quiet_hours_end ~ '^[0-2][0-9]:[0-5][0-9]$'),
  max_comment_age_days integer not null default 7 check (max_comment_age_days >= 1 and max_comment_age_days <= 30),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint engagement_policies_workspace_id_id_key unique (workspace_id, id),
  constraint engagement_policies_workspace_channel_unique unique (workspace_id, channel)
);

-- Index for engagement_policies
create index idx_engagement_policies_workspace_channel on public.engagement_policies (workspace_id, channel);

-- 4. Append-only engagement audit table
create table public.engagement_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  comment_id uuid,
  channel text not null check (channel in ('instagram', 'threads')),
  actor text not null check (actor in ('system', 'owner', 'manager')),
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in (
    'auto_reply', 'manual_send', 'dismiss', 'regenerate_draft', 'edit_draft', 'policy_update'
  )),
  policy_snapshot jsonb check (policy_snapshot is null or jsonb_typeof(policy_snapshot) = 'object'),
  provider_reply_id text check (provider_reply_id is null or char_length(provider_reply_id) <= 500),
  readback_verified boolean not null default false,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  constraint engagement_audit_workspace_id_id_key unique (workspace_id, id),
  constraint engagement_audit_comment_fk foreign key (workspace_id, comment_id)
    references public.social_comments (workspace_id, id) on delete set null (comment_id)
);

-- Indexes for engagement_audit (covering FKs and chronological queries)
create index idx_engagement_audit_workspace_comment on public.engagement_audit (workspace_id, comment_id);
create index idx_engagement_audit_actor_user on public.engagement_audit (actor_user_id);
create index idx_engagement_audit_workspace_created on public.engagement_audit (workspace_id, created_at desc);

-- 5. Updated_at triggers
create trigger social_comments_set_updated_at
before update on public.social_comments
for each row execute function private.set_updated_at();

create trigger comment_reply_drafts_set_updated_at
before update on public.comment_reply_drafts
for each row execute function private.set_updated_at();

create trigger engagement_policies_set_updated_at
before update on public.engagement_policies
for each row execute function private.set_updated_at();

-- 6. Append-only trigger for engagement_audit allowing cascade delete when workspace is gone
create or replace function private.prevent_engagement_audit_mutation()
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

  raise exception 'ENGAGEMENT_AUDIT_APPEND_ONLY' using errcode = '23514';
end;
$$;

create trigger engagement_audit_append_only
before update or delete on public.engagement_audit
for each row execute function private.prevent_engagement_audit_mutation();

revoke all on function private.prevent_engagement_audit_mutation() from public, anon, authenticated, service_role;

-- 7. Row Level Security & Grants (aligned with vault data model standard)
do $$
declare engagement_table text;
begin
  foreach engagement_table in array array['social_comments', 'comment_reply_drafts', 'engagement_policies', 'engagement_audit'] loop
    execute format('alter table public.%I enable row level security', engagement_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', engagement_table);
    execute format('grant select on table public.%I to authenticated', engagement_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', engagement_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_workspace_member(workspace_id)))',
      engagement_table || '_members_select', engagement_table
    );
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      engagement_table || '_service_write', engagement_table
    );
  end loop;
end $$;

-- Rollback:
-- drop table if exists public.engagement_audit;
-- drop function if exists private.prevent_engagement_audit_mutation();
-- drop table if exists public.engagement_policies;
-- drop table if exists public.comment_reply_drafts;
-- drop table if exists public.social_comments;
