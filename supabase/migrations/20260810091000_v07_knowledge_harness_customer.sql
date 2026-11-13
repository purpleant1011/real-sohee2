create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_type text not null check (source_type in ('file', 'url', 'manual')),
  provider_mode text not null default 'registered_only'
    check (provider_mode in ('registered_only', 'mock', 'live')),
  channel_type text check (channel_type is null or char_length(channel_type) <= 80),
  uri text check (uri is null or char_length(uri) between 1 and 2048),
  file_asset_id uuid,
  display_name text not null check (char_length(display_name) between 1 and 200),
  status text not null default 'registered' check (
    status in (
      'registered', 'collection_pending', 'processing', 'review_required',
      'conflict', 'approved', 'rejected', 'refresh_required', 'failed', 'paused'
    )
  ),
  refresh_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(refresh_policy) = 'object'),
  last_checked_at timestamptz,
  next_check_at timestamptz,
  error_code text check (error_code is null or char_length(error_code) <= 120),
  version integer not null default 1 check (version > 0),
  created_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_sources_workspace_id_id_key unique (workspace_id, id),
  constraint knowledge_sources_file_asset_fkey
    foreign key (workspace_id, file_asset_id)
    references public.media_assets (workspace_id, id)
    on delete restrict,
  constraint knowledge_sources_shape_check check (
    (source_type = 'file' and file_asset_id is not null and uri is null)
    or (source_type = 'url' and uri is not null and file_asset_id is null)
    or (source_type = 'manual' and uri is null and file_asset_id is null)
  )
);

create index knowledge_sources_workspace_status_idx
  on public.knowledge_sources (workspace_id, status, updated_at desc);
create index knowledge_sources_file_asset_idx
  on public.knowledge_sources (workspace_id, file_asset_id)
  where file_asset_id is not null;

create table public.knowledge_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  knowledge_source_id uuid not null,
  category text not null check (char_length(category) between 1 and 120),
  content text not null check (char_length(content) between 1 and 12000),
  source_excerpt text check (source_excerpt is null or char_length(source_excerpt) <= 2000),
  source_location text check (source_location is null or char_length(source_location) <= 1000),
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  status text not null default 'review_required'
    check (status in ('review_required', 'conflict', 'approved', 'rejected')),
  conflicts_with_fact_id uuid,
  version integer not null default 1 check (version > 0),
  review_reason text check (review_reason is null or char_length(review_reason) <= 1000),
  reviewed_by_user_id uuid references auth.users (id),
  reviewed_at timestamptz,
  created_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_candidates_workspace_id_id_key unique (workspace_id, id),
  constraint knowledge_candidates_source_fkey
    foreign key (workspace_id, knowledge_source_id)
    references public.knowledge_sources (workspace_id, id)
    on delete restrict,
  constraint knowledge_candidates_review_evidence_check check (
    (status in ('review_required', 'conflict') and reviewed_by_user_id is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by_user_id is not null and reviewed_at is not null)
  )
);

create index knowledge_candidates_workspace_status_idx
  on public.knowledge_candidates (workspace_id, status, updated_at desc);
create index knowledge_candidates_source_idx
  on public.knowledge_candidates (workspace_id, knowledge_source_id, created_at desc);

create table public.knowledge_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  category text not null check (char_length(category) between 1 and 120),
  content text not null check (char_length(content) between 1 and 12000),
  status text not null default 'active'
    check (status in ('active', 'superseded', 'expired')),
  source_candidate_id uuid not null,
  approved_by_user_id uuid not null references auth.users (id),
  approved_at timestamptz not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  supersedes_fact_id uuid,
  created_at timestamptz not null default now(),
  constraint knowledge_facts_workspace_id_id_key unique (workspace_id, id),
  constraint knowledge_facts_source_candidate_key unique (workspace_id, source_candidate_id),
  constraint knowledge_facts_source_candidate_fkey
    foreign key (workspace_id, source_candidate_id)
    references public.knowledge_candidates (workspace_id, id)
    on delete restrict,
  constraint knowledge_facts_valid_range_check check (
    valid_until is null or valid_until > valid_from
  )
);

alter table public.knowledge_candidates
  add constraint knowledge_candidates_conflict_fact_fkey
  foreign key (workspace_id, conflicts_with_fact_id)
  references public.knowledge_facts (workspace_id, id)
  on delete restrict;

