/**
 * QA11 Wave 5: ANI-1135 Visual Verification Calibration Corpus + Versioned Threshold Gate
 * 
 * Verifies:
 * 1. Zero False-Positives: Unrelated media / hard negatives never certified as VERIFIED.
 * 2. Zero False-Negatives: Valid recompressed/resized positive media pass VERIFIED threshold (>= 0.85).
 * 3. Borderline samples correctly route to MANUAL_REVIEW_REQUIRED (0.65 .. 0.84).
 * 4. Versioned threshold gate records corpusVersion and thresholdVersion into durable evidence.
 * 5. Complete regression gate over CALIBRATION_CORPUS_V1.
 */

import { describe, it, expect } from 'vitest'
import {
  CALIBRATION_CORPUS_V1,
  CALIBRATION_CORPUS_VERSION,
  type CalibrationCorpusItem,
} from '../../src/features/publishing/calibration/calibration-corpus'
import {
  runCalibrationCorpus,
  evaluateCalibrationGate,
} from '../../src/features/publishing/calibration/calibration-runner'
import {
  PERCEPTUAL_SIMILARITY_THRESHOLDS,
  computePerceptualSimilarityFromBytes,
  evaluateSimilarityBand,
} from '../../src/features/publishing/perceptual-image-comparator'
import {
  verifyPublishedCreativeBundle,
  type ReadbackVerificationDependencies,
} from '../../src/features/publishing/provider-readback-verifier'
import type { CreativeBundle } from '../../src/features/creative/creative-bundle-types'

