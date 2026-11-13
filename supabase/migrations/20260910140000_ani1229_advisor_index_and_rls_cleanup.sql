-- Migration: 20260910140000_ani1229_advisor_index_and_rls_cleanup.sql
-- Description: Mission-critical DB Index/RLS Advisor Cleanup (ANI-1229, ANI-1228)

-- 1. Covering index for 13th tables (removes unindexed foreign keys)
CREATE INDEX IF NOT EXISTS idx_marketing_missions_content_version_id ON public.marketing_missions(content_version_id);
CREATE INDEX IF NOT EXISTS idx_reservations_mission_id ON public.reservations(mission_id);

-- 2. Fix RLS initplan (auth.uid() -> (SELECT auth.uid()))
DROP POLICY IF EXISTS marketing_missions_select_policy ON public.marketing_missions;
CREATE POLICY marketing_missions_select_policy ON public.marketing_missions
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS mission_events_select_policy ON public.mission_events;
CREATE POLICY mission_events_select_policy ON public.mission_events
  FOR SELECT USING (
    mission_id IN (
      SELECT id FROM public.marketing_missions WHERE workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS reservations_workspace_isolation ON public.reservations;
CREATE POLICY reservations_workspace_isolation ON public.reservations
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
    )
  );

-- 3. Drop duplicate index and redundant permissive policy
ALTER TABLE public.content_version_media DROP CONSTRAINT IF EXISTS content_version_media_version_position_key;
DROP POLICY IF EXISTS "workspace members can read external action receipts" ON public.external_action_receipts;
