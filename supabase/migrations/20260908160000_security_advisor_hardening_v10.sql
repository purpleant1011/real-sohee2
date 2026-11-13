-- Migration: 20260908160000_security_advisor_hardening_v10.sql
-- Goal: Fix Supabase Security Advisor ERRORs (security_definer_view on agent_runs, agent_run_steps)
-- and WARN (anon-executable complete_channel_verification_v12) (ANI-1090, ANI-1105).

-- 1. Hardening Security Definer Views (ERROR -> 0)
-- In PostgreSQL 15+, views can be set to security_invoker = true to enforce querying user's RLS permissions.
ALTER VIEW IF EXISTS public.agent_runs SET (security_invoker = true);
ALTER VIEW IF EXISTS public.agent_run_steps SET (security_invoker = true);

-- 2. Hardening complete_channel_verification_v12 (WARN -> resolved)
-- Restrict anon & PUBLIC execution; allow only authenticated & service_role
REVOKE EXECUTE ON FUNCTION public.complete_channel_verification_v12(uuid, text, uuid, text, text, text, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_channel_verification_v12(uuid, text, uuid, text, text, text, uuid) TO authenticated, service_role;

-- 3. Confirm RLS and grant invariants for 10th revision tables
ALTER TABLE IF EXISTS public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.content_version_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.creative_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.provider_delivery_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.external_action_receipts ENABLE ROW LEVEL SECURITY;

COMMENT ON VIEW public.agent_runs IS 'Security Invoker view on conversation_jobs (ANI-1090, ANI-1105)';
COMMENT ON VIEW public.agent_run_steps IS 'Security Invoker view on conversation_job_steps (ANI-1090, ANI-1105)';
