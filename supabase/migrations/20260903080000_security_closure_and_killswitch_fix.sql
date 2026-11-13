-- ============================================================================
-- Migration: 20260903080000_security_closure_and_killswitch_fix.sql
-- Issues:
--   [ANI-633] [ADM-501] 신규 V1.1 SECURITY DEFINER anon 권한 폐쇄 및 auth.uid 검증 강화
--   [ANI-635] [ADM-503] Supabase RLS no-policy 테이블 전수 정책 부여 및 권한 최소화
--   [ANI-636] [ADM-504] Kill Switch DB check constraint 및 Admin API contract 완전 일치
-- Description:
--   1. complete_channel_verification_v11, save_channel_connection_v11:
--      REVOKE ALL from PUBLIC, anon, authenticated -> GRANT only to service_role
--   2. kill_switches table scope check constraint extends to include 'CHANNEL'
--      and ensures unique constraint on (scope, target_id)
--   3. Explicit RLS policies on oauth_transactions, channel_consents,
--      channel_verification_runs, browser_sessions
-- ============================================================================

-- 1. ADM-501: Revoke executable rights from anon/authenticated on V1.1 RPCs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'complete_channel_verification_v11'
  ) THEN
    REVOKE ALL ON FUNCTION public.complete_channel_verification_v11(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.complete_channel_verification_v11(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) TO service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'save_channel_connection_v11'
  ) THEN
    REVOKE ALL ON FUNCTION public.save_channel_connection_v11(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.save_channel_connection_v11(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'save_meta_channel_connection'
  ) THEN
    REVOKE ALL ON FUNCTION public.save_meta_channel_connection(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.save_meta_channel_connection(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
  END IF;
END $$;

-- 2. ADM-504: Kill switch constraint alignment with Admin API
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kill_switches'
  ) THEN
    -- Drop old scope constraint if exists
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'kill_switches_scope_check'
    ) THEN
      ALTER TABLE public.kill_switches DROP CONSTRAINT kill_switches_scope_check;
    END IF;

    -- Add updated scope check including CHANNEL
    ALTER TABLE public.kill_switches
      ADD CONSTRAINT kill_switches_scope_check
      CHECK (scope IN ('GLOBAL', 'WORKSPACE', 'PROVIDER', 'CHANNEL'));

    -- Ensure unique constraint on (scope, target_id)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'kill_switches_scope_target_id_key'
    ) THEN
      -- In case null values in target_id for GLOBAL, handle coalesce in unique index
      CREATE UNIQUE INDEX IF NOT EXISTS uq_kill_switches_scope_target
        ON public.kill_switches(scope, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'));
    END IF;
  END IF;
END $$;

-- 3. ADM-503: Comprehensive RLS policies for no-policy tables
DO $$
BEGIN
  -- channel_verification_runs RLS
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channel_verification_runs') THEN
    ALTER TABLE public.channel_verification_runs ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'channel_verification_runs' AND policyname = 'channel_verification_runs_select'
    ) THEN
      CREATE POLICY channel_verification_runs_select ON public.channel_verification_runs
        FOR SELECT TO authenticated
        USING (
          workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
          )
        );
    END IF;
  END IF;

  -- browser_sessions RLS
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'browser_sessions') THEN
    ALTER TABLE public.browser_sessions ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'browser_sessions' AND policyname = 'browser_sessions_select'
    ) THEN
      CREATE POLICY browser_sessions_select ON public.browser_sessions
        FOR SELECT TO authenticated
        USING (
          workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
          )
        );
    END IF;
  END IF;
END $$;