alter table public.knowledge_facts
  add constraint knowledge_facts_supersedes_fact_fkey
  foreign key (workspace_id, supersedes_fact_id)
  references public.knowledge_facts (workspace_id, id)
  on delete restrict;

create index knowledge_facts_workspace_status_idx
  on public.knowledge_facts (workspace_id, status, category, valid_from desc);
create index knowledge_facts_supersedes_idx
  on public.knowledge_facts (workspace_id, supersedes_fact_id)
  where supersedes_fact_id is not null;

create table public.customer_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel text not null check (
    channel in ('instagram', 'threads', 'naver_blog', 'naver_place')
  ),
  external_subject_reference_hash text not null,
  display_label text not null check (char_length(display_label) between 1 and 120),
  status text not null default 'open'
    check (status in ('open', 'needs_attention', 'waiting_customer', 'resolved', 'archived')),
  intent text check (intent is null or char_length(intent) <= 120),
  summary text not null check (char_length(summary) between 1 and 4000),
  latest_message_at timestamptz,
  inquiry_id uuid,
  booking_id uuid,
  related_content_item_id uuid,
  requires_human_review boolean not null default false,
  created_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_conversations_workspace_id_id_key unique (workspace_id, id),
  constraint customer_conversations_subject_hash_check check (
    external_subject_reference_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint customer_conversations_subject_key
    unique (workspace_id, channel, external_subject_reference_hash),
  constraint customer_conversations_related_content_fkey
    foreign key (workspace_id, related_content_item_id)
    references public.content_items (workspace_id, id)
    on delete set null (related_content_item_id)
);

create index customer_conversations_workspace_attention_idx
  on public.customer_conversations (
    workspace_id, requires_human_review desc, status, latest_message_at desc
  );
create index customer_conversations_related_content_idx
  on public.customer_conversations (workspace_id, related_content_item_id)
  where related_content_item_id is not null;

create table public.harness_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  rule_key text not null check (rule_key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  rule_type text not null check (char_length(rule_type) between 1 and 120),
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  structured_rule jsonb not null check (jsonb_typeof(structured_rule) = 'object'),
  applies_to_channels text[] not null default '{}'::text[] check (
    cardinality(applies_to_channels) <= 4
    and applies_to_channels <@ array[
      'instagram', 'threads', 'naver_blog', 'naver_place'
    ]::text[]
  ),
  status text not null default 'candidate'
    check (status in ('candidate', 'review_required', 'active', 'paused', 'retired')),
  version integer not null default 1 check (version > 0),
  source_message_id uuid,
  source_knowledge_fact_ids uuid[] not null default '{}'::uuid[],
  approved_by_user_id uuid references auth.users (id),
  approved_at timestamptz,
  review_reason text check (review_reason is null or char_length(review_reason) <= 1000),
  created_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint harness_rules_workspace_id_id_key unique (workspace_id, id),
  constraint harness_rules_family_version_key unique (workspace_id, rule_key, version),
  constraint harness_rules_source_message_fkey
    foreign key (workspace_id, source_message_id)
    references public.messages (workspace_id, id)
    on delete restrict,
  constraint harness_rules_approval_evidence_check check (
    (status not in ('active', 'paused'))
    or (approved_by_user_id is not null and approved_at is not null)
  )
);

create index harness_rules_workspace_status_idx
  on public.harness_rules (workspace_id, status, updated_at desc);
create index harness_rules_source_message_idx
  on public.harness_rules (workspace_id, source_message_id)
  where source_message_id is not null;

create or replace function private.validate_harness_rule_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_count integer;
  valid_count integer;
begin
  requested_count := cardinality(new.source_knowledge_fact_ids);

  if requested_count <> (
    select count(distinct fact_id)::integer
    from unnest(new.source_knowledge_fact_ids) as fact_id
  ) then
    raise exception using errcode = '23514', message = 'harness_fact_sources_duplicate';
  end if;

  select count(*)::integer into valid_count
  from public.knowledge_facts
  where workspace_id = new.workspace_id
    and id = any (new.source_knowledge_fact_ids)
    and status = 'active';

  if valid_count <> requested_count then
    raise exception using errcode = '23514', message = 'harness_fact_source_invalid';
  end if;

  return new;
