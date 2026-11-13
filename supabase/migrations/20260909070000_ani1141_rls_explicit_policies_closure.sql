-- ============================================================================
-- Migration: 20260909070000_ani1141_rls_explicit_policies_closure.sql
-- Linear: ANI-1141 ([11차/P1] RLS Enabled No Policy 24건 + Auth Leaked Password Protection 종결)
-- Supabase Security Advisor Linter: 0008_rls_enabled_no_policy
--
-- Actions:
-- 1. Create explicit service_role policies for 18 SERVER_ONLY / OPERATOR_ONLY tables.
-- 2. Create authenticated SELECT and service_role ALL policies for 2 REFERENCE tables.
-- 3. Create workspace-scoped SELECT and service_role ALL policies for 4 WORKSPACE tables.
-- 4. Eliminate all 24 rls_enabled_no_policy INFO warnings in Supabase Security Advisor.
-- ============================================================================

DO $$
DECLARE
  v_server_only_tables text[] := ARRAY[
    'admin_approval_requests',
    'admin_invite_intents',
    'audit_export_jobs',
    'channel_delivery_attempts',
    'data_deletion_requests',
    'media_asset_quarantine_backup',
    'meta_channel_credentials',
    'oauth_state_nonces',
    'operator_audit_sessions',
    'operator_incident_timeline',
    'operator_queue_observation_snapshots',
    'operator_release_observation_snapshots',
    'operator_system_observation_snapshots',
    'platform_admin_members',
    'platform_admin_role_assignments',
    'platform_audit_events',
    'platform_role_permissions',
    'platform_roles'
  ];

  v_table text;
  v_sql text;
BEGIN
  -- 1. SERVER_ONLY / OPERATOR_ONLY tables (18 tables)
  FOREACH v_table IN ARRAY v_server_only_tables
  LOOP
    -- Ensure RLS is active
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_table);

    -- Drop existing policy if any
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all" ON public.%I;', v_table);
    EXECUTE format('DROP POLICY IF EXISTS "%s_service_role_all" ON public.%I;', v_table, v_table);

    -- Create explicit service_role policy
    v_sql := format('CREATE POLICY "service_role_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);', v_table);
    EXECUTE v_sql;

    -- Revoke all from anon/authenticated just in case table grants existed
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', v_table);
  END LOOP;

  -- 2. REFERENCE tables (2 tables: billing_plans, credit_rate_versions)
  -- billing_plans
  ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "authenticated_select" ON public.billing_plans;
  DROP POLICY IF EXISTS "service_role_all" ON public.billing_plans;
  CREATE POLICY "authenticated_select" ON public.billing_plans FOR SELECT TO authenticated USING (true);
  CREATE POLICY "service_role_all" ON public.billing_plans FOR ALL TO service_role USING (true) WITH CHECK (true);
  GRANT SELECT ON public.billing_plans TO authenticated;
  GRANT ALL ON public.billing_plans TO service_role;

  -- credit_rate_versions
  ALTER TABLE public.credit_rate_versions ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "authenticated_select" ON public.credit_rate_versions;
  DROP POLICY IF EXISTS "service_role_all" ON public.credit_rate_versions;
  CREATE POLICY "authenticated_select" ON public.credit_rate_versions FOR SELECT TO authenticated USING (true);
  CREATE POLICY "service_role_all" ON public.credit_rate_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
  GRANT SELECT ON public.credit_rate_versions TO authenticated;
  GRANT ALL ON public.credit_rate_versions TO service_role;

  -- 3. WORKSPACE_SCOPED tables (4 tables)
  -- channel_delegations
  ALTER TABLE public.channel_delegations ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "workspace_select" ON public.channel_delegations;
  DROP POLICY IF EXISTS "service_role_all" ON public.channel_delegations;
  CREATE POLICY "workspace_select" ON public.channel_delegations FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = (SELECT auth.uid())));
  CREATE POLICY "service_role_all" ON public.channel_delegations FOR ALL TO service_role USING (true) WITH CHECK (true);
  GRANT SELECT ON public.channel_delegations TO authenticated;
  GRANT ALL ON public.channel_delegations TO service_role;

  -- social_attribution_events
  ALTER TABLE public.social_attribution_events ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "workspace_select" ON public.social_attribution_events;
  DROP POLICY IF EXISTS "service_role_all" ON public.social_attribution_events;
  CREATE POLICY "workspace_select" ON public.social_attribution_events FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = (SELECT auth.uid())));
  CREATE POLICY "service_role_all" ON public.social_attribution_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  GRANT SELECT ON public.social_attribution_events TO authenticated;
  GRANT ALL ON public.social_attribution_events TO service_role;

  -- workspace_agreements
  ALTER TABLE public.workspace_agreements ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "workspace_select" ON public.workspace_agreements;
  DROP POLICY IF EXISTS "service_role_all" ON public.workspace_agreements;
  CREATE POLICY "workspace_select" ON public.workspace_agreements FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = (SELECT auth.uid())));
  CREATE POLICY "service_role_all" ON public.workspace_agreements FOR ALL TO service_role USING (true) WITH CHECK (true);
  GRANT SELECT ON public.workspace_agreements TO authenticated;
  GRANT ALL ON public.workspace_agreements TO service_role;

  -- workspace_lifecycles
  ALTER TABLE public.workspace_lifecycles ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "workspace_select" ON public.workspace_lifecycles;
  DROP POLICY IF EXISTS "service_role_all" ON public.workspace_lifecycles;
  CREATE POLICY "workspace_select" ON public.workspace_lifecycles FOR SELECT TO authenticated
    USING (workspace_id IN (SELECT wm.workspace_id FROM public.workspace_members wm WHERE wm.user_id = (SELECT auth.uid())));
  CREATE POLICY "service_role_all" ON public.workspace_lifecycles FOR ALL TO service_role USING (true) WITH CHECK (true);
  GRANT SELECT ON public.workspace_lifecycles TO authenticated;
  GRANT ALL ON public.workspace_lifecycles TO service_role;

  NOTIFY pgrst, 'reload schema';
END $$;
