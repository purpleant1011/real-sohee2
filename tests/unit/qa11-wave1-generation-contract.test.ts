import { describe, it, expect } from 'vitest'
import {
  evaluateGenerationRunTransition,
  assertAtomicSequenceSupersede,
  validateGenerationIdempotencyReplay,
  type GenerationRunDomainRecord,
  type GenerationBatchDomainRecord,
} from '../../qa/11th/audit/generation-contract-guard'

describe('ANI-1117: GenerationBatch / GenerationRun Canonical Contract & Atomic Sequence Guard', () => {
  const sampleBatch: GenerationBatchDomainRecord = {
    id: 'b1111111-1111-1111-1111-111111111111',
    workspaceId: 'w1111111-1111-1111-1111-111111111111',
    requestedCount: 1,
    startedCount: 1,
    succeededCount: 1,
    failedCount: 0,
    status: 'succeeded',
    idempotencyKey: 'i1111111-1111-1111-1111-111111111111',
  }

  const sampleRunSeq1: GenerationRunDomainRecord = {
    id: 'r1111111-1111-1111-1111-111111111111',
    workspaceId: sampleBatch.workspaceId,
    batchId: sampleBatch.id,
    contentVersionId: 'cv-001',
    idempotencyKey: 'idem-run-001',
    requestFingerprint: 'fp-run-001',
    sequenceNumber: 1,
    status: 'GENERATING',
    promptDigest: 'pd-001',
    isCurrent: false,
    supersededAt: null,
  }

  describe('Forensic Separation: GenerationBatch vs GenerationRun', () => {
    it('distinguishes logical batch intent from provider attempt runs', () => {
      expect(sampleBatch.idempotencyKey).toBeDefined()
      expect(sampleBatch.requestedCount).toBe(1)
      expect(sampleRunSeq1.batchId).toBe(sampleBatch.id)
      expect(sampleRunSeq1.sequenceNumber).toBe(1)
      expect(sampleRunSeq1.status).toBe('GENERATING')
    })
  })

  describe('Atomic Sequence Supersede Guard', () => {
    it('atomically supersedes lower sequence runs when a higher sequence is initiated', () => {
      const activeRuns: GenerationRunDomainRecord[] = [
        { ...sampleRunSeq1, status: 'GENERATING' },
      ]

      const nextSequenceNumber = 2
      const result = assertAtomicSequenceSupersede({
        existingRuns: activeRuns,
        newSequenceNumber: nextSequenceNumber,
        contentVersionId: 'cv-001',
      })

      expect(result.supersededRunIds).toContain(sampleRunSeq1.id)
      expect(result.updatedRuns[0].status).toBe('SUPERSEDED')
      expect(result.updatedRuns[0].supersededAt).not.toBeNull()
      expect(result.updatedRuns[0].isCurrent).toBe(false)
    })

    it('does not supersede runs from different content versions', () => {
      const differentVersionRun: GenerationRunDomainRecord = {
        ...sampleRunSeq1,
        id: 'r2222222-2222-2222-2222-222222222222',
        contentVersionId: 'cv-different',
        status: 'GENERATING',
      }

      const result = assertAtomicSequenceSupersede({
        existingRuns: [differentVersionRun],
        newSequenceNumber: 2,
        contentVersionId: 'cv-001',
      })

      expect(result.supersededRunIds).toHaveLength(0)
      expect(result.updatedRuns[0].status).toBe('GENERATING')
    })
  })

  describe('Stale Late Result Promotion Prevention (Fail-Closed)', () => {
    it('demotes late arriving result to STALE_RESULT if run was superseded', () => {
      const supersededRun: GenerationRunDomainRecord = {
        ...sampleRunSeq1,
        status: 'SUPERSEDED',
        supersededAt: new Date().toISOString(),
      }

      const decision = evaluateGenerationRunTransition({
        currentRun: supersededRun,
        attemptedStatus: 'READY',
        highestActiveSequence: 2,
      })

      expect(decision.finalStatus).toBe('STALE_RESULT')
      expect(decision.isCurrent).toBe(false)
      expect(decision.admittedForPromotion).toBe(false)
      expect(decision.reason).toContain('SUPERSEDED_RUN_CANNOT_BECOME_READY')
    })

    it('demotes arriving result to STALE_RESULT if its sequence is strictly lower than highest active sequence', () => {
      const lateRun: GenerationRunDomainRecord = {
        ...sampleRunSeq1,
        status: 'STORAGE_COMMIT',
        sequenceNumber: 1,
      }

      const decision = evaluateGenerationRunTransition({
        currentRun: lateRun,
        attemptedStatus: 'READY',
        highestActiveSequence: 2, // A newer sequence is already running or complete!
      })

      expect(decision.finalStatus).toBe('STALE_RESULT')
      expect(decision.isCurrent).toBe(false)
      expect(decision.admittedForPromotion).toBe(false)
      expect(decision.reason).toContain('LOWER_SEQUENCE_DEMOTED_TO_STALE')
    })

    it('permits READY transition when run is the highest sequence and not superseded', () => {
      const currentRun: GenerationRunDomainRecord = {
        ...sampleRunSeq1,
        status: 'STORAGE_COMMIT',
        sequenceNumber: 2,
      }

      const decision = evaluateGenerationRunTransition({
        currentRun,
        attemptedStatus: 'READY',
        highestActiveSequence: 2,
      })

      expect(decision.finalStatus).toBe('READY')
      expect(decision.isCurrent).toBe(true)
      expect(decision.admittedForPromotion).toBe(true)
    })
  })

  describe('Idempotency Replay Side-Effect Immunity', () => {
    it('detects existing run on idempotency collision and returns cached record without side effect', () => {
      const existingRun: GenerationRunDomainRecord = {
        ...sampleRunSeq1,
        status: 'READY',
        isCurrent: true,
      }

      const decision = validateGenerationIdempotencyReplay({
        incomingIdempotencyKey: 'idem-run-001',
        existingRun,
      })

      expect(decision.isReplay).toBe(true)
      expect(decision.executeProviderCall).toBe(false)
      expect(decision.cachedRunId).toBe(existingRun.id)
    })

    it('authorizes provider call for fresh unique idempotency key', () => {
      const decision = validateGenerationIdempotencyReplay({
        incomingIdempotencyKey: 'idem-fresh-999',
        existingRun: null,
      })

      expect(decision.isReplay).toBe(false)
      expect(decision.executeProviderCall).toBe(true)
      expect(decision.cachedRunId).toBeNull()
    })
  })
})