end;
$$;

create trigger knowledge_sources_set_updated_at
before update on public.knowledge_sources
for each row execute function private.set_updated_at();

create trigger knowledge_candidates_set_updated_at
before update on public.knowledge_candidates
for each row execute function private.set_updated_at();

create trigger customer_conversations_set_updated_at
before update on public.customer_conversations
for each row execute function private.set_updated_at();

create trigger harness_rules_set_updated_at
before update on public.harness_rules
for each row execute function private.set_updated_at();

create trigger harness_rules_validate_sources
before insert or update on public.harness_rules
for each row execute function private.validate_harness_rule_sources();

revoke execute on function private.validate_harness_rule_sources()
  from public, anon, authenticated;

create or replace function private.review_knowledge_candidate_internal(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.knowledge_candidates%rowtype;
  actor_id uuid := (select auth.uid());
begin
  if not (select private.has_workspace_role(
    p_workspace_id, array['owner', 'manager']::text[]
  )) then
    raise exception using errcode = '42501', message = 'knowledge_candidate_review_forbidden';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'knowledge_candidate_decision_invalid';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'knowledge_candidate_reason_invalid';
  end if;

  select * into candidate
  from public.knowledge_candidates
  where workspace_id = p_workspace_id and id = p_candidate_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'knowledge_candidate_not_found';
  end if;
  if candidate.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'knowledge_candidate_version_conflict';
  end if;
  if candidate.status <> 'review_required' then
    raise exception using errcode = '23514', message = 'knowledge_candidate_transition_invalid';
  end if;

  if p_decision = 'approve' then
    insert into public.knowledge_facts (
      workspace_id, category, content, status, source_candidate_id,
      approved_by_user_id, approved_at
    ) values (
      p_workspace_id, candidate.category, candidate.content, 'active', candidate.id,
      actor_id, statement_timestamp()
    );
  end if;

  update public.knowledge_candidates
  set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
      review_reason = btrim(p_reason),
      reviewed_by_user_id = actor_id,
      reviewed_at = statement_timestamp(),
      version = version + 1
  where workspace_id = p_workspace_id and id = p_candidate_id;

  return p_candidate_id;
end;
$$;

create or replace function private.resolve_knowledge_conflict_internal(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.knowledge_candidates%rowtype;
  actor_id uuid := (select auth.uid());
  existing_fact public.knowledge_facts%rowtype;
begin
  if not (select private.has_workspace_role(
    p_workspace_id, array['owner', 'manager']::text[]
  )) then
    raise exception using errcode = '42501', message = 'knowledge_conflict_review_forbidden';
  end if;
  if p_decision not in ('replace', 'keep_existing', 'reject') then
    raise exception using errcode = '22023', message = 'knowledge_conflict_decision_invalid';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'knowledge_conflict_reason_invalid';
  end if;

  select * into candidate
  from public.knowledge_candidates
  where workspace_id = p_workspace_id and id = p_candidate_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'knowledge_candidate_not_found';
  end if;
  if candidate.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'knowledge_candidate_version_conflict';
  end if;
  if candidate.status <> 'conflict' or candidate.conflicts_with_fact_id is null then
    raise exception using errcode = '23514', message = 'knowledge_conflict_transition_invalid';
  end if;

  select * into existing_fact
  from public.knowledge_facts
  where workspace_id = p_workspace_id
    and id = candidate.conflicts_with_fact_id
    and status = 'active'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'knowledge_conflicting_fact_not_found';
  end if;

  if p_decision = 'replace' then
    update public.knowledge_facts
    set status = 'superseded', valid_until = statement_timestamp()
    where workspace_id = p_workspace_id and id = existing_fact.id;

    insert into public.knowledge_facts (
      workspace_id, category, content, status, source_candidate_id,
      approved_by_user_id, approved_at, supersedes_fact_id
    ) values (
      p_workspace_id, candidate.category, candidate.content, 'active', candidate.id,
      actor_id, statement_timestamp(), existing_fact.id
    );
  end if;

  update public.knowledge_candidates
  set status = case p_decision when 'replace' then 'approved' else 'rejected' end,
      review_reason = btrim(p_reason),
      reviewed_by_user_id = actor_id,
      reviewed_at = statement_timestamp(),
      version = version + 1
  where workspace_id = p_workspace_id and id = p_candidate_id;

  return p_candidate_id;
end;
$$;

create or replace function private.review_harness_rule_internal(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.harness_rules%rowtype;
  actor_id uuid := (select auth.uid());
begin
  if not (select private.has_workspace_role(
    p_workspace_id, array['owner', 'manager']::text[]
  )) then
    raise exception using errcode = '42501', message = 'harness_rule_review_forbidden';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'harness_rule_decision_invalid';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'harness_rule_reason_invalid';
  end if;

  select * into rule
  from public.harness_rules
  where workspace_id = p_workspace_id and id = p_rule_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'harness_rule_not_found';
  end if;
  if rule.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'harness_rule_version_conflict';
  end if;
  if rule.status not in ('candidate', 'review_required') then
    raise exception using errcode = '23514', message = 'harness_rule_transition_invalid';
  end if;

  update public.harness_rules
  set status = case p_decision when 'approve' then 'active' else 'retired' end,
      approved_by_user_id = case p_decision when 'approve' then actor_id else null end,
      approved_at = case p_decision when 'approve' then statement_timestamp() else null end,
      review_reason = btrim(p_reason),
      version = version + 1
  where workspace_id = p_workspace_id and id = p_rule_id;

  return p_rule_id;
end;
$$;

create or replace function private.pause_harness_rule_internal(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.harness_rules%rowtype;
  next_status text;
begin
  if not (select private.has_workspace_role(
    p_workspace_id, array['owner', 'manager']::text[]
  )) then
    raise exception using errcode = '42501', message = 'harness_rule_lifecycle_forbidden';
  end if;
  if p_decision not in ('pause', 'resume', 'retire') then
    raise exception using errcode = '22023', message = 'harness_rule_lifecycle_decision_invalid';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'harness_rule_reason_invalid';
  end if;

  select * into rule
  from public.harness_rules
  where workspace_id = p_workspace_id and id = p_rule_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'harness_rule_not_found';
  end if;
  if rule.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'harness_rule_version_conflict';
  end if;

  if p_decision = 'pause' and rule.status = 'active' then
    next_status := 'paused';
  elsif p_decision = 'resume' and rule.status = 'paused' then
    next_status := 'active';
  elsif p_decision = 'retire' and rule.status in ('active', 'paused') then
    next_status := 'retired';
  else
    raise exception using errcode = '23514', message = 'harness_rule_transition_invalid';
  end if;

  update public.harness_rules
  set status = next_status,
      review_reason = btrim(p_reason),
      version = version + 1
  where workspace_id = p_workspace_id and id = p_rule_id;

  return p_rule_id;
end;
$$;

create or replace function public.review_knowledge_candidate(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.review_knowledge_candidate_internal($1, $2, $3, $4, $5);
$$;

create or replace function public.resolve_knowledge_conflict(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.resolve_knowledge_conflict_internal($1, $2, $3, $4, $5);
$$;

create or replace function public.review_harness_rule(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.review_harness_rule_internal($1, $2, $3, $4, $5);
$$;

create or replace function public.pause_harness_rule(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_decision text,
  p_reason text,
  p_expected_version integer
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.pause_harness_rule_internal($1, $2, $3, $4, $5);
$$;

revoke execute on function private.review_knowledge_candidate_internal(uuid, uuid, text, text, integer)
  from public, anon;
revoke execute on function private.resolve_knowledge_conflict_internal(uuid, uuid, text, text, integer)
  from public, anon;
revoke execute on function private.review_harness_rule_internal(uuid, uuid, text, text, integer)
  from public, anon;
revoke execute on function private.pause_harness_rule_internal(uuid, uuid, text, text, integer)
  from public, anon;
grant execute on function private.review_knowledge_candidate_internal(uuid, uuid, text, text, integer)
  to authenticated;
grant execute on function private.resolve_knowledge_conflict_internal(uuid, uuid, text, text, integer)
  to authenticated;
grant execute on function private.review_harness_rule_internal(uuid, uuid, text, text, integer)
  to authenticated;
grant execute on function private.pause_harness_rule_internal(uuid, uuid, text, text, integer)
  to authenticated;

revoke execute on function public.review_knowledge_candidate(uuid, uuid, text, text, integer)
  from public, anon;
revoke execute on function public.resolve_knowledge_conflict(uuid, uuid, text, text, integer)
  from public, anon;
revoke execute on function public.review_harness_rule(uuid, uuid, text, text, integer)
  from public, anon;
revoke execute on function public.pause_harness_rule(uuid, uuid, text, text, integer)
  from public, anon;
grant execute on function public.review_knowledge_candidate(uuid, uuid, text, text, integer)
  to authenticated;
grant execute on function public.resolve_knowledge_conflict(uuid, uuid, text, text, integer)
  to authenticated;
grant execute on function public.review_harness_rule(uuid, uuid, text, text, integer)
  to authenticated;
grant execute on function public.pause_harness_rule(uuid, uuid, text, text, integer)
  to authenticated;

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_candidates enable row level security;
alter table public.knowledge_facts enable row level security;
alter table public.customer_conversations enable row level security;
alter table public.harness_rules enable row level security;

create policy "workspace members can read knowledge sources"
on public.knowledge_sources for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace managers can create knowledge sources"
on public.knowledge_sources for insert to authenticated
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager']::text[]
)));
create policy "workspace managers can update knowledge sources"
on public.knowledge_sources for update to authenticated
using ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager']::text[]
)))
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager']::text[]
)));

