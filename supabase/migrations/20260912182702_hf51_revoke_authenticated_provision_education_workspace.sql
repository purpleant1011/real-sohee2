-- ==============================================================================
-- HF-51: Revoke authenticated EXECUTE on provision_education_workspace (ANI-1401)
-- Fix Supabase Security Advisor Lint 0029 (authenticated_security_definer_function_executable)
-- The function remains SECURITY DEFINER, but is now exclusively callable by service_role.
-- Server-side routes authenticate user session and call this RPC via createAdminSupabaseClient().
-- ==============================================================================

REVOKE EXECUTE ON FUNCTION public.provision_education_workspace(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provision_education_workspace(UUID, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.provision_education_workspace(UUID, TEXT, TEXT) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.provision_education_workspace(UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.provision_education_workspace(UUID, TEXT, TEXT) IS 
  'HF-51: SECURITY DEFINER education workspace provisioning, strictly isolated to service_role to prevent authenticated RPC bypass.';
