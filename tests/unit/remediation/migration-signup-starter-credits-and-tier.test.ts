import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Migration Contract: 20261008280000_signup_starter_credits_and_tier.sql', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20261008280000_signup_starter_credits_and_tier.sql'
  )

  it('verifies that forward migration file exists on disk', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
  })

  const sqlContent = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''

  describe('ensure_signup_starter_credits specification', () => {
    it('enforces SECURITY DEFINER, search_path containment, and service_role isolation', () => {
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.ensure_signup_starter_credits(')
      expect(sqlContent).toContain('SECURITY DEFINER')
      expect(sqlContent).toContain("SET search_path = ''")
      expect(sqlContent).toContain('REVOKE ALL ON FUNCTION public.ensure_signup_starter_credits(uuid, uuid) FROM PUBLIC, anon, authenticated;')
      expect(sqlContent).toContain('GRANT EXECUTE ON FUNCTION public.ensure_signup_starter_credits(uuid, uuid) TO service_role;')
    })

    it('enforces active workspace membership check with 42501 errcode', () => {
      expect(sqlContent).toContain("wm.status = 'active'")
      expect(sqlContent).toContain("NOT_ACTIVE_WORKSPACE_MEMBER")
      expect(sqlContent).toContain("USING ERRCODE = '42501'")
    })

    it('uses pg_advisory_xact_lock to serialize per workspace', () => {
      expect(sqlContent).toContain('pg_catalog.pg_advisory_xact_lock(')
      expect(sqlContent).toContain('534846::bigint')
    })

    it('implements 1000 SC target grant and 400 SC topup for existing 600 grant', () => {
      expect(sqlContent).toContain('c_target_grant CONSTANT integer := 1000;')
      expect(sqlContent).toContain("'signup-first-post:' || p_user_id::text")
      expect(sqlContent).toContain("'signup-first-post:topup:' || p_user_id::text")
      expect(sqlContent).toContain('v_grant_amount := 400;')
      expect(sqlContent).toContain('ON CONFLICT (workspace_id, idempotency_key, kind) DO NOTHING;')
      expect(sqlContent).toContain("'already', true")
    })

    it('updates credit_accounts and workspace_credit_states properly', () => {
      expect(sqlContent).toContain('INSERT INTO public.credit_accounts')
      expect(sqlContent).toContain('INSERT INTO public.trial_entitlements')
      expect(sqlContent).toContain('INSERT INTO public.workspace_credit_states')
      expect(sqlContent).toContain('total_available_credits = public.workspace_credit_states.total_available_credits + EXCLUDED.total_available_credits')
    })
  })

  describe('provision_signup_workspace specification', () => {
    it('updates starter credit from 600 to 1000 SC preserving security & locks', () => {
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.provision_signup_workspace(')
      expect(sqlContent).toContain('1000, 0, 0, 1000') // workspace_credit_states
      expect(sqlContent).toContain("'credits_granted', 1000")
      expect(sqlContent).toContain('AUTHZ_IMPERSONATION_DENIED')
      expect(sqlContent).toContain("SET search_path = ''")
    })
  })

  describe('one-time backfill specification', () => {
    it('safely filters production workspaces excluding showcase and terminated lifecycle', () => {
      expect(sqlContent).toContain("w.workspace_kind = 'production'")
      expect(sqlContent).toContain("w.name NOT LIKE '%쇼케이스%'")
      expect(sqlContent).toContain("l.status IS DISTINCT FROM 'terminated'")
      expect(sqlContent).toContain('public.ensure_signup_starter_credits(')
    })
  })

  describe('get_workspace_membership_tier RPC specification', () => {
    it('is STABLE, SECURITY DEFINER, search_path containment and service_role only', () => {
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.get_workspace_membership_tier(')
      expect(sqlContent).toContain('STABLE')
      expect(sqlContent).toContain('SECURITY DEFINER')
      expect(sqlContent).toContain("SET search_path = ''")
      expect(sqlContent).toContain('REVOKE ALL ON FUNCTION public.get_workspace_membership_tier(uuid) FROM PUBLIC, anon, authenticated;')
      expect(sqlContent).toContain('GRANT EXECUTE ON FUNCTION public.get_workspace_membership_tier(uuid) TO service_role;')
    })

    it('maps verification status accurately', () => {
      expect(sqlContent).toContain("WHEN 'VERIFIED' THEN")
      expect(sqlContent).toContain("RETURN 'FORMAL';")
      expect(sqlContent).toContain("WHEN 'REJECTED' THEN")
      expect(sqlContent).toContain("RETURN 'REJECTED';")
      expect(sqlContent).toContain("WHEN 'PENDING', 'DOCUMENT_REQUIRED', 'MISMATCH' THEN")
      expect(sqlContent).toContain("RETURN 'PENDING_REVIEW';")
      expect(sqlContent).toContain("RETURN 'TRIAL';")
    })
  })
})
