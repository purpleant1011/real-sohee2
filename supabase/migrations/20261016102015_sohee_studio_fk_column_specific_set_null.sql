-- ============================================================================
-- Migration: 20261016102015_sohee_studio_fk_column_specific_set_null.sql
-- Purpose: Strengthen sohee_goals and sohee_studio_proposals composite foreign keys
--          to use column-specific ON DELETE SET NULL for nullable columns,
--          preventing NOT NULL constraint violation on workspace_id upon deletion.
-- ============================================================================

-- 1. Fix sohee_goals.source_message_fkey to only set source_message_id to NULL
alter table public.sohee_goals
  drop constraint if exists sohee_goals_source_message_fkey;

alter table public.sohee_goals
  add constraint sohee_goals_source_message_fkey
  foreign key (workspace_id, source_message_id)
  references public.messages (workspace_id, id)
  on delete set null (source_message_id);

-- 2. Fix sohee_studio_proposals.replaces_fact_fkey to only set replaces_fact_id to NULL
alter table public.sohee_studio_proposals
  drop constraint if exists sohee_studio_proposals_replaces_fact_fkey;

alter table public.sohee_studio_proposals
  add constraint sohee_studio_proposals_replaces_fact_fkey
  foreign key (workspace_id, replaces_fact_id)
  references public.knowledge_facts (workspace_id, id)
  on delete set null (replaces_fact_id);
