-- ============================================================================
-- Migration: 20260909060000_ani1140_security_definer_least_privilege_closure.sql
-- Linear: ANI-1140 ([11차/P0] SECURITY DEFINER 63건 Capability Inventory + Least-Privilege Closure)
-- Supabase Security Advisor Linter: 0029_authenticated_security_definer_function_executable
--
-- Actions:
-- 1. Grant EXECUTE on private security helpers to service_role and authenticated.
-- 2. Switch 3 safe pure-read workspace functions to SECURITY INVOKER.
-- 3. Revoke authenticated, anon, and PUBLIC EXECUTE permissions from all 60 privileged
--    operator, admin, credit mutation/entitlement, and server-only RPCs.
-- 4. Grant EXECUTE exclusively to service_role on all 60 privileged functions.
-- 5. Lock down search_path = public, pg_temp on all 63 functions to prevent search path hijacking.
-- ============================================================================

DO $$
DECLARE
  v_invoker_functions text[] := ARRAY[
    'list_channel_interactions',
    'list_checkout_intents',
    'list_workspace_credit_ledger'
  ];
  
  v_privileged_functions text[] := ARRAY[
    'activate_current_invited_operator',
    'activate_operator_legal_document_version',
    'apply_approved_admin_deactivate',
    'apply_approved_admin_invite',
    'apply_approved_admin_role_change',
    'apply_approved_credit_adjustment',
    'apply_approved_publish_retry',
    'approve_admin_account_approval',
    'approve_admin_approval_request',
    'approve_and_dispatch_local_content',
    'approve_and_dispatch_meta_content',
    'approve_period_content_plan',
    'complete_channel_verification_v12',
    'create_approved_audit_export_job',
    'create_checkout_intent',
    'create_operator_incident',
    'create_operator_legal_document_draft',
    'create_performance_learning_candidate',
    'create_period_content_plan',
    'end_operator_support_session',
    'expire_operator_support_session',
    'get_audit_export_download',
    'get_current_operator_context',
    'get_current_operator_setup_context',
    'get_operator_audit_event_detail',
    'get_operator_onboarding_overview',
    'get_operator_system_observations',
    'get_operator_system_observations_v2',
    'get_operator_workspace_detail',
    'get_workspace_credit_balance',
    'get_workspace_credit_usage_detail',
    'list_operator_admin_approval_requests',
    'list_operator_admin_selector_options',
    'list_operator_admins',
    'list_operator_audit_events',
    'list_operator_audit_export_jobs',
    'list_operator_billing_overview',
    'list_operator_channel_connections',
    'list_operator_channel_connections_v2',
    'list_operator_document_reconsent_targets',
    'list_operator_incidents',
    'list_operator_publish_operations',
    'list_operator_support_sessions',
    'list_operator_support_sessions_v2',
    'list_operator_workspaces',
    'record_current_invited_operator_password_set',
    'record_operator_incident_recovery',
    'recover_expired_publish_attempt',
    'request_admin_account_approval',
    'request_admin_approval',
    'request_conversation_job_cancel',
    'request_operator_workspace_activation',
    'resolve_conversation_job_attention',
    'retire_operator_mfa_exception',
    'review_operator_legal_document_version',
    'review_performance_learning_candidate',
    'revoke_operator_support_session',
    'start_operator_support_session',
    'transition_operator_incident'
  ];

  v_rec record;
  v_sql text;
BEGIN
  -- 0. Grant execute on private security helpers to service_role and authenticated
  GRANT EXECUTE ON FUNCTION private.has_credit_workspace_access(uuid) TO service_role, authenticated;
  GRANT EXECUTE ON FUNCTION private.has_workspace_role(uuid, text[]) TO service_role, authenticated;
  GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid) TO service_role, authenticated;

  -- 1. Convert safe pure-read functions to SECURITY INVOKER and lock search_path
  FOR v_rec IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(v_invoker_functions)
  LOOP
    v_sql := format('ALTER FUNCTION public.%I(%s) SECURITY INVOKER SET search_path = public, pg_temp;', v_rec.proname, v_rec.args);
    EXECUTE v_sql;
  END LOOP;

  -- 2. Revoke authenticated/anon/public from all 60 privileged functions, grant exclusively to service_role, and lock search_path
  FOR v_rec IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(v_privileged_functions)
  LOOP
    -- Revoke from public, anon, authenticated
    v_sql := format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated;', v_rec.proname, v_rec.args);
    EXECUTE v_sql;

    -- Grant execute strictly to service_role
    v_sql := format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role;', v_rec.proname, v_rec.args);
    EXECUTE v_sql;

    -- Ensure search_path is locked
    v_sql := format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp;', v_rec.proname, v_rec.args);
    EXECUTE v_sql;
  END LOOP;

  -- 3. Invalidate PostgREST schema cache
  NOTIFY pgrst, 'reload schema';
END $$;
