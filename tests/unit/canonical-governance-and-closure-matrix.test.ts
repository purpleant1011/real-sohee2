import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  validateEvidenceEnvelope,
  type EvidenceEnvelope,
} from '@/lib/evidence/evidence-envelope'
import {
  getPost8thClosureMatrix,
  POST_8TH_CLOSURE_MATRIX,
} from '@/lib/governance/closure-matrix'

describe('Wave 8: Canonical Governance & Test Result Closure Matrix (ANI-1056, ANI-1057)', () => {
  describe('ANI-1056: Canonical EvidenceEnvelope Contract & CI Anti-Regression', () => {
    it('rejects incomplete evidence envelope missing required fields', () => {
      const incompleteEnvelope: Partial<EvidenceEnvelope> = {
        testRunId: 'RUN-12345',
        workspaceId: '33333333-3333-4333-8333-333333333333',
        // Missing gitSha, externalPostId, receiptId, etc.
      }

      const result = validateEvidenceEnvelope(incompleteEnvelope)
      expect(result.valid).toBe(false)
      expect(result.missingFields).toContain('gitSha')
      expect(result.missingFields).toContain('externalPostId')
      expect(result.missingFields).toContain('receiptId')
      expect(result.reason).toContain('필수 증거 필드가 누락되었습니다')
    })

    it('rejects envelope when sameTruthVerified is false', () => {
      const unverifiedEnvelope: EvidenceEnvelope = {
        testRunId: 'RUN-999',
        runMarker: 'WAVE8_RUN',
        environment: 'production',
        url: 'https://sohee.ai',
        workspaceId: '33333333-3333-4333-8333-333333333333',
        actorUserId: '44444444-4444-4444-8444-444444444444',
        gitSha: '9e1a2664',
        migrationHead: '20260908010000',
        providerAccountId: 'act_123456789',
        channel: 'instagram',
        contentId: '11111111-1111-4111-8111-111111111111',
        contentVersionId: '22222222-2222-4222-8222-222222222222',
        contentFingerprint: 'abc123hash',
        approvalId: '55555555-5555-4555-8555-555555555555',
        actionRequestId: '66666666-6666-4666-8666-666666666666',
        actionAttemptId: '77777777-7777-4777-8777-777777777777',
        externalPostId: '18030536099903148',
        externalPermalink: 'https://www.instagram.com/p/DFxyz/',
        receiptId: '88888888-8888-4888-8888-888888888888',
        observedAt: new Date().toISOString(),
        sameTruthVerified: false, // Not verified!
      }

      const result = validateEvidenceEnvelope(unverifiedEnvelope)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('Same Truth')
    })

    it('approves complete and verified EvidenceEnvelope', () => {
      const validEnvelope: EvidenceEnvelope = {
        testRunId: 'RUN-999',
        runMarker: 'WAVE8_RUN',
        environment: 'production',
        url: 'https://sohee.ai',
        workspaceId: '33333333-3333-4333-8333-333333333333',
        actorUserId: '44444444-4444-4444-8444-444444444444',
        gitSha: '9e1a2664',
        migrationHead: '20260908010000',
        providerAccountId: 'act_123456789',
        channel: 'instagram',
        contentId: '11111111-1111-4111-8111-111111111111',
        contentVersionId: '22222222-2222-4222-8222-222222222222',
        contentFingerprint: 'abc123hash',
        approvalId: '55555555-5555-4555-8555-555555555555',
        actionRequestId: '66666666-6666-4666-8666-666666666666',
        actionAttemptId: '77777777-7777-4777-8777-777777777777',
        externalPostId: '18030536099903148',
        externalPermalink: 'https://www.instagram.com/p/DFxyz/',
        receiptId: '88888888-8888-4888-8888-888888888888',
        observedAt: new Date().toISOString(),
        sameTruthVerified: true,
      }

      const result = validateEvidenceEnvelope(validEnvelope)
      expect(result.valid).toBe(true)
      expect(result.missingFields).toHaveLength(0)
    })

    it('enforces CI Anti-Regression on worker-entry.js: 0 Edge Chat Intercept and 0 Fake Metrics', () => {
      const workerEntryPath = join(process.cwd(), 'worker-entry.js')
      const content = readFileSync(workerEntryPath, 'utf8')

      // 1. Edge Chat Intercept Prohibition
      expect(content).not.toContain('/agent/chat')
      expect(content).not.toContain('handleEdgeAgentChat')

      // 2. Capability Theatre Literals Prohibition
      expect(content).not.toContain('82.4%')
      expect(content).not.toContain('2,450,000')
      expect(content).not.toContain('images.unsplash.com')
    })
  })

  describe('ANI-1057: Post-8th Failure Closure Matrix 1:1 Verification', () => {
    it('verifies that all 7 Post-8th original audit failures are 100% CLOSED', () => {
      const matrix = getPost8thClosureMatrix()

      expect(matrix).toHaveLength(7)
      const expectedIds = ['P0-1', 'P0-2', 'P0-3', 'P0-4', 'P0-5', 'P0-6', 'P0-7']
      expect(matrix.map((item) => item.id)).toEqual(expectedIds)

      for (const item of matrix) {
        expect(item.closureVerdict).toBe('CLOSED')
        expect(item.linearIssueId).toBeDefined()
        expect(item.resolutionFiles.length).toBeGreaterThan(0)
        expect(item.verificationTestSuites.length).toBeGreaterThan(0)
      }
    })
  })
})
