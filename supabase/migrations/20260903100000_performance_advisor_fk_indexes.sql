-- ============================================================================
-- Migration: 20260903100000_performance_advisor_fk_indexes.sql
-- Issues:
--   [ANI-644] [ADM-512] Production DB 미인덱스 Foreign Key 색인 추가 및 RLS 중복 정책 정리
-- Description:
--   1. Hot-path and foreign-key indexes on V1.1 and operator tables:
--      - oauth_transactions(workspace_id, user_id)
--      - browser_sessions(workspace_id, user_id)
--      - channel_consents(workspace_id, actor_user_id)
--      - channel_verification_runs(workspace_id, action_request_id, verified_by)
--   2. Cleanup duplicate permissive policies
-- ============================================================================

-- 1. Unindexed Foreign Keys Resolution
CREATE INDEX IF NOT EXISTS idx_oauth_transactions_workspace_id
  ON public.oauth_transactions(workspace_id);

CREATE INDEX IF NOT EXISTS idx_oauth_transactions_user_id
  ON public.oauth_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_workspace_id
  ON public.browser_sessions(workspace_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'browser_sessions' AND column_name = 'created_by'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_browser_sessions_created_by
      ON public.browser_sessions(created_by);
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'browser_sessions' AND column_name = 'user_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_id
      ON public.browser_sessions(user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_channel_consents_workspace_id
  ON public.channel_consents(workspace_id);

CREATE INDEX IF NOT EXISTS idx_channel_consents_actor_user_id
  ON public.channel_consents(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_channel_verification_runs_workspace_id
  ON public.channel_verification_runs(workspace_id);

CREATE INDEX IF NOT EXISTS idx_channel_verification_runs_action_request_id
  ON public.channel_verification_runs(action_request_id);

CREATE INDEX IF NOT EXISTS idx_channel_verification_runs_verified_by
  ON public.channel_verification_runs(verified_by);

-- 2. Clean up multiple permissive policies on external_action_receipts & channel_capabilities
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'external_action_receipts' AND policyname = 'receipts_owner_select') THEN
    DROP POLICY IF EXISTS "receipts_owner_select" ON public.external_action_receipts;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'channel_capabilities' AND policyname = 'channel_capabilities_public_read') THEN
    DROP POLICY IF EXISTS "channel_capabilities_public_read" ON public.channel_capabilities;
  END IF;
END $$;
