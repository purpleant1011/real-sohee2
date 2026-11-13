import { describe, it, expect } from 'vitest';
import {
  ClosureVerdict,
  ClosureVerdictSchema,
  EvidenceEnvelopeSchema,
  ReleaseManifestSchema,
  assertProductionVerifiedAllowed,
  createEvidenceEnvelope,
  formatEvidenceMarkdown,
  extractEvidenceEnvelopeFromMarkdown,
  type EvidenceEnvelope,
} from '../../qa/11th/evidence/evidence-contract';

describe('ANI-1111: Done/Release Evidence Contract', () => {
  const validLiveEnvironment = {
    git_sha: '63ee2695705b988571ad2fb59bb7538af580b1ae',
    deployment: {
      target: 'cloudflare_workers' as const,
      build_id: '63ee269',
      live_url: 'https://real-sohee.example.workers.dev',
    },
    database: {
      target: 'supabase' as const,
      ref: 'your-project-ref',
      migration_head: '20260907050000_v089_evidence_gated_channel_verification',
    },
    workspace: {
      workspace_id: 'ws_bakery_001',
      tenant_type: 'bakery' as const,
    },
  };

  const validEvidenceSample: EvidenceEnvelope = {
    schema_version: '1.0.0',
    issue_id: 'ANI-1111',
    verdict: ClosureVerdict.IMPLEMENTED,
    verdict_rationale: 'Evidence contract schema and invariant guards implemented and tested.',
    test_run_id: 'tr-20260908-ani1111-001',
    observed_at: new Date().toISOString(),
    environment: validLiveEnvironment,
    proof_type: 'INTEGRATION_TEST',
    mock_only: false,
    assertions: [
      {
        name: 'schema_validation_passed',
        expected: true,
        actual: true,
        passed: true,
      },
    ],
  };

  describe('1. Closure Verdicts', () => {
    it('allows only canonical verdicts: REQUIRED, IMPLEMENTED, PRODUCTION_VERIFIED, BLOCKED, RESULT_UNKNOWN, NOT_APPLICABLE', () => {
      expect(ClosureVerdictSchema.safeParse('REQUIRED').success).toBe(true);
      expect(ClosureVerdictSchema.safeParse('IMPLEMENTED').success).toBe(true);
      expect(ClosureVerdictSchema.safeParse('PRODUCTION_VERIFIED').success).toBe(true);
      expect(ClosureVerdictSchema.safeParse('BLOCKED').success).toBe(true);
      expect(ClosureVerdictSchema.safeParse('RESULT_UNKNOWN').success).toBe(true);
      expect(ClosureVerdictSchema.safeParse('NOT_APPLICABLE').success).toBe(true);

      // Forbidden verdicts
      expect(ClosureVerdictSchema.safeParse('DONE').success).toBe(false);
      expect(ClosureVerdictSchema.safeParse('PASS').success).toBe(false);
      expect(ClosureVerdictSchema.safeParse('SUCCESS').success).toBe(false);
      expect(ClosureVerdictSchema.safeParse('TRUE').success).toBe(false);
    });
  });

  describe('2. EvidenceEnvelope Schema Validation', () => {
    it('validates a complete and compliant evidence envelope', () => {
      const parsed = EvidenceEnvelopeSchema.safeParse(validEvidenceSample);
      expect(parsed.success).toBe(true);
    });

    it('rejects an envelope missing critical ground truth environment fields', () => {
      const invalid = {
        ...validEvidenceSample,
        environment: {
          ...validLiveEnvironment,
          git_sha: '', // missing git_sha
        },
      };
      const parsed = EvidenceEnvelopeSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('rejects an envelope with an invalid ISO 8601 observed_at timestamp', () => {
      const invalid = {
        ...validEvidenceSample,
        observed_at: '2026-09-08 22:00:00', // not ISO 8601 UTC
      };
      const parsed = EvidenceEnvelopeSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('validates optional canonical_ids, storage, provider, and browser sections', () => {
      const fullEnvelope: EvidenceEnvelope = {
        ...validEvidenceSample,
        canonical_ids: {
          thread_id: 'th_01',
          work_item_id: 'wi_01',
          content_id: 'cnt_01',
          content_version_id: 'cv_01',
          generation_batch_id: 'gb_01',
          generation_run_id: 'gr_01',
          media_asset_ids: ['ma_01', 'ma_02'],
          creative_bundle_id: 'cb_01',
          bundle_fingerprint: 'sha256:abcd1234ef',
          approval_id: 'app_01',
          publish_rendition_id: 'pr_01',
          provider_delivery_lease_id: 'pdl_01',
        },
        storage: {
          bucket: 'media',
          path: 'tenants/bakery/image.webp',
          sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          mime_type: 'image/webp',
          byte_size: 1048576,
        },
        provider: {
          name: 'instagram',
          external_id: 'ig_media_123456789',
          permalink: 'https://instagram.com/p/C_sample',
          readback_status: 'MATCHED',
          readback_observed_at: new Date().toISOString(),
          calibration_version: 'v1.0.0',
        },
        browser: {
          tool: 'ego-browser',
          task_space: 'golden-journey-bakery',
          viewport: { width: 375, height: 812 },
          snapshot_digest: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      };

      const parsed = EvidenceEnvelopeSchema.safeParse(fullEnvelope);
      expect(parsed.success).toBe(true);
    });
  });

  describe('3. Automated Anti-False-Green Gate (assertProductionVerifiedAllowed)', () => {
    it('throws if mock_only is true when requesting PRODUCTION_VERIFIED', () => {
      const mockEnvelope: EvidenceEnvelope = {
        ...validEvidenceSample,
        verdict: ClosureVerdict.PRODUCTION_VERIFIED,
        mock_only: true,
        proof_type: 'MOCK_UNIT',
      };

      expect(() => assertProductionVerifiedAllowed(mockEnvelope)).toThrowError(
        /Mock-only evidence cannot grant PRODUCTION_VERIFIED/i
      );
    });

    it('throws if proof_type is MOCK_UNIT when verdict is PRODUCTION_VERIFIED even if mock_only was false', () => {
      const suspiciousEnvelope: EvidenceEnvelope = {
        ...validEvidenceSample,
        verdict: ClosureVerdict.PRODUCTION_VERIFIED,
        mock_only: false,
        proof_type: 'MOCK_UNIT',
      };

      expect(() => assertProductionVerifiedAllowed(suspiciousEnvelope)).toThrowError(
        /Proof type 'MOCK_UNIT' is insufficient for PRODUCTION_VERIFIED/i
      );
    });

    it('throws if observed_at is older than allowed stale threshold (default 24h)', () => {
      const staleTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const staleEnvelope: EvidenceEnvelope = {
        ...validEvidenceSample,
        verdict: ClosureVerdict.PRODUCTION_VERIFIED,
        proof_type: 'PRODUCTION_LIVE',
        observed_at: staleTimestamp,
      };

      expect(() => assertProductionVerifiedAllowed(staleEnvelope)).toThrowError(
        /stale evidence/i
      );
    });

    it('throws if observed_at is in the future (> 5 minutes clock drift)', () => {
      const futureTimestamp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const futureEnvelope: EvidenceEnvelope = {
        ...validEvidenceSample,
        verdict: ClosureVerdict.PRODUCTION_VERIFIED,
        proof_type: 'PRODUCTION_LIVE',
        observed_at: futureTimestamp,
      };

      expect(() => assertProductionVerifiedAllowed(futureEnvelope)).toThrowError(
        /future timestamp/i
      );
    });

    it('throws if any assertion failed in the evidence envelope', () => {
      const failedAssertionEnvelope: EvidenceEnvelope = {
        ...validEvidenceSample,
        verdict: ClosureVerdict.PRODUCTION_VERIFIED,
        proof_type: 'PRODUCTION_LIVE',
        assertions: [
          {
            name: 'media_asset_model_metadata',
            expected: 'gpt-image-2',
            actual: 'dall-e-3',
            passed: false,
          },
        ],
      };

      expect(() => assertProductionVerifiedAllowed(failedAssertionEnvelope)).toThrowError(
        /Failed assertion detected/i
      );
    });

    it('passes assertion when evidence envelope has genuine PRODUCTION_LIVE proof and all assertions passed', () => {
      const validProdEnvelope: EvidenceEnvelope = {
        ...validEvidenceSample,
        verdict: ClosureVerdict.PRODUCTION_VERIFIED,
        proof_type: 'PRODUCTION_LIVE',
        mock_only: false,
        assertions: [
          {
            name: 'provider_readback_match',
            expected: 'MATCHED',
            actual: 'MATCHED',
            passed: true,
          },
        ],
      };

      expect(() => assertProductionVerifiedAllowed(validProdEnvelope)).not.toThrow();
    });
  });

  describe('4. Markdown Representation and Machine Round-trip', () => {
    it('formats an evidence envelope into standardized markdown with embedded machine JSON', () => {
      const md = formatEvidenceMarkdown(validEvidenceSample);
      expect(md).toContain('### Evidence Envelope: ANI-1111');
      expect(md).toContain('`IMPLEMENTED`');
      expect(md).toContain('```json:evidence-envelope');

      const extracted = extractEvidenceEnvelopeFromMarkdown(md);
      expect(extracted).not.toBeNull();
      expect(extracted?.issue_id).toBe('ANI-1111');
      expect(extracted?.verdict).toBe(ClosureVerdict.IMPLEMENTED);
      expect(extracted?.environment.git_sha).toBe(validLiveEnvironment.git_sha);
    });
  });

  describe('5. Release Manifest Aggregation', () => {
    it('validates a complete release manifest and computes is_release_ready', () => {
      const manifest = {
        manifest_version: '1.0.0',
        release_sha: '63ee2695705b988571ad2fb59bb7538af580b1ae',
        deployment_build: '63ee269',
        generated_at: new Date().toISOString(),
        issues: [
          {
            ...validEvidenceSample,
            issue_id: 'ANI-1109',
            verdict: ClosureVerdict.PRODUCTION_VERIFIED,
            proof_type: 'PRODUCTION_LIVE' as const,
          },
          {
            ...validEvidenceSample,
            issue_id: 'ANI-1110',
            verdict: ClosureVerdict.PRODUCTION_VERIFIED,
            proof_type: 'PRODUCTION_LIVE' as const,
          },
        ],
      };

      const parsed = ReleaseManifestSchema.safeParse(manifest);
      expect(parsed.success).toBe(true);
    });

    it('flags manifest as NOT release-ready if any issue is still REQUIRED or IMPLEMENTED', () => {
      const unverifiedManifest = {
        manifest_version: '1.0.0',
        release_sha: '63ee2695705b988571ad2fb59bb7538af580b1ae',
        deployment_build: '63ee269',
        generated_at: new Date().toISOString(),
        issues: [
          {
            ...validEvidenceSample,
            issue_id: 'ANI-1109',
            verdict: ClosureVerdict.REQUIRED,
          },
        ],
      };

      const parsed = ReleaseManifestSchema.safeParse(unverifiedManifest);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.is_release_ready).toBe(false);
        expect(parsed.data.blocking_issues).toContain('ANI-1109');
      }
    });
  });
});
