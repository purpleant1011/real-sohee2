-- Migration: 20260912150000_hf07_security_definer_containment.sql
-- Description: [P0-1 & P0-16] Revoke authenticated/anon execute on legacy finalize_signup_and_grant_taste RPC and harden search_path

-- 1. Revoke all public/authenticated execute rights on legacy taste entitlement RPC
REVOKE EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) TO service_role;

-- 2. Harden search_path on critical SECURITY DEFINER functions
ALTER FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.grant_sohee_ready_starter_entitlement(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.provision_education_workspace(uuid, text, text) SET search_path = public, pg_temp;
