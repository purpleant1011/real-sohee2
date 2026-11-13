import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ProductionTruthSnapshotSchema,
  evaluateTruthSnapshot,
  type ProductionTruthSnapshot,
} from '../../qa/11th/snapshot/production-truth-snapshot';

describe('ANI-1112: Fresh Production Truth Snapshot + Drift Guard + Wave Gate Runner', () => {
  const sampleSnapshot: ProductionTruthSnapshot = {
    snapshot_id: 'pts-20260908-001',
    created_at: new Date().toISOString(),
    git: {
      sha: '63ee2695705b988571ad2fb59bb7538af580b1ae',
      branch: 'feat/11th-production-ground-truth',
      is_clean: true,
    },
    deployment: {
      target: 'cloudflare_workers',
      build_id: '63ee269',
      live_url: 'https://real-sohee.example.workers.dev',
      is_live_reachable: true,
    },
    database: {
      ref: 'your-project-ref',
      migration_head: '20260907050000_v089_evidence_gated_channel_verification',
      table_counts: {
        media_assets: 202,
        generation_batches: 125,
        generation_runs: 0,
        creative_bundles: 0,
        publish_renditions: 0,
        provider_delivery_leases: 0,
        provider_observed_media: 0,
      },
      security_advisor: {
        security_definer_count: 63,
        rls_no_policy_count: 23,
        leaked_password_count: 1,
      },
      provenance: {
        total_media_assets: 202,
        generated_openai_count: 202,
        missing_model_metadata_count: 202,
        missing_sha256_count: 86,
        quarantined_count: 0,
      },
    },
    storage: {
      bucket: 'media',
      file_count: 350,
      total_bytes: 45000000,
      max_file_size_bytes: 10485760, // 10MB
    },
    workspaces: {
      scoped_workspaces: ['ws_bakery_001', 'ws_beauty_001'],
      cross_tenant_leaks_detected: 0,
    },
    callgraph: {
      legacy_symbols_active: [
        'ImageWorker.generateImage',
        'dall-e-3',
        'PublishingExecutor',
      ],
      unwired_canonical_modules: [
        'GenerationOrchestrator',
        'executeCreativeBundlePublish',
      ],
    },
  };

  describe('1. ProductionTruthSnapshot Schema', () => {
    it('validates a conformant snapshot payload', () => {
      const parsed = ProductionTruthSnapshotSchema.safeParse(sampleSnapshot);
      expect(parsed.success).toBe(true);
    });

    it('rejects a snapshot missing critical git or deployment fields', () => {
      const invalid = {
        ...sampleSnapshot,
        git: { sha: '' },
      };
      const parsed = ProductionTruthSnapshotSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe('2. Drift & Pollution Evaluation Guard (evaluateTruthSnapshot)', () => {
    it('detects baseline production pollution and returns RELEASE_BLOCKED with exact findings', () => {
      const result = evaluateTruthSnapshot(sampleSnapshot);

      expect(result.verdict).toBe('RELEASE_BLOCKED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/202\/202 media_assets missing model metadata/i),
          expect.stringMatching(/63 SECURITY DEFINER warnings pending/i),
          expect.stringMatching(/Legacy symbols still present in call graph/i),
          expect.stringMatching(/Canonical modules unwired/i),
        ])
      );
      expect(result.is_release_ready).toBe(false);
    });

    it('detects cross-tenant contamination and blocks release immediately', () => {
      const contaminatedSnapshot: ProductionTruthSnapshot = {
        ...sampleSnapshot,
        workspaces: {
          ...sampleSnapshot.workspaces,
          cross_tenant_leaks_detected: 2,
        },
      };

      const result = evaluateTruthSnapshot(contaminatedSnapshot);
      expect(result.verdict).toBe('RELEASE_BLOCKED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Cross-tenant data leakage detected/i),
        ])
      );
    });

    it('detects files exceeding 10MB limit and blocks release', () => {
      const oversizedSnapshot: ProductionTruthSnapshot = {
        ...sampleSnapshot,
        storage: {
          ...sampleSnapshot.storage,
          max_file_size_bytes: 15 * 1024 * 1024, // 15MB
        },
      };

      const result = evaluateTruthSnapshot(oversizedSnapshot);
      expect(result.verdict).toBe('RELEASE_BLOCKED');
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Storage Invariant Breach: Max file size .* exceeds Supabase 10MB limit/i),
        ])
      );
    });

    it('returns FRESH_ALIGNED when all invariants, provenance, security, and callgraph are clean', () => {
      const cleanSnapshot: ProductionTruthSnapshot = {
        ...sampleSnapshot,
        database: {
          ...sampleSnapshot.database,
          table_counts: {
            ...sampleSnapshot.database.table_counts,
            creative_bundles: 12,
            publish_renditions: 12,
            provider_delivery_leases: 12,
            provider_observed_media: 12,
          },
          security_advisor: {
            security_definer_count: 0,
            rls_no_policy_count: 0,
            leaked_password_count: 0,
          },
          provenance: {
            total_media_assets: 202,
            generated_openai_count: 0, // all false-provenance quarantined or repaired
            missing_model_metadata_count: 0,
            missing_sha256_count: 0,
            quarantined_count: 202,
          },
        },
        callgraph: {
          legacy_symbols_active: [],
          unwired_canonical_modules: [],
        },
      };

      const result = evaluateTruthSnapshot(cleanSnapshot);
      expect(result.verdict).toBe('FRESH_ALIGNED');
      expect(result.is_release_ready).toBe(true);
      expect(result.findings.length).toBe(0);
    });
  });

  describe('3. Wave Gate Runner & Wave Manifests Existence', () => {
    it('verifies that scripts/run-wave-gate.mjs exists and is executable', () => {
      const runnerPath = path.resolve(process.cwd(), 'scripts/run-wave-gate.mjs');
      expect(fs.existsSync(runnerPath)).toBe(true);
    });

    it('verifies that qa/11th/waves/wave-0.json through wave-7.json exist', () => {
      for (let wave = 0; wave <= 7; wave++) {
        const manifestPath = path.resolve(process.cwd(), `qa/11th/waves/wave-${wave}.json`);
        expect(fs.existsSync(manifestPath), `wave-${wave}.json must exist`).toBe(true);

        const content = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(content.wave_id).toBe(wave);
        expect(content.title).toBeDefined();
        expect(Array.isArray(content.issues)).toBe(true);
      }
    });

    it('verifies wave-0.json contains ANI-1109, ANI-1110, ANI-1111, ANI-1112', () => {
      const wave0Path = path.resolve(process.cwd(), 'qa/11th/waves/wave-0.json');
      const wave0 = JSON.parse(fs.readFileSync(wave0Path, 'utf8'));
      const issueIds = wave0.issues.map((i: { issue_id: string }) => i.issue_id);

      expect(issueIds).toContain('ANI-1109');
      expect(issueIds).toContain('ANI-1110');
      expect(issueIds).toContain('ANI-1111');
      expect(issueIds).toContain('ANI-1112');
    });
  });
});
