import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  reconcileStorageAndDb,
  MAX_STORAGE_FILE_SIZE_BYTES,
  type StorageObjectSummary,
  type MediaAssetSummary,
} from '../../qa/11th/audit/storage-reconciliation';

describe('ANI-1115: content-media Storage↔DB Reconciliation + 10MB Config Drift', () => {
  describe('1. 10MB Single SSOT Constant', () => {
    it('enforces exact 10MB limit (10485760 bytes)', () => {
      expect(MAX_STORAGE_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
      expect(MAX_STORAGE_FILE_SIZE_BYTES).toBe(10485760);
    });
  });

  describe('2. Storage↔DB Reconciliation Engine', () => {
    const mockDbRows: MediaAssetSummary[] = [
      {
        id: 'asset-01',
        workspace_id: 'ws_bakery_001',
        object_path: 'ws_bakery_001/a.png',
        size_bytes: 500000,
        sha256_digest: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      },
      {
        id: 'asset-02-missing-file',
        workspace_id: 'ws_bakery_001',
        object_path: 'ws_bakery_001/missing.png',
        size_bytes: 300000,
        sha256_digest: 'abcd1234'.padEnd(64, '0'),
      },
      {
        id: 'asset-03-cross-workspace',
        workspace_id: 'ws_bakery_001',
        object_path: 'ws_beauty_002/sneaky.png', // foreign workspace prefix!
        size_bytes: 400000,
        sha256_digest: 'ef123456'.padEnd(64, '0'),
      },
      {
        id: 'asset-04-oversized',
        workspace_id: 'ws_bakery_001',
        object_path: 'ws_bakery_001/giant.png',
        size_bytes: 15 * 1024 * 1024, // 15MB!
        sha256_digest: '78901234'.padEnd(64, '0'),
      },
    ];

    const mockStorageObjects: StorageObjectSummary[] = [
      {
        name: 'ws_bakery_001/a.png',
        size_bytes: 500000,
        sha256_digest: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      },
      {
        name: 'ws_beauty_002/sneaky.png',
        size_bytes: 400000,
        sha256_digest: 'ef123456'.padEnd(64, '0'),
      },
      {
        name: 'ws_bakery_001/giant.png',
        size_bytes: 15 * 1024 * 1024,
        sha256_digest: '78901234'.padEnd(64, '0'),
      },
      {
        name: 'ws_bakery_001/orphan_unregistered.png', // in storage but not in DB!
        size_bytes: 200000,
        sha256_digest: '11112222'.padEnd(64, '0'),
      },
    ];

    it('classifies matched, row-only, object-only, cross-workspace, and oversized assets correctly', () => {
      const report = reconcileStorageAndDb(mockDbRows, mockStorageObjects);

      expect(report.matched_count).toBe(3); // a.png, sneaky.png, giant.png
      expect(report.row_only_missing_files).toContain('asset-02-missing-file');
      expect(report.object_only_orphans).toContain('ws_bakery_001/orphan_unregistered.png');
      expect(report.cross_workspace_leaks).toContain('asset-03-cross-workspace');
      expect(report.oversized_files).toContain('asset-04-oversized');
      expect(report.is_reconciled).toBe(false);
    });

    it('passes reconciliation when all rows match valid storage objects without anomalies', () => {
      const cleanDbRows: MediaAssetSummary[] = [
        {
          id: 'asset-clean-01',
          workspace_id: 'ws_bakery_001',
          object_path: 'ws_bakery_001/clean.png',
          size_bytes: 1000000,
          sha256_digest: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        },
      ];

      const cleanStorageObjects: StorageObjectSummary[] = [
        {
          name: 'ws_bakery_001/clean.png',
          size_bytes: 1000000,
          sha256_digest: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        },
      ];

      const report = reconcileStorageAndDb(cleanDbRows, cleanStorageObjects);
      expect(report.matched_count).toBe(1);
      expect(report.row_only_missing_files).toHaveLength(0);
      expect(report.object_only_orphans).toHaveLength(0);
      expect(report.cross_workspace_leaks).toHaveLength(0);
      expect(report.oversized_files).toHaveLength(0);
      expect(report.is_reconciled).toBe(true);
    });
  });

  describe('3. Supabase Storage Migration Verification', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20260909030000_ani1115_storage_10mb_config_sync.sql'
    );

    it('verifies the SQL migration file exists', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('verifies that file_size_limit is set to 10485760 (10MB) in storage.buckets', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      expect(sql).toMatch(/UPDATE storage\.buckets[\s\S]+?file_size_limit\s*=\s*10485760/i);
      expect(sql).not.toMatch(/52428800/); // 50MB must not be present
    });
  });
});
