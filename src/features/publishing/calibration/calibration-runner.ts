/**
 * Calibration Runner & Regression Gate (Wave 5: ANI-1135)
 * 
 * Runs calibration corpus against perceptual similarity thresholds:
 * - Ensures 0 false-positives (Hard Negatives never marked VERIFIED)
 * - Ensures 0 false-negatives (Positives always marked VERIFIED)
 * - Ensures proper gray-band routing to MANUAL_REVIEW_REQUIRED
 */

import {
  CALIBRATION_CORPUS_VERSION,
  type CalibrationCorpusItem,
} from './calibration-corpus'
import {
  PERCEPTUAL_SIMILARITY_THRESHOLDS,
  computePerceptualSimilarityFromBytes,
  evaluateSimilarityBand,
} from '../perceptual-image-comparator'

export interface CalibrationItemResult {
  id: string
  kind: string
  similarity: number
  actualOutcome: string
  expectedOutcome: string
  passed: boolean
}

export interface CalibrationReport {
  totalSamples: number
  passedCount: number
  falsePositives: number
  falseNegatives: number
  borderlineCount: number
  corpusVersion: string
  thresholdVersion: string
  calibrationPassed: boolean
  details: CalibrationItemResult[]
}

export interface CalibrationGateOutcome {
  ok: boolean
  status: 'CALIBRATION_GATE_PASSED' | 'CALIBRATION_GATE_FAILED'
  gateViolations?: string[]
  reason?: string
}

/**
 * Executes calibration corpus verification and generates comprehensive regression report.
 */
export function runCalibrationCorpus(
  corpus: CalibrationCorpusItem[]
): CalibrationReport {
  let falsePositives = 0
  let falseNegatives = 0
  let passedCount = 0
  let borderlineCount = 0
  const details: CalibrationItemResult[] = []

  for (const item of corpus) {
    const similarity = computePerceptualSimilarityFromBytes(
      item.sourceBytes,
      item.observedBytes
    )
    const evalResult = evaluateSimilarityBand(similarity)

    const isPositive = item.kind.startsWith('POSITIVE')
    const isHardNegative = item.kind.startsWith('HARD_NEGATIVE')
    const isBorderline = item.kind.startsWith('BORDERLINE')

    // False positive: Hard negative evaluated as VERIFIED
    if (isHardNegative && evalResult.outcome === 'VERIFIED') {
      falsePositives++
    }

    // False negative: Positive evaluated as VISUAL_MISMATCH
    if (isPositive && evalResult.outcome === 'VISUAL_MISMATCH') {
      falseNegatives++
    }

    if (isBorderline && evalResult.outcome === 'MANUAL_REVIEW_REQUIRED') {
      borderlineCount++
    }

    const itemPassed = evalResult.outcome === item.expectedOutcome
    if (itemPassed) {
      passedCount++
    }

    details.push({
      id: item.id,
      kind: item.kind,
      similarity,
      actualOutcome: evalResult.outcome,
      expectedOutcome: item.expectedOutcome,
      passed: itemPassed,
    })
  }

  const calibrationPassed = falsePositives === 0 && falseNegatives === 0 && passedCount === corpus.length

  return {
    totalSamples: corpus.length,
    passedCount,
    falsePositives,
    falseNegatives,
    borderlineCount,
    corpusVersion: CALIBRATION_CORPUS_VERSION,
    thresholdVersion: PERCEPTUAL_SIMILARITY_THRESHOLDS.VERSION,
    calibrationPassed,
    details,
  }
}

/**
 * Gate evaluator for release pipeline.
 */
export function evaluateCalibrationGate(
  report: CalibrationReport
): CalibrationGateOutcome {
  const gateViolations: string[] = []

  if (report.falsePositives > 0) {
    gateViolations.push(`Strict security gate violation: ${report.falsePositives} false positives detected!`)
  }

  if (report.falseNegatives > 0) {
    gateViolations.push(`False negative rejection: ${report.falseNegatives} legitimate positive images failed verification.`)
  }

  if (report.passedCount !== report.totalSamples) {
    const unpassedIds = report.details.filter(d => !d.passed).map(d => d.id).join(', ')
    gateViolations.push(`Outcome mismatch on ${report.totalSamples - report.passedCount} samples (${unpassedIds}).`)
  }

  if (gateViolations.length > 0) {
    return {
      ok: false,
      status: 'CALIBRATION_GATE_FAILED',
      gateViolations,
      reason: gateViolations.join('; '),
    }
  }

  return {
    ok: true,
    status: 'CALIBRATION_GATE_PASSED',
    gateViolations: [],
  }
}