create policy "workspace members can read knowledge candidates"
on public.knowledge_candidates for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace managers can create review candidates"
on public.knowledge_candidates for insert to authenticated
with check (
  status in ('review_required', 'conflict')
  and reviewed_by_user_id is null
  and reviewed_at is null
  and (select private.has_workspace_role(
    workspace_id, array['owner', 'manager']::text[]
  ))
);

create policy "workspace members can read approved knowledge facts"
on public.knowledge_facts for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read customer summaries"
on public.customer_conversations for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace collaborators can create customer summaries"
on public.customer_conversations for insert to authenticated
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));
create policy "workspace collaborators can update customer summaries"
on public.customer_conversations for update to authenticated
using ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)))
with check ((select private.has_workspace_role(
  workspace_id, array['owner', 'manager', 'reviewer']::text[]
)));

create policy "workspace members can read harness rules"
on public.harness_rules for select to authenticated
using ((select private.is_workspace_member(workspace_id)));
create policy "workspace managers can create harness candidates"
on public.harness_rules for insert to authenticated
with check (
  status in ('candidate', 'review_required')
  and approved_by_user_id is null
  and approved_at is null
  and (select private.has_workspace_role(
    workspace_id, array['owner', 'manager']::text[]
  ))
);

revoke all on public.knowledge_sources from anon, authenticated;
revoke all on public.knowledge_candidates from anon, authenticated;
revoke all on public.knowledge_facts from anon, authenticated;
revoke all on public.customer_conversations from anon, authenticated;
revoke all on public.harness_rules from anon, authenticated;

