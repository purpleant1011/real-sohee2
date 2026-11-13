create index if not exists customer_conversations_created_by_idx
  on public.customer_conversations (created_by_user_id)
  where created_by_user_id is not null;

create index if not exists harness_rules_approved_by_idx
  on public.harness_rules (approved_by_user_id)
  where approved_by_user_id is not null;

create index if not exists harness_rules_created_by_idx
  on public.harness_rules (created_by_user_id)
  where created_by_user_id is not null;

create index if not exists knowledge_candidates_conflict_fact_idx
  on public.knowledge_candidates (workspace_id, conflicts_with_fact_id)
  where conflicts_with_fact_id is not null;

create index if not exists knowledge_candidates_created_by_idx
  on public.knowledge_candidates (created_by_user_id)
  where created_by_user_id is not null;

create index if not exists knowledge_candidates_reviewed_by_idx
  on public.knowledge_candidates (reviewed_by_user_id)
  where reviewed_by_user_id is not null;

create index if not exists knowledge_facts_approved_by_idx
  on public.knowledge_facts (approved_by_user_id)
  where approved_by_user_id is not null;

create index if not exists knowledge_sources_created_by_idx
  on public.knowledge_sources (created_by_user_id)
  where created_by_user_id is not null;

create index if not exists messages_created_by_idx
  on public.messages (created_by_user_id)
  where created_by_user_id is not null;

create index if not exists messages_reply_to_idx
  on public.messages (workspace_id, thread_id, reply_to_message_id)
  where reply_to_message_id is not null;

create index if not exists work_items_created_by_idx
  on public.work_items (created_by)
  where created_by is not null;

create index if not exists work_items_owner_user_idx
  on public.work_items (owner_user_id)
  where owner_user_id is not null;

create index if not exists work_items_source_thread_message_idx
  on public.work_items (workspace_id, source_thread_id, source_message_id)
  where source_thread_id is not null;

grant insert (completed_at) on public.messages to authenticated;
