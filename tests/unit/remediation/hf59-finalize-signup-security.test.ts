import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('[HF-59][P0] finalize_signup_and_grant_taste Security & Migration Reconciliation', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20260913214500_restore_finalize_signup_grant.sql'
  );

  it('verifies that forward migration file exists on disk', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  const sqlContent = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

  it('Test 1 — authenticated self-user: ensures SECURITY DEFINER and search_path containment', () => {
    expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION public.finalize_signup_and_grant_taste(');
    expect(sqlContent).toContain('SECURITY DEFINER');
    expect(sqlContent).toContain('SET search_path = public, pg_temp');
  });

  it('Test 2 — impersonation: enforces strict auth.uid() <> p_user_id AuthZ guard with 42501', () => {
    expect(sqlContent).toContain("IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN");
    expect(sqlContent).toContain('AUTHZ_IMPERSONATION_DENIED');
    expect(sqlContent).toContain("USING ERRCODE = '42501'");
  });

  it('Test 3 — anon & privilege boundaries: revokes from PUBLIC/anon, grants only to authenticated & service_role', () => {
    expect(sqlContent).toContain('REVOKE ALL ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) FROM PUBLIC;');
    expect(sqlContent).toContain('REVOKE EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) FROM anon;');
    expect(sqlContent).toContain('GRANT EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) TO authenticated;');
    expect(sqlContent).toContain('GRANT EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) TO service_role;');
  });

  it('Test 4 — invalid state: fails closed if signup state is not TASTE_READY or VERIFICATION_PENDING', () => {
    expect(sqlContent).toContain("IF v_signup_app.state NOT IN ('TASTE_READY', 'VERIFICATION_PENDING') THEN");
    expect(sqlContent).toContain("USING ERRCODE = 'P0001'");
  });

  it('Test 5 — agreements: fails closed if agreements_completed is false', () => {
    expect(sqlContent).toContain('IF NOT v_signup_app.agreements_completed THEN');
    expect(sqlContent).toContain('USING ERRCODE = ' + "'P0001'");
  });

  it('Test 6 — invalid business: fails closed on null, placeholder 0000000000, or short number', () => {
    expect(sqlContent).toContain("IF v_signup_app.business_number IS NULL OR v_signup_app.business_number = '0000000000' OR length(v_signup_app.business_number) < 10 THEN");
    expect(sqlContent).toContain("USING ERRCODE = 'P0001'");
  });

  it('Test 7 — retry / idempotency: returns existing workspace when COMPLETED and enforces exactly-once taste claim', () => {
    // Idempotent return for already completed signup
    expect(sqlContent).toContain("IF v_signup_app.state = 'COMPLETED' AND v_signup_app.workspace_id IS NOT NULL THEN");
    expect(sqlContent).toContain("'is_new_workspace', false");

    // Exactly-once free taste claim with unique_violation trap
    expect(sqlContent).toContain('INSERT INTO public.free_taste_claims');
    expect(sqlContent).toContain('EXCEPTION WHEN unique_violation THEN');
    expect(sqlContent).toContain("USING ERRCODE = '23505'");
  });

  it('verifies migration manifest includes 20260913214500 with zero collisions', () => {
    const manifestPath = path.join(process.cwd(), 'supabase/migrations-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = manifest.migrations.find((m: { version: string }) => m.version === '20260913214500');
    expect(entry).toBeDefined();
    expect(entry.filename).toBe('20260913214500_restore_finalize_signup_grant.sql');

    // Ensure all versions are unique
    const versions = manifest.migrations.map((m: { version: string }) => m.version);
    const uniqueVersions = new Set(versions);
    expect(uniqueVersions.size).toBe(versions.length);
  });
});