grant select, insert on public.knowledge_sources to authenticated;
grant update (
  provider_mode, channel_type, uri, file_asset_id, display_name, status,
  refresh_policy, last_checked_at, next_check_at, error_code, version
) on public.knowledge_sources to authenticated;
grant select on public.knowledge_candidates to authenticated;
grant insert (
  id, workspace_id, knowledge_source_id, category, content, source_excerpt,
  source_location, confidence, status, conflicts_with_fact_id, created_by_user_id
) on public.knowledge_candidates to authenticated;
grant select on public.knowledge_facts to authenticated;
grant select, insert on public.customer_conversations to authenticated;
grant update (
  display_label, status, intent, summary, latest_message_at, inquiry_id,
  booking_id, related_content_item_id, requires_human_review
) on public.customer_conversations to authenticated;
grant select on public.harness_rules to authenticated;
grant insert (
  id, workspace_id, rule_key, rule_type, title, description, structured_rule,
  applies_to_channels, status, source_message_id, source_knowledge_fact_ids,
  created_by_user_id
) on public.harness_rules to authenticated;

grant select, insert, update, delete on public.knowledge_sources to service_role;
grant select, insert, update, delete on public.knowledge_candidates to service_role;
grant select, insert, update, delete on public.knowledge_facts to service_role;
grant select, insert, update, delete on public.customer_conversations to service_role;
grant select, insert, update, delete on public.harness_rules to service_role;
