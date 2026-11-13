import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  validateMediaAssetPublishability,
  type MediaAssetInvariantInput,
} from '../../qa/11th/audit/media-invariant-guard';

describe('ANI-1114: Generated Media Evidence DB Invariant + Publishability Guard', () => {
  const validPublishableAsset: MediaAssetInvariantInput = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    workspace_id: 'ws_bakery_001',
    bucket_id: 'content-media',
    object_path: 'ws_bakery_001/assets/sweet_pumpkin_tart.webp',
    mime_type: 'image/webp',
    size_bytes: 1048576,
    generation_metadata: {
      model: 'gpt-image-2',
      prompt: 'Delicious rustic sweet pumpkin tart',
      generation_run_id: 'gr_run_01',
    },
    sha256_digest: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    provenance_kind: 'GENERATED_OPENAI',
    lifecycle_status: 'READY',
    publish_eligibility: true,
  };

  describe('1. Application-level Publishability & Invariant Guard', () => {
    it('approves a fully evidenced GENERATED_OPENAI asset', () => {
      const result = validateMediaAssetPublishability(validPublishableAsset);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects asset if provenance is GENERATED_OPENAI but model is missing', () => {
      const missingModel = {
        ...validPublishableAsset,
        generation_metadata: { prompt: 'foo' },
      };
      const result = validateMediaAssetPublishability(missingModel);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MISSING_MODEL_METADATA');
    });

    it('rejects asset if sha256 digest is missing or has invalid format', () => {
      const missingSha = {
        ...validPublishableAsset,
        sha256_digest: null,
      };
      const result1 = validateMediaAssetPublishability(missingSha);
      expect(result1.valid).toBe(false);
      expect(result1.errors).toContain('MISSING_OR_INVALID_SHA256');

      const invalidSha = {
        ...validPublishableAsset,
        sha256_digest: 'not-a-64-char-hex',
      };
      const result2 = validateMediaAssetPublishability(invalidSha);
      expect(result2.valid).toBe(false);
      expect(result2.errors).toContain('MISSING_OR_INVALID_SHA256');
    });

    it('rejects asset if size_bytes is zero or negative', () => {
      const zeroSize = {
        ...validPublishableAsset,
        size_bytes: 0,
      };
      const result = validateMediaAssetPublishability(zeroSize);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('INVALID_SIZE_BYTES');
    });

    it('rejects asset if publish_eligibility is true but lifecycle_status is not READY', () => {
      const draftAsset = {
        ...validPublishableAsset,
        lifecycle_status: 'PENDING_VALIDATION',
      };
      const result = validateMediaAssetPublishability(draftAsset);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('PUBLISHABLE_REQUIRES_READY_STATUS');
    });

    it('rejects asset if publish_eligibility is true but provenance_kind is QUARANTINED or LEGACY_UNKNOWN', () => {
      const legacyAsset = {
        ...validPublishableAsset,
        provenance_kind: 'LEGACY_UNKNOWN',
      };
      const result = validateMediaAssetPublishability(legacyAsset);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('CANNOT_PUBLISH_LEGACY_OR_QUARANTINED');
    });
  });

  describe('2. Migration SQL Invariant Constraints Verification', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20260909020000_ani1114_generated_media_db_invariants.sql'
    );

    it('verifies that the migration file exists', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('verifies that generated_openai_evidence CHECK constraint is defined', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      expect(sql).toMatch(/chk_media_assets_generated_openai_evidence/i);
      expect(sql).toMatch(/sha256_digest IS NOT NULL/i);
      expect(sql).toMatch(/generation_metadata->>'model'/i);
      expect(sql).toMatch(/size_bytes > 0/i);
    });

    it('verifies that publishable_evidence CHECK constraint is defined', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      expect(sql).toMatch(/chk_media_assets_publishable_evidence/i);
      expect(sql).toMatch(/lifecycle_status\s*=\s*'READY'/i);
      expect(sql).toMatch(/provenance_kind\s*!=\s*'LEGACY_UNKNOWN'/i);
    });
  });
});
