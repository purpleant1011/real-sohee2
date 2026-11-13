#!/usr/bin/env node

/**
 * Sohee V0.91 · Commercial Employee Experience & Verified Growth Loop
 * Release Truth & Stage Evidence Evaluator Gate (ANI-1232)
 *
 * Enforces Fail-Closed Verification:
 * - Linear Done / PR merge / test pass does NOT equal RELEASE_READY.
 * - All 11 Closed-Loop Commercial Stages must have verified evidence.
 * - Blocks premature release declarations when downstream stages are NOT_OBSERVED.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const baselinePath = path.join(rootDir, 'evidence/v091-wave0/v091-release-truth-baseline.json');

console.log('⚖️  [Release Truth Evaluator · ANI-1232] Evaluating V0.91 Ground Truth & Commercial Loop Stages...');

if (!fs.existsSync(baselinePath)) {
  console.error(`❌ Missing Release Truth Baseline: ${baselinePath}`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

console.log(`\n📋 Target Milestone: ${baseline.milestone} (${baseline.version})`);
console.log(`📌 Linear Project: ${baseline.linearProject.name} (${baseline.linearProject.id})`);
console.log(`🔗 Base Commit HEAD: ${baseline.baseHead}\n`);

let blockingCount = 0;
let verifiedCount = 0;

for (const stage of baseline.stages) {
  const icon = stage.blocking ? '⏳' : '✅';
  console.log(`  [Stage ${stage.stageIndex.toString().padStart(2, '0')}] ${stage.stageName.padEnd(20)}: ${stage.status.padEnd(30)} ${icon}`);
  console.log(`      ↳ Evidence: ${stage.evidence}`);
  if (stage.blocking) {
    blockingCount++;
    console.log(`      ↳ Blocker Resolution Target: ${stage.targetWave}`);
  } else {
    verifiedCount++;
  }
}

console.log('\n======================================================');
console.log('       V0.91 COMMERCIAL EMPLOYEE RELEASE VERDICT      ');
console.log('======================================================');
console.log(`  Total Stages: ${baseline.stages.length}`);
console.log(`  Verified Stages: ${verifiedCount}`);
console.log(`  Pending/Blocking Stages: ${blockingCount}`);
console.log(`  Verdict: ${baseline.releaseReadyVerdict ? '🟢 RELEASE_READY' : '🔴 NOT_RELEASE_READY (FAIL-CLOSED)'}`);
console.log(`  Reason: ${baseline.releaseReadyReason}`);
console.log('======================================================\n');

// Fail-closed enforcement:
// If releaseReadyVerdict is asserted true while blocking stages exist, fail immediately.
if (baseline.releaseReadyVerdict === true && blockingCount > 0) {
  console.error('🚨 INTEGRITY BREACH: releaseReadyVerdict cannot be TRUE while blocking stages remain unobserved!');
  process.exit(1);
}

// When called with STRICT_RELEASE_CHECK=true (e.g. at production release time), block deployment until all stages are green.
if (process.env.STRICT_RELEASE_CHECK === 'true' && !baseline.releaseReadyVerdict) {
  console.error('🚨 STRICT RELEASE GATE FAILED: Production deployment blocked because V0.91 Commercial Loop is not fully verified.');
  process.exit(1);
}

console.log('✅ RELEASE TRUTH EVALUATION COMPLETED: Ground truth state accurately recorded and fail-closed.');
process.exit(0);