describe('ANI-1135: Visual Verification Calibration Corpus & Threshold Gate', () => {
  // 1. Corpus Definition Integrity
  it('defines CALIBRATION_CORPUS_V1 with diverse positive, borderline, and hard-negative samples', () => {
    expect(CALIBRATION_CORPUS_V1.length).toBeGreaterThanOrEqual(8)
    expect(CALIBRATION_CORPUS_VERSION).toBe('v1.0-meta-calibration')

    const kinds = CALIBRATION_CORPUS_V1.map((item) => item.kind)
    expect(kinds).toContain('POSITIVE_IDENTICAL')
    expect(kinds).toContain('POSITIVE_RECOMPRESSED')
    expect(kinds).toContain('BORDERLINE_SUBTLE_EDIT')
    expect(kinds).toContain('HARD_NEGATIVE_DIFFERENT_PRODUCT')
    expect(kinds).toContain('HARD_NEGATIVE_CROSS_DOMAIN')
  })

  // 2. Zero False-Positives Gate (Critical Security & Brand Protection)
  it('enforces ZERO false-positives across all hard-negative corpus items (falsePositives === 0)', () => {
    const hardNegatives = CALIBRATION_CORPUS_V1.filter((item) =>
      item.kind.startsWith('HARD_NEGATIVE')
    )
    expect(hardNegatives.length).toBeGreaterThanOrEqual(3)

    for (const item of hardNegatives) {
      const similarity = computePerceptualSimilarityFromBytes(item.sourceBytes, item.observedBytes)
      const evaluation = evaluateSimilarityBand(similarity)

      expect(evaluation.outcome).not.toBe('VERIFIED')
      expect(evaluation.similarity).toBeLessThan(PERCEPTUAL_SIMILARITY_THRESHOLDS.HIGH_CONFIDENCE)
    }
  })

  // 3. Zero False-Negatives Gate
  it('enforces ZERO false-negatives across all positive corpus items (falseNegatives === 0)', () => {
    const positives = CALIBRATION_CORPUS_V1.filter((item) =>
      item.kind.startsWith('POSITIVE')
    )
    expect(positives.length).toBeGreaterThanOrEqual(2)

    for (const item of positives) {
      const similarity = computePerceptualSimilarityFromBytes(item.sourceBytes, item.observedBytes)
      const evaluation = evaluateSimilarityBand(similarity)

      expect(evaluation.outcome).toBe('VERIFIED')
      expect(evaluation.similarity).toBeGreaterThanOrEqual(
        PERCEPTUAL_SIMILARITY_THRESHOLDS.HIGH_CONFIDENCE
      )
    }
  })

  // 4. Borderline Routing to MANUAL_REVIEW_REQUIRED
  it('routes borderline subtle edit samples to MANUAL_REVIEW_REQUIRED', () => {
    const borderlines = CALIBRATION_CORPUS_V1.filter(
      (item) => item.kind === 'BORDERLINE_SUBTLE_EDIT'
    )
    expect(borderlines.length).toBeGreaterThanOrEqual(1)

    for (const item of borderlines) {
      const similarity = computePerceptualSimilarityFromBytes(item.sourceBytes, item.observedBytes)
      const evaluation = evaluateSimilarityBand(similarity)

      expect(evaluation.outcome).toBe('MANUAL_REVIEW_REQUIRED')
      expect(evaluation.reasonCode).toBe('GRAY_BAND_SIMILARITY')
      expect(evaluation.similarity).toBeGreaterThanOrEqual(
        PERCEPTUAL_SIMILARITY_THRESHOLDS.MANUAL_REVIEW_LOW
      )
      expect(evaluation.similarity).toBeLessThan(
        PERCEPTUAL_SIMILARITY_THRESHOLDS.HIGH_CONFIDENCE
      )
    }
  })

  // 5. Full Calibration Runner Gate Evaluation
  it('executes runCalibrationCorpus and confirms calibration gate PASSES', () => {
    const report = runCalibrationCorpus(CALIBRATION_CORPUS_V1)

    expect(report.totalSamples).toBe(CALIBRATION_CORPUS_V1.length)
    expect(report.falsePositives).toBe(0)
    expect(report.falseNegatives).toBe(0)
    expect(report.corpusVersion).toBe(CALIBRATION_CORPUS_VERSION)
    expect(report.thresholdVersion).toBe(PERCEPTUAL_SIMILARITY_THRESHOLDS.VERSION)
    expect(report.calibrationPassed).toBe(true)

    const gate = evaluateCalibrationGate(report)
    expect(gate.ok).toBe(true)
    expect(gate.status).toBe('CALIBRATION_GATE_PASSED')
  })

  // 6. Readback Verifier Evidence contains versioned metadata
  it('records calibration and threshold versions in readback evaluation evidence', async () => {
    const positiveSample = CALIBRATION_CORPUS_V1.find(
      (i) => i.kind === 'POSITIVE_RECOMPRESSED'
    )!

    const bundle: CreativeBundle = {
      bundleId: 'bun-calib-1135',
      workspaceId: 'ws-calib-1135',
      contentId: 'cnt-calib-1135',
      versionId: 'ver-calib-1135',
      channel: 'instagram',
      caption: '캘리브레이션 검증 캡션입니다.',
      hashtags: ['#테스트'],
      orderedMedia: [
        {
          mediaAssetId: 'med-calib-1135',
          sha256Digest: 'f'.repeat(64),
          position: 0,
          role: 'primary',
        },
      ],
      creativeBriefVersion: 'v1.0',
      bundleFingerprint: 'c'.repeat(64),
      approvalStatus: 'APPROVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const deps: ReadbackVerificationDependencies = {
      fetchPublishedPost: async () => ({
        providerPostId: 'post_calib_123',
        channel: 'instagram',
        caption: '캘리브레이션 검증 캡션입니다.',
        permalink: 'https://www.instagram.com/p/post_calib_123',
        mediaItems: [
          {
            id: 'media_calib_01',
            mediaType: 'IMAGE',
            mediaUrl: 'https://cdn.instagram.com/p/calib.png',
            position: 0,
          },
        ],
        timestamp: new Date().toISOString(),
      }),
      computePerceptualSimilarity: async () => {
        const similarity = computePerceptualSimilarityFromBytes(
          positiveSample.sourceBytes,
          positiveSample.observedBytes
        )
        return { similarity }
      },
    }

    const result = await verifyPublishedCreativeBundle(
      bundle,
      'post_calib_123',
      'token',
      deps
    )

    expect(result.outcome).toBe('VERIFIED')
    expect(result.calibrationCorpusVersion).toBe(CALIBRATION_CORPUS_VERSION)
    expect(result.thresholdVersion).toBe(PERCEPTUAL_SIMILARITY_THRESHOLDS.VERSION)
  })
})
