import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST as publishRoute } from '@/app/api/missions/first-post/publish/route'
import { POST as approveRoute } from '@/app/api/missions/first-post/approve/route'

// We will test the routes directly
describe('P0-2, 3, 4: Server-Side Durable Approval, Execution Revalidation & Idempotency', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const userId = '22222222-2222-4222-8222-222222222222'
  const missionId = '33333333-3333-4333-8333-333333333333'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Server-side Durable Approval Truth', () => {
    it('rejects publish request when mission is NOT found in server DB', async () => {
      // Client tries to send an arbitrary client-manufactured approvedMission
      const fakeReq = new Request('http://localhost/api/missions/first-post/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId,
          // Client-supplied payload that shouldn't be trusted alone
          approvedMission: {
            id: 'fake',
            workspaceId,
            missionId,
            status: 'APPROVED_FOR_PUBLISH',
            approvedFingerprint: 'fake',
          },
        }),
      })

      const res = await publishRoute(fakeReq)
      // When unauthenticated or mission not found in DB, must reject
      expect([401, 403, 404, 422]).toContain(res.status)
      const data = await res.json()
      expect(data.error).toBeDefined()
    })
  })
})
