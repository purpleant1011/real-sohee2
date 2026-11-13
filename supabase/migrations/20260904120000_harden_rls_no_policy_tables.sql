-- ============================================================================
-- Migration: 20260904120000_harden_rls_no_policy_tables.sql
-- Issues:
--   [ANI-633] [ADM-501] 신규 V1.1 SECURITY DEFINER anon 권한 폐쇄 및 auth.uid 검증 강화
--   [ANI-635] [ADM-503] Supabase RLS no-policy 테이블 전수 정책 부여 및 권한 최소화
-- Description:
--   1. Comprehensive RLS enforcement across all sensitive tables
--   2. Explicitly REVOKE ALL from anon and PUBLIC on all internal and operator tables
--   3. Restrict direct mutations to service_role and allow read-only tenant isolation
-- ============================================================================

DO $$
BEGIN
  -- 1. admin_approval_requests: Operator AAL2 only via RPC, completely close direct access
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_approval_requests') THEN
    ALTER TABLE public.admin_approval_requests ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.admin_approval_requests FROM anon, public;
    GRANT SELECT ON TABLE public.admin_approval_requests TO service_role;
  END IF;

  -- 2. oauth_transactions: Protect anti-replay and single-use state hashes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oauth_transactions') THEN
    ALTER TABLE public.oauth_transactions ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.oauth_transactions FROM anon, public;
    GRANT ALL ON TABLE public.oauth_transactions TO service_role;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oauth_transactions' AND policyname = 'oauth_transactions_tenant_isolation'
    ) THEN
      CREATE POLICY oauth_transactions_tenant_isolation ON public.oauth_transactions
        FOR SELECT TO authenticated
        USING (
          workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
          )
        );
    END IF;
  END IF;

  -- 3. channel_consents: Explicit RLS and no direct mutation from client
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channel_consents') THEN
    ALTER TABLE public.channel_consents ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.channel_consents FROM anon, public;
    GRANT ALL ON TABLE public.channel_consents TO service_role;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'channel_consents' AND policyname = 'channel_consents_tenant_isolation'
    ) THEN
      CREATE POLICY channel_consents_tenant_isolation ON public.channel_consents
        FOR SELECT TO authenticated
        USING (
          workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
          )
        );
    END IF;
  END IF;

  -- 4. channel_verification_runs: Explicit REVOKE and tenant isolation
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channel_verification_runs') THEN
    ALTER TABLE public.channel_verification_runs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.channel_verification_runs FROM anon, public;
    GRANT ALL ON TABLE public.channel_verification_runs TO service_role;
  END IF;

  -- 5. browser_sessions: Protect remote browser cookies and credentials
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'browser_sessions') THEN
    ALTER TABLE public.browser_sessions ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.browser_sessions FROM anon, public;
    GRANT ALL ON TABLE public.browser_sessions TO service_role;
  END IF;

  -- 6. finops_cost_ledger: Operator FinOps ledger - strictly service_role only
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'finops_cost_ledger') THEN
    ALTER TABLE public.finops_cost_ledger ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.finops_cost_ledger FROM anon, public;
    GRANT ALL ON TABLE public.finops_cost_ledger TO service_role;
  END IF;

  -- 7. audit_export_jobs: Operator audit jobs - strictly service_role only
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_export_jobs') THEN
    ALTER TABLE public.audit_export_jobs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.audit_export_jobs FROM anon, public;
    GRANT ALL ON TABLE public.audit_export_jobs TO service_role;
  END IF;

  -- 8. meta_channel_credentials: High security credentials - strictly service_role only
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_channel_credentials') THEN
    ALTER TABLE public.meta_channel_credentials ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.meta_channel_credentials FROM anon, public, authenticated;
    GRANT ALL ON TABLE public.meta_channel_credentials TO service_role;
  END IF;
END $$;
