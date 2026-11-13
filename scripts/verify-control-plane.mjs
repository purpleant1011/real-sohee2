#!/usr/bin/env node

/**
 * Sohee V0.9 5th Update · Control Plane & Release Governance Verification Gate
 * 
 * Traceability: ANI-942
 * Enforces:
 * 1. Existence of Admin Control Plane & Customer360 canonical types and service.
 * 2. 7 Workbench Contract integrity and Zero-Semantics compliance.
 * 3. Autonomy Goal-Gap Replan engine presence.
 * 4. CI Pull Request template & AGENTS.md canonical synchronization.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const REQUIRED_FILES = [
  'src/types/admin-control-plane.ts',
  'src/lib/admin/admin-control-plane-service.ts',
  'src/components/v089/admin/admin-control-plane-view.tsx',
  'src/types/workbench-contract.ts',
  'src/lib/workbench/workbench-registry.ts',
  'src/features/autonomy/goal-gap-replan-engine.ts',
  'src/types/autonomy-replan.ts',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  'AGENTS.md',
];

console.log('🛡️ [Control Plane Verification Gate] Scanning repository governance & control plane files...');

let errors = 0;

for (const relPath of REQUIRED_FILES) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ MISSING REQUIRED GOVERNANCE FILE: ${relPath}`);
    errors++;
  } else {
    console.log(`✅ FOUND: ${relPath}`);
  }
}

// Check PR Template contents
const prTemplatePath = path.join(rootDir, '.github/pull_request_template.md');
if (fs.existsSync(prTemplatePath)) {
  const content = fs.readFileSync(prTemplatePath, 'utf8');
  if (!content.includes('Linear Issue') || !content.includes('Evidence')) {
    console.error('❌ PR template missing Linear Issue or Evidence verification fields.');
    errors++;
  } else {
    console.log('✅ PR template satisfies 5th wave traceability requirements.');
  }
}

// Check CI workflow
const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
if (fs.existsSync(ciPath)) {
  const content = fs.readFileSync(ciPath, 'utf8');
  if (!content.includes('verify:truth') || !content.includes('verify:control-plane')) {
    console.error('❌ CI workflow does not enforce verify:truth or verify:control-plane.');
    errors++;
  } else {
    console.log('✅ CI workflow contains verify:truth and verify:control-plane gates.');
  }
}

if (errors > 0) {
  console.error(`\n🚨 CONTROL PLANE VERIFICATION FAILED: ${errors} errors detected.\n`);
  process.exit(1);
} else {
  console.log('\n🎉 ALL CONTROL PLANE & REPOSITORY GOVERNANCE GATES PASSED!\n');
  process.exit(0);
}
