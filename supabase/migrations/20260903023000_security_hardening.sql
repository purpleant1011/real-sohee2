-- ============================================================================
-- Supabase Security Hardening & RLS Closure (ANI-566)
-- ============================================================================

-- 1. finops_cost_ledger RLS policy
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'finops_cost_ledger' AND policyname = 'finops_cost_ledger_select') THEN
    CREATE POLICY "finops_cost_ledger_select" ON public.finops_cost_ledger FOR SELECT TO authenticated
    USING (
      workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
      )
    );
  END IF;
END $$;

-- 2. kill_switches RLS policy
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kill_switches' AND policyname = 'kill_switches_select') THEN
    CREATE POLICY "kill_switches_select" ON public.kill_switches FOR SELECT TO authenticated
    USING (true);
  END IF;
END $$;

-- 3. privileged_support_sessions RLS policy
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'privileged_support_sessions' AND policyname = 'privileged_support_sessions_select') THEN
    CREATE POLICY "privileged_support_sessions_select" ON public.privileged_support_sessions FOR SELECT TO authenticated
    USING (
      admin_user_id = (SELECT auth.uid()) OR
      target_workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
      )
    );
  END IF;
END $$;

-- 4. Revoke public execute on internal administrative security definer functions
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT proname, oid
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND prosecdef = true
      AND proname IN ('admin_override_workspace', 'operator_system_action', 'adjust_credit_balance_v1')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;', f.proname);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', f.proname);
  END LOOP;
END $$;
