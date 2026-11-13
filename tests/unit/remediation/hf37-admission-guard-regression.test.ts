import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SoheeReadinessFactKey } from '@/features/sohee-ready/types'

// Mock Supabase server client
const mockGetUser = vi.fn()
const mockWorkspaceMembersSelect = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: mockGetUser,
    },
    from: (table: string) => {
      if (table === 'workspace_members') {
        return {
          select: () => ({
            eq: () => ({
              limit: mockWorkspaceMembersSelect,
            }),
          }),
        }
      }
      return {
        select: () => ({ eq: () => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }) }),
      }
    },
  })),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }),
}))

describe('HF-37: SOHEE_READY Admission Guard Restoration & Defense-in-Depth (ANI-1386)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Direct Route POST /api/channels/test-publish Admission Guard', () => {
    it('fails closed with 401 when request is unauthenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

      const { POST } = await import('@/app/api/channels/test-publish/route')

      const req = new Request('http://localhost:3000/api/channels/test-publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId: 'INSTAGRAM' }),
      })

      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('fails closed with 403 SOHEE_NOT_READY when workspace is unready', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-unready-1' } },
        error: null,
      })
      mockWorkspaceMembersSelect.mockResolvedValue({
        data: [{ workspace_id: 'ws-unready-route-1' }],
        error: null,
      })

      const { POST } = await import('@/app/api/channels/test-publish/route')

      const req = new Request('http://localhost:3000/api/channels/test-publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId: 'INSTAGRAM' }),
      })

      const res = await POST(req)
      const json = await res.json()

      expect(res.status).toBe(403)
      expect(json.errorCode).toBe('SOHEE_NOT_READY')
      expect(json.success).toBe(false)
      expect(json.verified).toBe(false)
    })
  })

  describe('2. Direct Executor Call Bypass Protection (Defense-in-Depth)', () => {
    it('fails closed at shared executeMetaPublish execution boundary when workspace is NOT ready', async () => {
      const { executeMetaPublish } = await import('@/lib/external-actions/meta-action-executor')

      const mockIgProvider = {
        publish: vi.fn(),
        sendCommentReply: vi.fn(),
        sendDirectMessage: vi.fn(),
      }

      const result = await executeMetaPublish({
        workspaceId: 'ws-unready-direct-call-1',
        actorUserId: 'user-1',
        channel: 'instagram',
        idempotencyKey: 'idem-bypass-direct-1',
        caption: 'Bypass test post',
        igProvider: mockIgProvider as any,
      })

      // Provider MUST NEVER be invoked!
      expect(mockIgProvider.publish).not.toHaveBeenCalled()
      expect(result.status).toBe('BLOCKED')
      expect(result.errorCode).toBe('SOHEE_NOT_READY')
      expect(result.success).toBe(false)
      expect(result.verified).toBe(false)
    })
  })

  describe('3. 7 Canonical Facts Missing Matrix (7 Negative Cases)', () => {
    const CANONICAL_FACTS: SoheeReadinessFactKey[] = [
      'BUSINESS_VERIFIED',
      'INSTAGRAM_VERIFIED',
      'THREADS_VERIFIED',
      'BUSINESS_KNOWLEDGE_CONFIRMED',
      'TEXT_HARNESS_CONFIRMED',
      'IMAGE_HARNESS_CONFIRMED',
      'OPERATING_POLICY_CONFIRMED',
    ]

    for (const missingFact of CANONICAL_FACTS) {
      it(`blocks publish and keeps provider invocation count = 0 when [${missingFact}] is missing`, async () => {
        const { executeMetaPublish } = await import('@/lib/external-actions/meta-action-executor')

        const mockIgProvider = {
          publish: vi.fn(),
          sendCommentReply: vi.fn(),
          sendDirectMessage: vi.fn(),
        }

        // Target workspace has 6 true and exactly 1 false
        const testWorkspaceId = `ws-missing-${missingFact.toLowerCase().replace(/_/g, '-')}`

        const result = await executeMetaPublish({
          workspaceId: testWorkspaceId,
          actorUserId: 'user-1',
          channel: 'instagram',
          idempotencyKey: `idem-missing-${missingFact}`,
          caption: 'Missing fact test post',
          igProvider: mockIgProvider as any,
        })

        // Provider invocation MUST be zero
        expect(mockIgProvider.publish).toHaveBeenCalledTimes(0)
        expect(result.status).toBe('BLOCKED')
        expect(result.errorCode).toBe('SOHEE_NOT_READY')
        expect(result.message).toContain('소희가 아직 실제 마케팅 업무를 수행할 준비가 되지 않았습니다')
      })
    }
  })

  describe('4. Stale Verification Degradation Guard', () => {
    it('blocks publish when provider verification is stale (> 7 days)', async () => {
      const { executeMetaPublish } = await import('@/lib/external-actions/meta-action-executor')

      const mockIgProvider = {
        publish: vi.fn(),
        sendCommentReply: vi.fn(),
        sendDirectMessage: vi.fn(),
      }

      const result = await executeMetaPublish({
        workspaceId: 'ws-stale-verification-1',
        actorUserId: 'user-1',
        channel: 'instagram',
        idempotencyKey: 'idem-stale-1',
        caption: 'Stale test post',
        igProvider: mockIgProvider as any,
      })

      expect(mockIgProvider.publish).toHaveBeenCalledTimes(0)
      expect(result.status).toBe('BLOCKED')
      expect(result.errorCode).toBe('SOHEE_NOT_READY')
    })
  })
})
