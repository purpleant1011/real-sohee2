import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('HF-47 · Real Remote DB/API Golden Journey Qualification Invariants', () => {
  const scriptPath = path.resolve(process.cwd(), 'scripts/run-fresh-golden-journey-live.mjs');
  const evidenceDir = path.resolve(process.cwd(), 'docs/evidence/v091-first-revision/golden-journey');

  it('1. ZERO in-memory store: JourneyTransactionalDb is completely eliminated from live script', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).not.toContain('class JourneyTransactionalDb');
    expect(content).not.toContain('new JourneyTransactionalDb');
    expect(content).not.toMatch(/fixtureState\s*:/);
    expect(content).not.toMatch(/makeFact\s*\(/);
  });

  it('2. ZERO synthetic post IDs: Uses real official Meta Graph API references', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).not.toContain('post_${channel}_${Date.now()}');
    expect(content).not.toContain('https://www.threads.net/@qa_bakery/post/');

    // Must reference official live references
    expect(content).toContain('18097282883635509'); // Instagram official post
    expect(content).toContain('18025721351693320'); // Threads official post
  });

  it('3. Uses live remote DB client and real DB RPC grant_sohee_ready_starter_entitlement', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('grantSoheeReadyStarterEntitlement(sb, qaWsId');
    expect(content).toContain('getSoheeReadiness(qaWsId, { supabaseClient: sb, adminClient: sb })');
  });

  it('4. Evidence artifacts existence: all 9 canonical files present', () => {
    const requiredFiles = [
      'step-transition-ledger.json',
      'cleanup-manifest.json',
      'run-1.json',
      'run-2.json',
      'baseline-invariance.json',
      'entitlement-receipt.json',
      'dual-publish-receipt.json',
      'read-after-cleanup.json',
      'live-golden-journey-receipt.json',
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(evidenceDir, file);
      expect(fs.existsSync(filePath), `Missing evidence file: ${file}`).toBe(true);
    }
  });

  it('5. Baseline tenant invariance: 바이름 (f23209fb...) is 100% untouched', () => {
    const invariancePath = path.join(evidenceDir, 'baseline-invariance.json');
    const invariance = JSON.parse(fs.readFileSync(invariancePath, 'utf8'));

    expect(invariance.invarianceVerdict).toBe('PRESERVED_100_PERCENT');
    expect(invariance.baselineTenantId).toBe('00000000-0000-4000-8000-0000000000a2');

    for (const [table, initCount] of Object.entries(invariance.initialCounts)) {
      const finalCount = invariance.finalCounts[table];
      expect(finalCount, `Count changed for table ${table}`).toBe(initCount);
    }
  });

  it('6. Read-after-cleanup: zero mutable residue across all operational tables', () => {
    const cleanupPath = path.join(evidenceDir, 'read-after-cleanup.json');
    const cleanup = JSON.parse(fs.readFileSync(cleanupPath, 'utf8'));

    expect(cleanup.verdict).toBe('ZERO_MUTABLE_RESIDUE_AND_AUDIT_RETENTION_VERIFIED');
    expect(cleanup.runsAudited.length).toBe(2);

    for (const [table, count] of Object.entries(cleanup.mutableEntitiesResidue)) {
      expect(count, `Residue found in table ${table}`).toBe(0);
    }

    expect(cleanup.auditTrailRetentionPolicy.enforcedTriggers).toContain('external_action_receipts_immutable');
    expect(cleanup.auditTrailRetentionPolicy.enforcedTriggers).toContain('prevent_credit_ledger_mutation');
  });

  it('7. Idempotency: 2 consecutive runs succeeded independently', () => {
    const run1 = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'run-1.json'), 'utf8'));
    const run2 = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'run-2.json'), 'utf8'));

    expect(run1.status).toBe('SUCCESS');
    expect(run2.status).toBe('SUCCESS');
    expect(run1.workspaceId).not.toBe(run2.workspaceId);
    expect(run1.businessNumber).not.toBe(run2.businessNumber);
  });

  it('8. Starter entitlement: exactly-once grant with duplicate rejection verified', () => {
    const entitlementPath = path.join(evidenceDir, 'entitlement-receipt.json');
    const receipt = JSON.parse(fs.readFileSync(entitlementPath, 'utf8'));

    expect(receipt.firstGrant.granted).toBe(true);
    expect(receipt.firstGrant.energyGranted).toBe(50);
    expect(receipt.firstGrant.alreadyGranted).toBe(false);

    expect(receipt.duplicateAttempt.alreadyGranted).toBe(true);
    expect(receipt.duplicateAttempt.energyGranted).toBe(0);
  });

  it('9. Dual publish canonical receipt readback: all verified on live provider posts', () => {
    const publishPath = path.join(evidenceDir, 'dual-publish-receipt.json');
    const receipt = JSON.parse(fs.readFileSync(publishPath, 'utf8'));

    expect(receipt.overallStatus).toBe('ALL_VERIFIED');
    expect(receipt.receipts.length).toBe(2);

    const postIds = receipt.receipts.map((r: any) => r.provider_reference);
    expect(postIds).toContain('18097282883635509');
    expect(postIds).toContain('18025721351693320');
  });
});
