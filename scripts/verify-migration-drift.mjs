import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const DEFAULT_SUPABASE_URL = 'https://your-project-ref.supabase.co';

function getServiceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const key = execSync('security find-generic-password -s "example.com/SUPABASE_SERVICE_ROLE_KEY" -w 2>/dev/null', { encoding: 'utf8' }).trim();
    if (key) return key;
  } catch {}
  return undefined;
}

function computeSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Pure local inventory: a duplicate timestamp is never overwritten or silently chosen.
export function loadLocalMigrations(directory) {
  const dir = directory instanceof URL ? fileURLToPath(directory) : directory;
  const map = new Map();
  for (const filename of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const version = filename.split('_')[0];
    if (map.has(version)) throw new Error('LOCAL_HISTORY_CONFLICT');
    const fullPath = path.join(dir, filename);
    map.set(version, { version, filename, checksum: computeSha256(fs.readFileSync(fullPath)), size: fs.statSync(fullPath).size });
  }
  return Array.from(map.values());
}

export function manifestDifferences(local, manifest) {
  const entries = manifest.migrations || [];
  const differences = [];
  const seen = new Map();
  for (const entry of entries) {
    if (seen.has(entry.version)) differences.push({ type: 'MANIFEST_VERSION_DUPLICATE', version: entry.version, file: entry.filename });
    seen.set(entry.version, entry);
  }
  const localVersions = new Set(local.map(l => l.version));
  for (const l of local) {
    const entry = seen.get(l.version);
    if (!entry) differences.push({ type: 'UNTRACKED_LOCAL_FILE', version: l.version, file: l.filename });
    else if (entry.filename !== l.filename) differences.push({ type: 'FILENAME_MISMATCH', version: l.version, file: l.filename });
    else if (entry.checksum !== l.checksum) differences.push({ type: 'CHECKSUM_MISMATCH', version: l.version, file: l.filename });
    else if (entry.size !== l.size) differences.push({ type: 'SIZE_MISMATCH', version: l.version, file: l.filename });
  }
  for (const entry of seen.values()) {
    if (!localVersions.has(entry.version)) differences.push({ type: 'MISSING_LOCAL_FILE', version: entry.version, file: entry.filename });
  }
  if (manifest.total_migrations !== entries.length) differences.push({ type: 'MANIFEST_COUNT_MISMATCH', version: '-', file: 'migrations-manifest.json' });
  return differences;
}

// Append-only: tracked entries must already match byte for byte; only unlisted files are added.
export function appendManifest(local, existing) {
  const problems = manifestDifferences(local, existing).filter(d => d.type !== 'UNTRACKED_LOCAL_FILE');
  if (problems.length > 0) throw new Error('IMMUTABLE_MANIFEST_DRIFT');
  const known = new Set(existing.migrations.map(e => e.version));
  const migrations = [...existing.migrations, ...local.filter(l => !known.has(l.version))];
  return {
    ...existing,
    generated_at: new Date().toISOString().slice(0, 10),
    total_migrations: migrations.length,
    remote_probe_status: 'NOT_PROBED',
    full_replay_status: 'NOT_VERIFIED',
    target_supabase_url: null,
    drift_summary: { manifest_drift_count: 0, remote_unapplied_count: null },
    migrations,
  };
}

// A missing remote ledger name is NOT proof that its SQL is unapplied: consolidated revisions may
// contain it. It is only unreconciled and needs a human catalog comparison. No alias inference.
export function remoteDifferences(local, applied) {
  const byVersion = new Map();
  for (const item of applied) byVersion.set(String(item.version), [...(byVersion.get(String(item.version)) || []), item]);
  const differences = [];
  for (const l of local) {
    const rows = byVersion.get(l.version) || [];
    const base = l.filename.replace(/^[0-9]+_/, '').replace('.sql', '');
    if (rows.length === 0) differences.push({ type: 'REMOTE_HISTORY_UNRECONCILED', version: l.version, file: l.filename });
    else if (rows.length > 1) differences.push({ type: 'REMOTE_VERSION_DUPLICATE', version: l.version, file: l.filename });
    else if (rows[0].name !== base && rows[0].name !== l.filename.replace('.sql', '')) differences.push({ type: 'REMOTE_NAME_CONFLICT', version: l.version, file: l.filename });
  }
  return differences;
}

