// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { reserveQuickPostCredits, quickPostCost } from '../quick-post-credits'

describe('credit transport replay (ANI-1588)', () => {
  it('keeps the existing grant policy and explains channel eligibility on insufficient credit', async () => {
    const rpc = vi.fn(async () => ({ data: { state: 'insufficient', availableCredits: 0 }, error: null }))
    const from = () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) })
    await expect(reserveQuickPostCredits({ admin: { rpc, from }, workspaceId: 'w1', userId: 'u1', missionId: 'm1', revision: 1, scope: 'text' }))
      .rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS', message: expect.stringContaining('SNS 1곳') })
    expect(rpc.mock.calls).toHaveLength(1)
  })
  it('retains one reservation identity if the first response is lost', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
      .mockImplementation(async (_name, args) => ({ data: { reservationId: args.p_reservation_id, state: 'reserved', requestedCredits: quickPostCost('text'), isReplay: true }, error: null }))
    await reserveQuickPostCredits({ admin: { rpc }, workspaceId: 'w1', missionId: 'm1', revision: 1, scope: 'text' })
    const requests = rpc.mock.calls.map(call => call[1])
    expect(requests[0].p_reservation_id).toBe(requests[1].p_reservation_id)
    expect(requests[0]).toEqual(requests[1])
  })
})
