import fs from 'fs';
import path from 'path';

/**
 * SNS OAuth V1.1 Live E2E Provider Evidence Gate Verifier
 * Issues:
 *   [ANI-638] [ADM-506] SNS OAuth V1.1 Live E2E Provider Evidence Gate 재오픈 및 대사
 * Rules:
 *   - CODE_COMPLETE != VERIFIED != RELEASE_READY != DONE
 *   - Prohibit marking provider evidence ACs as VERIFIED using mock/unit results
 *   - Fail-closed if live provider artifacts are missing
 */

async function verifyProviderEvidenceGate() {
  console.log('====================================================');
  console.log('[Provider Evidence Gate] Starting SNS OAuth V1.1 Audit');
  console.log('====================================================\n');

  const evidenceDir = path.join(process.cwd(), 'evidence');
  const evidenceFile = path.join(evidenceDir, 'provider-live-evidence.json');

  const requiredProviders = ['instagram', 'threads', 'naver'];
  const auditReport = {
    verified_at: new Date().toISOString(),
    overall_status: 'PENDING',
    providers: {},
    findings: []
  };

  let hasLiveEvidenceFile = false;
  let evidenceData = null;

  if (fs.existsSync(evidenceFile)) {
    hasLiveEvidenceFile = true;
    try {
      evidenceData = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
      console.log('[Provider Evidence Gate] Live evidence file found and loaded.');
    } catch (err) {
      auditReport.findings.push(`Malformed evidence file: ${err.message}`);
    }
  } else {
    console.warn('[Provider Evidence Gate] evidence/provider-live-evidence.json not found on disk.');
    auditReport.findings.push('Evidence pack missing: evidence/provider-live-evidence.json does not exist.');
  }

  let allProvidersVerified = true;

  for (const provider of requiredProviders) {
    const pEvidence = evidenceData?.providers?.[provider];
    if (!pEvidence) {
      auditReport.providers[provider] = {
        status: 'NOT_PRODUCTION_VERIFIED',
        reason: `Missing live provider artifact for ${provider}. Mock/unit test passing is insufficient for release gate.`
      };
      auditReport.findings.push(`[NOT_PRODUCTION_VERIFIED] ${provider}: No live E2E run id or provider permalink evidence.`);
      allProvidersVerified = false;
    } else {
      const isValid = pEvidence.run_id && (pEvidence.permalink || pEvidence.provider_object_id) && pEvidence.timestamp && pEvidence.is_live === true;
      if (isValid) {
        auditReport.providers[provider] = {
          status: 'VERIFIED',
          run_id: pEvidence.run_id,
          object_id: pEvidence.provider_object_id || pEvidence.permalink,
          timestamp: pEvidence.timestamp
        };
      } else {
        auditReport.providers[provider] = {
          status: 'NOT_PRODUCTION_VERIFIED',
          reason: 'Incomplete evidence fields (requires is_live=true, run_id, permalink, timestamp).'
        };
        allProvidersVerified = false;
      }
    }
  }

  auditReport.overall_status = allProvidersVerified ? 'RELEASE_READY' : 'NOT_PRODUCTION_VERIFIED';

  const docsDir = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  const reportPath = path.join(docsDir, 'evidence-gate-audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2));

  console.log(`\n[Provider Evidence Gate] Status: ${auditReport.overall_status}`);
  console.log(`[Provider Evidence Gate] Report written to: ${reportPath}`);
  auditReport.findings.forEach(f => console.log(`  - ${f}`));

  console.log('\n====================================================');
  console.log(`Auditor Verdict: ${auditReport.overall_status}`);
  console.log('Rule Enforced: ANI-623 parent issue CANNOT be marked Done without live provider credentials.');
  console.log('====================================================\n');

  return auditReport;
}

verifyProviderEvidenceGate().catch((err) => {
  console.error('[Provider Evidence Gate] Fatal error:', err);
  process.exit(1);
});
