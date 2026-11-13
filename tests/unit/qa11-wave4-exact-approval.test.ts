import { describe, it, expect, vi } from 'vitest'
import {
  ExactApprovalService,
  StaleApprovalConcurrencyError,
  FingerprintMismatchError,
} from '../../src/features/creative/exact-approval-service'
import {
  preflightPublishAdmission,
  ApprovalIntegrityError,
} from '../../src/features/creative/approval-invalidation-engine'
import type { CreativeBundle, BundleApprovalRecord } from '../../src/features/creative/creative-bundle-types'

describe('ANI-1130: Exact Approval Command + Optimistic Concurrency / TOCTOU Guard', () => {
  const workspaceId = '11111111-1111-4111-a111-111111111111'
  const bundleId = '22222222-2222-4222-a222-222222222222'
  const actorId = '33333333-3333-4333-a333-333333333333'
  const validFingerprint = 'e'.repeat(64)
  const staleFingerprint = 'a'.repeat(64)

  describe('1. Optimistic Concurrency Predicate Gate', () => {
    it('approves bundle atomically when predicate matches (status=PENDING and fingerprint matches)', async () => {
      const mockBundleRow = {
        id: bundleId,
        workspace_id: workspaceId,
        content_id: 'content-1',
        version_id: 'version-1',
        channel: 'instagram',
        caption: '단호박 타르트',
        hashtags: ['#베이커리'],
        creative_brief_version: 'v10.0',
        bundle_fingerprint: validFingerprint,
        approval_status: 'APPROVED',
        approved_fingerprint: validFingerprint,
        approved_at: '2026-09-09T00:00:00Z',
        approved_by: actorId,
      }

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'creative_bundles') {
            return {
              update: vi.fn().mockReturnValue({
                match: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: mockBundleRow,
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const service = new ExactApprovalService(mockSupabase as any)
      const result = await service.approveBundleExact({
        workspaceId,
        bundleId,
        expectedFingerprint: validFingerprint,
        decidedBy: actorId,
      })

      expect(result.status).toBe('APPROVED')
      expect(result.bundleId).toBe(bundleId)
      expect(result.approvedFingerprint).toBe(validFingerprint)
    })

    it('rejects approval when expected fingerprint does not match DB fingerprint (Stale Concurrency)', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'creative_bundles') {
            return {
              update: vi.fn().mockReturnValue({
                match: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: null,
                      error: { code: 'PGRST116', message: 'The result contains 0 rows' },
                    }),
                  }),
                }),
              }),
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: bundleId,
                        workspace_id: workspaceId,
                        bundle_fingerprint: validFingerprint, // actual is validFingerprint, expected was stale
                        approval_status: 'PENDING',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const service = new ExactApprovalService(mockSupabase as any)
      await expect(
        service.approveBundleExact({
          workspaceId,
          bundleId,
          expectedFingerprint: staleFingerprint,
          decidedBy: actorId,
        })
      ).rejects.toThrow(FingerprintMismatchError)
    })
  })

  describe('2. Idempotent Replay & Duplicate Prevention Gate', () => {
    it('returns existing approval idempotently if bundle was already approved with identical fingerprint', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'creative_bundles') {
            return {
              update: vi.fn().mockReturnValue({
                match: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: null, // update affected 0 rows because approval_status was already APPROVED
                      error: { code: 'PGRST116', message: '0 rows' },
                    }),
                  }),
                }),
              }),
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: bundleId,
                        workspace_id: workspaceId,
                        bundle_fingerprint: validFingerprint,
                        approval_status: 'APPROVED',
                        approved_fingerprint: validFingerprint,
                        approved_at: '2026-09-09T00:00:00Z',
                        approved_by: actorId,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const service = new ExactApprovalService(mockSupabase as any)
      const result = await service.approveBundleExact({
        workspaceId,
        bundleId,
        expectedFingerprint: validFingerprint,
        decidedBy: actorId,
      })

      expect(result.status).toBe('APPROVED')
      expect(result.isIdempotentReplay).toBe(true)
    })
  })

  describe('3. Post-Approval Mutation TOCTOU Invalidation Gate', () => {
    it('blocks publish preflight if caption or media changed after approval', () => {
      const bundle: CreativeBundle = {
        bundleId,
        workspaceId,
        contentId: 'content-1',
        versionId: 'version-1',
        channel: 'instagram',
        caption: '단호박 타르트 원본 문구',
        hashtags: ['#베이커리'],
        orderedMedia: [
          {
            mediaAssetId: 'media-1',
            sha256Digest: 'a'.repeat(64),
            position: 0,
            role: 'primary',
          },
        ],
        creativeBriefVersion: 'v10.0',
        bundleFingerprint: validFingerprint,
        approvalStatus: 'APPROVED',
        approvedFingerprint: validFingerprint,
        createdAt: '2026-09-09T00:00:00Z',
        updatedAt: '2026-09-09T00:00:00Z',
      }

      const validApproval: BundleApprovalRecord = {
        id: 'appr-1',
        workspaceId,
        bundleId,
        bundleFingerprint: validFingerprint,
        channel: 'instagram',
        status: 'APPROVED',
        approvedBy: actorId,
        approvedAt: '2026-09-09T00:00:00Z',
      }

      // 1. Post-approval mutation in caption
      const mutatedBundle: CreativeBundle = {
        ...bundle,
        caption: '단호박 타르트 (수정된 문구)',
      }

      expect(() => {
        preflightPublishAdmission({
          bundle: mutatedBundle,
          approval: validApproval,
        })
      }).toThrow(ApprovalIntegrityError)
    })
  })

  describe('4. Approvals Route Static Contract Gate', () => {
    it('ensures content/approvals route verifies ExactApprovalService integration', async () => {
      const { readFileSync } = await import('node:fs')
      const { resolve } = await import('node:path')
      const routePath = resolve(__dirname, '../../src/app/api/workspaces/[workspaceId]/content/approvals/route.ts')
      const content = readFileSync(routePath, 'utf-8')

      expect(content).toContain('ExactApprovalService')
      expect(content).toContain('approveBundleExact')
    })
  })
})
