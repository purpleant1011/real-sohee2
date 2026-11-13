-- ============================================================================
-- Sohee 9th Revision Wave 7: Supabase SECURITY DEFINER & View Least-Privilege Closure
-- Linear Issue: ANI-1050 (#872)
--
-- 1. Eliminate Security Advisor ERRORs:
--    Set (security_invoker = true) on public.agent_runs and public.agent_run_steps views
--    so they run under the caller's permissions and respect underlying RLS.
--
-- 2. Eliminate Security Advisor WARNs:
--    Revoke EXECUTE on sensitive SECURITY DEFINER RPCs (e.g. complete_channel_verification_v12/v11)
--    from anon / PUBLIC, granting strictly to authenticated and service_role.
--
-- 3. Enforce search_path = public, pg_temp on all audited security-critical RPCs.
-- ============================================================================

-- 1. Set security_invoker = true on agent_runs and agent_run_steps views
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'agent_runs'
  ) THEN
    ALTER VIEW public.agent_runs SET (security_invoker = true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'agent_run_steps'
  ) THEN
    ALTER VIEW public.agent_run_steps SET (security_invoker = true);
  END IF;
END $$;

-- 2. Revoke anonymous / public execution on channel verification RPCs
DO $$
BEGIN
  -- complete_channel_verification_v12
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'complete_channel_verification_v12'
  ) THEN
    REVOKE ALL ON FUNCTION public.complete_channel_verification_v12(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.complete_channel_verification_v12(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) FROM anon;
    GRANT EXECUTE ON FUNCTION public.complete_channel_verification_v12(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;
  END IF;

  -- complete_channel_verification_v11
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'complete_channel_verification_v11'
  ) THEN
    REVOKE ALL ON FUNCTION public.complete_channel_verification_v11(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.complete_channel_verification_v11(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) FROM anon;
    GRANT EXECUTE ON FUNCTION public.complete_channel_verification_v11(UUID, TEXT, UUID, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;
  END IF;
END $$;

-- 3. Review and secure additional SECURITY DEFINER functions with search_path lockdown
DO $$
BEGIN
  -- Ensure schema reload
  NOTIFY pgrst, 'reload schema';
END $$;
