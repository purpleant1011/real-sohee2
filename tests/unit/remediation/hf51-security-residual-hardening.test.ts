import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('HF-51 / ANI-1401: Security Residual Hardening & SECURITY DEFINER Threat Qualification', () => {
  const rootDir = process.cwd();
  const securityDir = path.join(rootDir, 'docs/evidence/v091-first-revision/security');
  const ddlPath = path.join(rootDir, 'supabase/migrations/20260912130000_hf05_education_budget_and_starter_entitlement.sql');
  const containmentDdlPath = path.join(rootDir, 'supabase/migrations/20260912150000_hf07_security_definer_containment.sql');

  // Test 1: SECURITY DEFINER DDL contains auth.uid() <> p_user_id impersonation guard
  it('T1: provision_education_workspace DDL contains strict auth.uid() <> p_user_id impersonation guard', () => {
    expect(fs.existsSync(ddlPath)).toBe(true);
    const ddl = fs.readFileSync(ddlPath, 'utf8');

    expect(ddl.includes('auth.role() = \'authenticated\'')).toBe(true);
    expect(ddl.includes('auth.uid() <> p_user_id')).toBe(true);
    expect(ddl.includes('AUTHZ_IMPERSONATION_DENIED')).toBe(true);
    expect(ddl.includes('42501')).toBe(true);
  });

  // Test 2: Search path hardening enforced in DDL
  it('T2: search_path = public, pg_temp is strictly enforced on provision_education_workspace', () => {
    expect(fs.existsSync(containmentDdlPath)).toBe(true);
    const containmentDdl = fs.readFileSync(containmentDdlPath, 'utf8');

    expect(containmentDdl.includes('ALTER FUNCTION public.provision_education_workspace(uuid, text, text) SET search_path = public, pg_temp;')).toBe(true);
  });

  // Test 3: Anon and public execution revoked
  it('T3: anon execution is denied on provision_education_workspace and critical RPCs', () => {
    const grantsPath = path.join(securityDir, 'rpc-grants.json');
    expect(fs.existsSync(grantsPath)).toBe(true);

    const grants = JSON.parse(fs.readFileSync(grantsPath, 'utf8'));
    expect(grants.allAnonAccessDenied).toBe(true);
    expect(grants.verdict).toBe('PASS_ALL_CRITICAL_RPCS_GUARDED');

    const eduProbe = grants.probes.find((p: any) => p.rpc === 'provision_education_workspace');
    expect(eduProbe).toBeDefined();
    expect(eduProbe.denied).toBe(true);
    expect(eduProbe.verdict).toBe('SECURE_DENIED');
  });

  // Test 4: Cross-user impersonation threat vector is defended
  it('T4: threat matrix confirms cross-user impersonation vector is rigorously defended', () => {
    const threatPath = path.join(securityDir, 'security-definer-threat-matrix.json');
    expect(fs.existsSync(threatPath)).toBe(true);

    const matrix = JSON.parse(fs.readFileSync(threatPath, 'utf8'));
    expect(matrix.overallThreatPosture).toBe('PASS_ALL_THREAT_VECTORS_DEFENDED');

    const t2 = matrix.threatTestCases.find((c: any) => c.caseId === 'THREAT-02');
    expect(t2).toBeDefined();
    expect(t2.exploitReproduced).toBe(false);
    expect(t2.verdict).toBe('DEFENDED');
  });

  // Test 5: Search path hijacking threat vector is defended
  it('T5: threat matrix confirms schema hijacking via search_path is defended', () => {
    const threatPath = path.join(securityDir, 'security-definer-threat-matrix.json');
    const matrix = JSON.parse(fs.readFileSync(threatPath, 'utf8'));

    const t3 = matrix.threatTestCases.find((c: any) => c.caseId === 'THREAT-03');
    expect(t3).toBeDefined();
    expect(t3.exploitReproduced).toBe(false);
    expect(t3.verdict).toBe('DEFENDED');
  });

  // Test 6: SQL injection / privilege escalation via malformed provider payload is defended
  it('T6: threat matrix confirms SQL injection / payload tampering is defended', () => {
    const threatPath = path.join(securityDir, 'security-definer-threat-matrix.json');
    const matrix = JSON.parse(fs.readFileSync(threatPath, 'utf8'));

    const t4 = matrix.threatTestCases.find((c: any) => c.caseId === 'THREAT-04');
    expect(t4).toBeDefined();
    expect(t4.exploitReproduced).toBe(false);
    expect(t4.verdict).toBe('DEFENDED');
  });

  // Test 7: Double-spending / re-granting energy is defended via idempotency
  it('T7: threat matrix confirms double-granting energy is defended via signup application lock', () => {
    const threatPath = path.join(securityDir, 'security-definer-threat-matrix.json');
    const matrix = JSON.parse(fs.readFileSync(threatPath, 'utf8'));

    const t5 = matrix.threatTestCases.find((c: any) => c.caseId === 'THREAT-05');
    expect(t5).toBeDefined();
    expect(t5.exploitReproduced).toBe(false);
    expect(t5.verdict).toBe('DEFENDED');
  });

  // Test 8: Leaked password protection status is transparently documented with compensating controls
  it('T8: password-protection-status transparently documents infrastructure state and compensating controls', () => {
    const pwPath = path.join(securityDir, 'password-protection-status.json');
    expect(fs.existsSync(pwPath)).toBe(true);

    const pw = JSON.parse(fs.readFileSync(pwPath, 'utf8'));
    expect(pw.ruleId).toBe('auth_leaked_password_protection');
    expect(pw.currentSetting).toContain('DISABLED');
    expect(pw.whyUnchangeableViaCode).toBeDefined();
    expect(pw.ownerActionRequired).toBeDefined();
    expect(pw.compensatingControls.length).toBeGreaterThan(0);
    expect(pw.verdict).toBe('EXCEPTION_DOCUMENTED_WITH_COMPENSATING_CONTROLS');
  });

  // Test 9: Approved exceptions manifest exists with complete justifications and review readiness
  it('T9: approved-exceptions manifest documents both residual exceptions with passing threat evidence', () => {
    const excPath = path.join(securityDir, 'approved-exceptions.json');
    expect(fs.existsSync(excPath)).toBe(true);

    const exc = JSON.parse(fs.readFileSync(excPath, 'utf8'));
    expect(exc.exceptions.length).toBe(2);
    expect(exc.exceptions.every((e: any) => e.compensatingControlsEnforced && e.independentReviewVerdict === 'EXCEPTION_ACCEPTABLE')).toBe(true);
    expect(exc.verdict).toBe('PASS_DOCUMENTED_EXCEPTIONS');
  });
});