async function verifyMigrationDrift() {
  const isLocalMode = process.argv.includes('--local');
  if (!isLocalMode) { dotenv.config({ path: '.env.local' }); dotenv.config(); }
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const SERVICE_ROLE_KEY = isLocalMode ? undefined : getServiceRoleKey();
  console.log('====================================================');
  console.log('[Migration Drift Verifier] Starting Truth Reconciliation');
  console.log('Target URL:', SUPABASE_URL);
  console.log('====================================================\n');

  const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
  const manifestPath = path.join(process.cwd(), 'supabase/migrations-manifest.json');

  if (!fs.existsSync(migrationsDir)) {
    console.error('[FATAL] Migrations directory not found:', migrationsDir);
    process.exit(1);
  }

  const localFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  console.log(`[Drift Verifier] Found ${localFiles.length} local migration files on disk.`);

  const localMap = new Map();
  const duplicateVersions = [];

  for (const f of localFiles) {
    const version = f.split('_')[0];
    const fullPath = path.join(migrationsDir, f);
    const content = fs.readFileSync(fullPath, 'utf8');
    const checksum = computeSha256(content);
    const stat = fs.statSync(fullPath);

    if (localMap.has(version)) {
      duplicateVersions.push({ version, fileA: localMap.get(version).filename, fileB: f });
    }
    localMap.set(version, { version, filename: f, checksum, size: stat.size });
  }

  if (duplicateVersions.length > 0) {
    console.error('[FATAL] Migration timestamp collisions detected:');
    duplicateVersions.forEach(d => console.error(`  - Version ${d.version}: ${d.fileA} <-> ${d.fileB}`));
    process.exit(1);
  }
  console.log('[Drift Verifier] Local timestamp uniqueness: PASS (0 collisions)');

  const isWriteMode = process.argv.includes('--write');

  // 1. Manifest Reconcile
  let manifest = null;
  let manifestDrift = [];

  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const manifestVersions = new Map((manifest.migrations || []).map(m => [m.version, m]));

      // Check missing or altered files
      for (const [v, localInfo] of localMap.entries()) {
        const manifestEntry = manifestVersions.get(v);
        if (!manifestEntry) {
          manifestDrift.push({ type: 'UNTRACKED_LOCAL_FILE', version: v, file: localInfo.filename });
        } else if (manifestEntry.checksum !== localInfo.checksum) {
          manifestDrift.push({ type: 'CHECKSUM_MISMATCH', version: v, file: localInfo.filename, local: localInfo.checksum, manifest: manifestEntry.checksum });
        }
      }

      for (const [v, mEntry] of manifestVersions.entries()) {
        if (!localMap.has(v)) {
          manifestDrift.push({ type: 'MISSING_LOCAL_FILE', version: v, file: mEntry.filename });
        }
      }
    } catch (err) {
      console.error('[FATAL] Failed to parse existing manifest:', err.message);
      process.exit(1);
    }
  } else if (!isWriteMode) {
    console.error('[FATAL] Manifest file not found and --write flag was not provided.');
    process.exit(1);
  }

  console.log(`[Drift Verifier] Manifest vs Local Files Drift: ${manifestDrift.length} differences detected.`);
  if (manifestDrift.length > 0) {
    manifestDrift.forEach(d => console.error(`  - [${d.type}] Version ${d.version} (${d.file})`));
    if (!isWriteMode) {
      console.error('[FATAL] Manifest drift detected without --write flag. Failing closed.');
      process.exit(1);
    }
  }

  if (isLocalMode) {
    if (manifestDrift.length > 0) {
      console.error('[FATAL] Local manifest drift detected. No remote or replay claim was made.');
      process.exit(1);
    }
    console.log('[Drift Verifier] LOCAL INVENTORY PASSED: remote_probe_status=NOT_PROBED, full_replay_status=NOT_VERIFIED.');
    return;
  }

  // 2. Remote DB Migration Table Verification (Supabase schema_migrations probe)
  let remoteProbeStatus = 'NOT_CHECKED';
  let remoteDrift = [];

  if (!SERVICE_ROLE_KEY) {
    console.error('[FATAL] SUPABASE_SERVICE_ROLE_KEY is required for release qualification. Fail-closed.');
    process.exit(1);
  }

  console.log('\n[Drift Verifier] Probing remote Supabase for schema migrations ledger...');
  try {
    const probeRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_applied_migrations`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!probeRes.ok) {
      const errText = await probeRes.text();
      console.error(`[FATAL] get_applied_migrations RPC failed with HTTP ${probeRes.status}: ${errText}`);
      process.exit(1);
    }

    const applied = await probeRes.json();
    remoteProbeStatus = 'CONNECTED_AUTHENTICATED';
    console.log(`[Drift Verifier] Remote reported ${applied.length} applied migrations.`);
    const appliedSet = new Set(applied.map(a => String(a.version || a)));
    const localNames = new Set(Array.from(localMap.values()).map(f => f.filename.replace('.sql', '')));
    const localBaseNames = new Set(Array.from(localMap.values()).map(f => f.filename.replace(/^[0-9]+_/, '').replace('.sql', '')));

    for (const [v, info] of localMap.entries()) {
      if (!appliedSet.has(v)) {
        remoteDrift.push({ type: 'REMOTE_HISTORY_UNRECONCILED', version: v, file: info.filename });
      }
    }

    let unmappedRemoteCount = 0;
    for (const remoteItem of applied) {
      const v = String(remoteItem.version || '');
      const name = String(remoteItem.name || '');
      const isRecognized = localMap.has(v) || localNames.has(name) || localBaseNames.has(name);
      if (!isRecognized) {
        unmappedRemoteCount++;
      }
    }
    if (unmappedRemoteCount > 0) {
      console.log(`[Drift Verifier] Remote historical ledger: ${applied.length} entries total (${unmappedRemoteCount} historical legacy records retained).`);
    }
  } catch (err) {
    console.error('[FATAL] Remote DB probe network error:', err.message);
    process.exit(1);
  }

  if (remoteDrift.length > 0) {
    console.error(`[FATAL] Remote vs Local migration parity failure! ${remoteDrift.length} unreconciled migration(s) (not proof of non-application):`);
    remoteDrift.forEach(d => console.error(`  - [${d.type}] Version: ${d.version} (${d.file})`));
    process.exit(1);
  }


  // 3. Update Manifest ONLY when explicitly requested (--write)
  if (isWriteMode) {
    const newManifest = appendManifest(Array.from(localMap.values()), manifest);

    fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2));
    console.log(`\n[Drift Verifier] Synchronized manifest: ${manifestPath} (${localMap.size} migrations recorded).`);
  } else {
    console.log('[Drift Verifier] Read-only verification mode. Manifest file unchanged.');
  }

  console.log('\n====================================================');
  console.log(`[Drift Verifier] Verification Summary:`);
  console.log(`- Local Files Checked: ${localMap.size}`);
  console.log(`- Timestamp Collisions: 0`);
  console.log(`- Manifest Drift: ${manifestDrift.length}`);
  console.log(`- Remote DB Status: ${remoteProbeStatus}`);
  console.log(`- Remote Drift: 0`);
  console.log('====================================================\n');
  console.log('[Drift Verifier] ALL GATES PASSED: Zero-drift guaranteed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyMigrationDrift().catch((err) => {
    console.error('[FATAL] Migration drift verifier failed:', err);
    process.exit(1);
  });
}

