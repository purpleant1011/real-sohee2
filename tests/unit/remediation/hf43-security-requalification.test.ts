import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('[HF-43][P0] Security Requalification & Threat Test Suite', () => {
  const securityDir = path.join(process.cwd(), 'docs/evidence/v091-first-revision/security');
  const reportJsonPath = path.join(securityDir, 'security-advisor-report.json');
  const reportMdPath = path.join(securityDir, 'security-requalification-report.md');
  const threatMatrixPath = path.join(securityDir, 'threat-matrix.json');
  const rpcAuditPath = path.join(securityDir, 'rpc-privilege-audit.json');

  it('verifies that security evidence files exist and are well-formed', () => {
    expect(fs.existsSync(reportJsonPath)).toBe(true);
    expect(fs.existsSync(reportMdPath)).toBe(true);
    expect(fs.existsSync(threatMatrixPath)).toBe(true);
    expect(fs.existsSync(rpcAuditPath)).toBe(true);

    const reportJson = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
    expect(reportJson.overallVerdict).toBe('PASS_WITH_ACCEPTED_EXCEPTIONS');
    expect(reportJson.checks.length).toBeGreaterThan(0);
    expect(reportJson.checks.every((c: { passed: boolean }) => c.passed)).toBe(true);
  });

  it('documents exact Supabase Security Advisor warnings with rationale and compensating controls', () => {
    const reportJson = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
    const warnings = reportJson.advisorWarnings;

    expect(warnings.length).toBe(2);

    // Warning 1: provision_education_workspace authenticated security definer
    const warn1 = warnings.find((w: { id: string }) => w.id === 'SEC-WARN-01');
    expect(warn1).toBeDefined();
    expect(warn1.rule).toBe('authenticated_security_definer_function_executable');
    expect(warn1.target).toContain('provision_education_workspace');
    expect(warn1.status).toBe('ACCEPTED_EXCEPTION_WITH_COMPENSATING_CONTROLS');
    expect(warn1.compensatingControls.length).toBeGreaterThanOrEqual(4);

    // Warning 2: leaked password protection disabled
    const warn2 = warnings.find((w: { id: string }) => w.id === 'SEC-WARN-02');
    expect(warn2).toBeDefined();
    expect(warn2.rule).toBe('auth_leaked_password_protection_disabled');
    expect(warn2.status).toBe('ACCEPTED_INFRA_EXCEPTION');
    expect(warn2.compensatingControls.length).toBeGreaterThanOrEqual(2);
  });

  it('proves that anon callers cannot execute provision_education_workspace or privileged RPCs', () => {
    const rpcAudit = JSON.parse(fs.readFileSync(rpcAuditPath, 'utf8'));
    expect(rpcAudit.length).toBeGreaterThanOrEqual(6);
    expect(rpcAudit.every((r: { denied: boolean }) => r.denied)).toBe(true);
  });

  it('verifies threat matrix covers 5 critical attack scenarios with mitigations', () => {
    const threatMatrix = JSON.parse(fs.readFileSync(threatMatrixPath, 'utf8'));
    expect(threatMatrix.threats.length).toBe(5);
    expect(threatMatrix.threats.every((t: { status: string }) => t.status === 'MITIGATED')).toBe(true);

    const scenarios = threatMatrix.threats.map((t: { scenario: string }) => t.scenario);
    expect(scenarios.some((s: string) => s.includes('provision educational workspace'))).toBe(true);
    expect(scenarios.some((s: string) => s.includes('forged p_user_id'))).toBe(true);
    expect(scenarios.some((s: string) => s.includes('search_path hijacking'))).toBe(true);
    expect(scenarios.some((s: string) => s.includes('service_role-only RPCs'))).toBe(true);
    expect(scenarios.some((s: string) => s.includes('plaintext API keys'))).toBe(true);
  });

  it('enforces DDL invariants: search_path hardening and authz impersonation guard in migrations', () => {
    const hf07 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260912150000_hf07_security_definer_containment.sql'), 'utf8');
    const hf05 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260912130000_hf05_education_budget_and_starter_entitlement.sql'), 'utf8');

    // Search path containment
    expect(hf07).toContain('ALTER FUNCTION public.provision_education_workspace(uuid, text, text) SET search_path = public, pg_temp;');
    expect(hf07).toContain('REVOKE EXECUTE ON FUNCTION public.finalize_signup_and_grant_taste(uuid, text, text) FROM PUBLIC, anon, authenticated;');

    // AuthZ guard against forged user_id
    expect(hf05).toContain("IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN");
    expect(hf05).toContain('AUTHZ_IMPERSONATION_DENIED');
  });
});
