import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { inReplayOrder } from './migration-replay-order';

describe('HF-41: Immutable Migration History & Zero Drift Gate (ANI-1390)', () => {
  const rootDir = process.cwd();
  const migrationsDir = path.join(rootDir, 'supabase/migrations');
  const manifestPath = path.join(rootDir, 'supabase/migrations-manifest.json');

  const canonicalHistoricalFiles = [
    '20260901235000_v02_1st_refinement_contracts.sql',
    '20260902000000_v088_3rd_revision_foundation.sql',
    '20260902013000_canonical_supabase_v088_3rd_refinement.sql',
    '20260903020000_v089_production_truth_recovery.sql',
    '20260903060000_v089_sns_channel_authorization_v11.sql',
    '20260907060000_v090_security_definer_rls_closure_and_advisor_hardening.sql',
    '20260908120000_creative_media_asset_truth_v10.sql'
  ];

  it('G-IMMUTABLE-1: applied historical migrations must have zero git diff against origin/main', () => {
    for (const file of canonicalHistoricalFiles) {
      const diff = execSync(`git diff origin/main -- "supabase/migrations/${file}"`, {
        encoding: 'utf8'
      }).trim();
      expect(diff, `Historical migration ${file} must have 0 diff against origin/main`).toBe('');
    }
 }, 30_000);

  it('G-IMMUTABLE-2: local migrations must strictly match migrations-manifest.json with zero checksum drift', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifestMap = new Map(manifest.migrations.map((m: any) => [m.filename, m.checksum]));

    const localFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    expect(localFiles.length).toBe(manifest.migrations.length);

    const versionSet = new Set<string>();
    for (const file of localFiles) {
      const version = file.split('_')[0];
      expect(versionSet.has(version), `Duplicate version collision: ${version}`).toBe(false);
      versionSet.add(version);

      const content = fs.readFileSync(path.join(migrationsDir, file));
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      const expectedChecksum = manifestMap.get(file);

      expect(expectedChecksum, `File ${file} missing in manifest`).toBeDefined();
      expect(sha256, `Checksum drift on ${file}`).toBe(expectedChecksum);
    }
 }, 30_000);

  it('G-IMMUTABLE-3: historical fresh replay remains valid for its original migration prefix', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const replayReportPath = path.join(rootDir, 'docs/evidence/v091-first-revision/migration/fresh-replay-report.json');
    expect(fs.existsSync(replayReportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(replayReportPath, 'utf8'));

    // The V0.91 artifact is a snapshot, NOT proof that migrations added after its date
    // have replayed. A fresh local PG replay must separately validate new migrations.
    expect(report.totalMigrations).toBeGreaterThan(0);
    expect(report.totalMigrations).toBeLessThanOrEqual(manifest.migrations.length);
    expect(report.migrations).toHaveLength(report.totalMigrations);
    // The report was produced from readdirSync().sort() (replay order). Compare it with the
    // manifest in that same order: the manifest's own storage order is not meaningful, and
    // later migrations may only ever be appended after this prefix.
    const replayOrder = inReplayOrder<{ filename: string; checksum: string }>(manifest.migrations);
    for (const [index, migration] of report.migrations.entries()) {
      expect(migration.file).toBe(replayOrder[index].filename);
      expect(migration.rawSha256).toBe(replayOrder[index].checksum);
      expect(migration.status).toBe('SUCCESS');
    }
    expect(report.passedMigrations).toBe(report.totalMigrations);
    expect(report.failedMigrations).toBe(0);
    expect(report.verdict).toBe('PASS_100_PERCENT');
  });

  it('G-IMMUTABLE-3b: replay-prefix order ignores manifest storage order, accepts appended migrations and rejects history insertions', () => {
    const names = (list: { filename: string }[]) => list.map(entry => entry.filename);
    const history = ['20260101_a.sql', '20260101000000_b.sql', '20260102000000_c.sql'].map(filename => ({ filename }));
    const prefix = names(inReplayOrder(history)).slice(0, 2);
    expect(prefix).toEqual(['20260101000000_b.sql', '20260101_a.sql']);

    // A manifest rebuilt in any other order (localeCompare, numeric version, reversed) replays identically.
    expect(names(inReplayOrder([...history].reverse()))).toEqual(names(inReplayOrder(history)));
    expect(names(inReplayOrder([...history].sort((a, b) => a.filename.localeCompare(b.filename))))).toEqual(names(inReplayOrder(history)));

    // A newly added, later migration leaves the archived prefix valid.
    expect(names(inReplayOrder([...history, { filename: '20261008090000_new.sql' }])).slice(0, 2)).toEqual(prefix);

    // A migration back-dated into already-replayed history shifts the prefix, so the archive stops matching.
    expect(names(inReplayOrder([...history, { filename: '20260101000500_late.sql' }])).slice(0, 2)).not.toEqual(prefix);
  });

  it('G-IMMUTABLE-4: historical production reconciliation is a snapshot, not a current deployment claim', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const reconReportPath = path.join(rootDir, 'docs/evidence/v091-first-revision/migration/production-reconciliation.json');
    expect(fs.existsSync(reconReportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reconReportPath, 'utf8'));

    expect(report.localMigrationCount).toBeGreaterThan(0);
    expect(report.localMigrationCount).toBeLessThanOrEqual(manifest.migrations.length);
    expect(report.unappliedLocalCount).toBe(0);
    expect(report.verdict).toBe('PASS_ZERO_DRIFT');
  });

  it('G-IMMUTABLE-5: critical schema diff artifact confirms canonical schema access and forward-only status', () => {
    const diffReportPath = path.join(rootDir, 'docs/evidence/v091-first-revision/migration/critical-schema-diff.json');
    expect(fs.existsSync(diffReportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(diffReportPath, 'utf8'));

    expect(report.allCriticalTablesAccessible).toBe(true);
    expect(report.verdict).toBe('PASS_CANONICAL_SCHEMA_RECONCILED');
    expect(report.forwardMigrationsApplied.length).toBe(4);
  });
});
