#!/usr/bin/env node

/**
 * Wave Gate Runner - Cumulative Regression Guard
 * 
 * Usage:
 *   node scripts/run-wave-gate.mjs --wave=0
 *   node scripts/run-wave-gate.mjs --wave=1
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let targetWave = 0;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--wave=')) {
      targetWave = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (isNaN(targetWave) || targetWave < 0 || targetWave > 7) {
    console.error(`[WaveGateRunner] Invalid wave: ${targetWave}. Allowed range: 0-7.`);
    process.exit(1);
  }

  return { targetWave, dryRun };
}

function runCommand(command, cwd) {
  console.log(`\n▶ [EXEC] ${command}`);
  try {
    execSync(command, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: 'true' },
    });
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}

async function main() {
  const { targetWave, dryRun } = parseArgs();

  console.log('\n======================================================');
  console.log(`🛡️  SOHEE 11TH REVISION - WAVE GATE RUNNER`);
  console.log(`🎯 Target Wave: Wave ${targetWave} (Cumulative 0..${targetWave})`);
  console.log(`📂 Working Directory: ${rootDir}`);
  console.log('======================================================\n');

  const summary = [];

  for (let wave = 0; wave <= targetWave; wave++) {
    const manifestPath = path.resolve(rootDir, `qa/11th/waves/wave-${wave}.json`);

    if (!fs.existsSync(manifestPath)) {
      console.error(`❌ [ERROR] Missing wave manifest: ${manifestPath}`);
      process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log(`\n------------------------------------------------------`);
    console.log(`🌊 Executing Wave ${wave}: ${manifest.title}`);
    console.log(`📝 Description: ${manifest.description}`);
    console.log(`📋 Issues: ${manifest.issues.map((i) => i.issue_id).join(', ')}`);
    console.log(`------------------------------------------------------`);

    if (dryRun) {
      console.log(`[DRY RUN] Skipping gates execution for Wave ${wave}`);
      summary.push({ wave, title: manifest.title, gatesCount: manifest.gates.length, status: 'SKIPPED (DRY_RUN)' });
      continue;
    }

    let wavePassed = true;
    const waveStart = Date.now();

    for (const gate of manifest.gates) {
      console.log(`\n🔍 Checking Gate: [${gate.name}] - ${gate.description}`);
      const gateStart = Date.now();
      const res = runCommand(gate.command, rootDir);
      const gateDuration = ((Date.now() - gateStart) / 1000).toFixed(2);

      if (!res.success) {
        console.error(`\n❌ [GATE FAILURE] Gate '${gate.name}' failed in Wave ${wave}!`);
        console.error(`   Command: ${gate.command}`);
        wavePassed = false;
        summary.push({ wave, title: manifest.title, gate: gate.name, duration: `${gateDuration}s`, status: 'FAILED' });
        break;
      } else {
        console.log(`✅ [GATE PASS] Gate '${gate.name}' passed in ${gateDuration}s.`);
      }
    }

    if (!wavePassed) {
      console.error(`\n🚨 [RELEASE BLOCKED] Wave ${wave} Gate failed. Aborting cumulative run.`);
      console.log('\n======================================================');
      console.log('🏁 PARTIAL EXECUTION SUMMARY (FAILURE)');
      console.log('======================================================');
      console.table(summary);
      process.exit(1);
    }

    const waveDuration = ((Date.now() - waveStart) / 1000).toFixed(2);
    summary.push({ wave, title: manifest.title, gatesCount: manifest.gates.length, duration: `${waveDuration}s`, status: 'PASSED' });
  }

  console.log('\n======================================================');
  console.log('🏁 WAVE GATE EXECUTION SUMMARY');
  console.log('======================================================');
  console.table(summary);
  console.log(`\n🎉 All waves 0..${targetWave} PASSED strictly! Cumulative regression guard verified.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[WaveGateRunner] Unhandled error:', err);
  process.exit(1);
});
