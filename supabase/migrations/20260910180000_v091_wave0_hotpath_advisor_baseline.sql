-- Migration: 20260910180000_v091_wave0_hotpath_advisor_baseline.sql
-- Description: V0.91 Wave 0 Hot-Path Advisor Hardening (ANI-1236)
-- Resolves Auth RLS InitPlan, Multiple Permissive Policies, and P0/P1 Foreign Key Covering Indexes

-- ==============================================================================
-- 1. P0/P1 Hot Path Foreign Key Covering Indexes
-- ==============================================================================

-- conversation_jobs
CREATE INDEX IF NOT EXISTS idx_conversation_jobs_reservation_id 
  ON public.conversation_jobs(reservation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_jobs_workspace_thread 
  ON public.conversation_jobs(workspace_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_conversation_jobs_workspace_thread_user_msg 
  ON public.conversation_jobs(workspace_id, thread_id, user_message_id);

CREATE INDEX IF NOT EXISTS idx_conversation_jobs_workspace_thread_asst_msg 
  ON public.conversation_jobs(workspace_id, thread_id, assistant_message_id);

-- credit_ledger_entries & credit_reservations
CREATE INDEX IF NOT EXISTS idx_credit_ledger_entries_account_id 
  ON public.credit_ledger_entries(account_id);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_account_id 
  ON public.credit_reservations(account_id);

-- external_action_requests & external_action_receipts
CREATE INDEX IF NOT EXISTS idx_external_action_requests_ws_approval 
  ON public.external_action_requests(workspace_id, approval_id);

CREATE INDEX IF NOT EXISTS idx_external_action_requests_ws_content_version 
  ON public.external_action_requests(workspace_id, content_version_id);

CREATE INDEX IF NOT EXISTS idx_external_action_requests_ws_browser_conn 
  ON public.external_action_requests(workspace_id, browser_channel_connection_id);

CREATE INDEX IF NOT EXISTS idx_external_action_receipts_ws_attempt 
  ON public.external_action_receipts(workspace_id, attempt_id);

-- performance_learning_candidates
CREATE INDEX IF NOT EXISTS idx_perf_learning_candidates_report_snapshot 
  ON public.performance_learning_candidates(source_report_snapshot_id);

-- ==============================================================================
-- 2. Resolve Multiple Permissive Policies & Redundant RLS
-- ==============================================================================

-- Drop redundant duplicate policies that caused multiple permissive warnings and initplan warnings
DROP POLICY IF EXISTS "channel_consents_workspace_members_select" ON public.channel_consents;
DROP POLICY IF EXISTS "oauth_transactions_owner_select" ON public.oauth_transactions;
DROP POLICY IF EXISTS "channel_capabilities_read_all" ON public.channel_capabilities;

-- ==============================================================================
-- 3. Fix Auth RLS InitPlan (Replace auth.uid() with (SELECT auth.uid()))
-- ==============================================================================

-- creative_bundles
DROP POLICY IF EXISTS "workspaces_select_creative_bundles" ON public.creative_bundles;
CREATE POLICY "workspaces_select_creative_bundles" ON public.creative_bundles
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_members.workspace_id
      FROM public.workspace_members
      WHERE workspace_members.user_id = (SELECT auth.uid())
    )
  );

-- creative_bundle_media
DROP POLICY IF EXISTS "workspaces_select_creative_bundle_media" ON public.creative_bundle_media;
CREATE POLICY "workspaces_select_creative_bundle_media" ON public.creative_bundle_media
  FOR SELECT TO authenticated
  USING (
    bundle_id IN (
      SELECT creative_bundles.id
      FROM public.creative_bundles
      WHERE creative_bundles.workspace_id IN (
        SELECT workspace_members.workspace_id
        FROM public.workspace_members
        WHERE workspace_members.user_id = (SELECT auth.uid())
      )
    )
  );

-- publish_renditions
DROP POLICY IF EXISTS "workspaces_select_publish_renditions" ON public.publish_renditions;
CREATE POLICY "workspaces_select_publish_renditions" ON public.publish_renditions
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_members.workspace_id
      FROM public.workspace_members
      WHERE workspace_members.user_id = (SELECT auth.uid())
    )
  );

-- provider_delivery_leases
DROP POLICY IF EXISTS "workspaces_select_provider_delivery_leases" ON public.provider_delivery_leases;
CREATE POLICY "workspaces_select_provider_delivery_leases" ON public.provider_delivery_leases
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_members.workspace_id
      FROM public.workspace_members
      WHERE workspace_members.user_id = (SELECT auth.uid())
    )
  );

-- verified_proof_receipts
DROP POLICY IF EXISTS "workspaces_select_verified_proof_receipts" ON public.verified_proof_receipts;
CREATE POLICY "workspaces_select_verified_proof_receipts" ON public.verified_proof_receipts
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_members.workspace_id
      FROM public.workspace_members
      WHERE workspace_members.user_id = (SELECT auth.uid())
    )
  );

-- generation_runs
DROP POLICY IF EXISTS "workspaces_select_generation_runs" ON public.generation_runs;
CREATE POLICY "workspaces_select_generation_runs" ON public.generation_runs
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_members.workspace_id
      FROM public.workspace_members
      WHERE workspace_members.user_id = (SELECT auth.uid())
    )
  );

-- workspace_runtime_control_states
DROP POLICY IF EXISTS "workspace_runtime_control_states_read_member" ON public.workspace_runtime_control_states;
CREATE POLICY "workspace_runtime_control_states_read_member" ON public.workspace_runtime_control_states
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_runtime_control_states.workspace_id
        AND wm.user_id = (SELECT auth.uid())
    )
  );

-- browser_sessions
DROP POLICY IF EXISTS "browser_sessions_select" ON public.browser_sessions;
CREATE POLICY "browser_sessions_select" ON public.browser_sessions
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_members.workspace_id
      FROM public.workspace_members
      WHERE workspace_members.user_id = (SELECT auth.uid())
    )
  );

-- channel_verification_runs
DROP POLICY IF EXISTS "channel_verification_runs_select" ON public.channel_verification_runs;
CREATE POLICY "channel_verification_runs_select" ON public.channel_verification_runs
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_members.workspace_id
      FROM public.workspace_members
      WHERE workspace_members.user_id = (SELECT auth.uid())
    )
  );
