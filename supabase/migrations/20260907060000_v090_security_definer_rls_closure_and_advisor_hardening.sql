-- ============================================================================
-- Migration: 20260907060000_v090_security_definer_rls_closure_and_advisor_hardening.sql
-- Issues:
--   [ANI-1004] Supabase SECURITY DEFINER·RLS Least-Privilege Closure
--   [ANI-1005] Supabase Advisor·FK Index·RLS Performance Hardening
-- Description:
--   1. Revoke public/anon/authenticated on privileged RPCs (complete_channel_verification_v12/v11, save_channel_connection_v11)
--      and grant execute exclusively to service_role.
--   2. Explicit RLS enforcement and policy hardening with auth.uid() initplan pattern:
--      (select auth.uid()) to avoid re-evaluating auth functions per row.
--   3. FK covering index creation for hot paths (external_action_*, channel_*, conversation_jobs).
--   4. Access classification enforcement:
--      - SERVER_ONLY: channel_credentials, raw_webhook_events, external_action_attempts
--      - WORKSPACE_READ / USER_MUTABLE: business_profiles, brand_profiles, channel_connections, channel_consents
--      - OPERATOR_ONLY: channel_verification_runs, external_action_receipts
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. [ANI-1004] Least-Privilege RPC Execution Revocation
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- complete_channel_verification_v12
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'complete_channel_verification_v12'
  ) THEN
    REVOKE ALL ON FUNCTION public.complete_channel_verification_v12(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.complete_channel_verification_v12(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
  END IF;

  -- complete_channel_verification_v11
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'complete_channel_verification_v11'
  ) THEN
    REVOKE ALL ON FUNCTION public.complete_channel_verification_v11(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.complete_channel_verification_v11(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
  END IF;

  -- save_channel_connection_v11
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'save_channel_connection_v11'
  ) THEN
    REVOKE ALL ON FUNCTION public.save_channel_connection_v11(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.save_channel_connection_v11(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. [ANI-1005] FK Covering Indexes (Supabase Performance Advisor Hardening)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_channel_verification_runs_action_req
  ON public.channel_verification_runs (action_request_id);

CREATE INDEX IF NOT EXISTS idx_channel_verification_runs_verified_by
  ON public.channel_verification_runs (verified_by);

CREATE INDEX IF NOT EXISTS idx_external_action_attempts_req_id
  ON public.external_action_attempts (action_request_id);

CREATE INDEX IF NOT EXISTS idx_external_action_attempts_ws_id
  ON public.external_action_attempts (workspace_id);

CREATE INDEX IF NOT EXISTS idx_external_action_receipts_req_id
  ON public.external_action_receipts (action_request_id);

CREATE INDEX IF NOT EXISTS idx_external_action_receipts_ws_id
  ON public.external_action_receipts (workspace_id);

CREATE INDEX IF NOT EXISTS idx_channel_consents_granted_by
  ON public.channel_consents (granted_by_user_id);

CREATE INDEX IF NOT EXISTS idx_channel_consents_revoked_by
  ON public.channel_consents (revoked_by_user_id);

CREATE INDEX IF NOT EXISTS idx_conversation_jobs_workspace_user
  ON public.conversation_jobs (workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_channel_connections_connected_by
  ON public.channel_connections (connected_by_user_id);

-- ----------------------------------------------------------------------------
-- 3. [ANI-1004 & ANI-1005] Table Access Classification & RLS Initplan Hardening
-- ----------------------------------------------------------------------------

-- Enable RLS on all relevant tables
ALTER TABLE public.channel_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_action_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_action_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_verification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_consents ENABLE ROW LEVEL SECURITY;

-- 3.1. SERVER_ONLY Tables: Block anon/authenticated direct access completely
-- channel_credentials
DROP POLICY IF EXISTS channel_credentials_server_only ON public.channel_credentials;
CREATE POLICY channel_credentials_server_only ON public.channel_credentials
  AS RESTRICTIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- raw_webhook_events
DROP POLICY IF EXISTS raw_webhook_events_server_only ON public.raw_webhook_events;
CREATE POLICY raw_webhook_events_server_only ON public.raw_webhook_events
  AS RESTRICTIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- external_action_attempts
DROP POLICY IF EXISTS external_action_attempts_server_only ON public.external_action_attempts;
CREATE POLICY external_action_attempts_server_only ON public.external_action_attempts
  AS RESTRICTIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3.2. WORKSPACE_READ Tables: Workspace members can SELECT with Initplan pattern
-- channel_consents
DROP POLICY IF EXISTS channel_consents_select_workspace ON public.channel_consents;
CREATE POLICY channel_consents_select_workspace ON public.channel_consents
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = (SELECT auth.uid())
    )
  );

-- external_action_requests
DROP POLICY IF EXISTS external_action_requests_select_workspace ON public.external_action_requests;
CREATE POLICY external_action_requests_select_workspace ON public.external_action_requests
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = (SELECT auth.uid())
    )
  );

-- external_action_receipts
DROP POLICY IF EXISTS external_action_receipts_select_workspace ON public.external_action_receipts;
CREATE POLICY external_action_receipts_select_workspace ON public.external_action_receipts
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = (SELECT auth.uid())
    )
  );

-- channel_verification_runs
DROP POLICY IF EXISTS channel_verification_runs_select_workspace ON public.channel_verification_runs;
CREATE POLICY channel_verification_runs_select_workspace ON public.channel_verification_runs
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = (SELECT auth.uid())
    )
  );
