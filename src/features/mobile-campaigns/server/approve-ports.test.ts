import { describe, expect, it } from 'vitest'
import { createSupabaseApprovePorts, type ApproveDbClient } from './approve-ports'

describe('승인 포트 미관측 목록은 fail-closed', () => {
  function ports() {
    const result = { data: null, error: null }
    const query: any = {
      select: () => query,
      eq: () => query,
      limit: async () => result,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }
    const client = { from: () => ({ select: () => query, update: () => query }) } as unknown as ApproveDbClient
    return createSupabaseApprovePorts(client, () => '2026-10-25T00:00:00Z')
  }

  it('예약 목록 null을 예약 없음으로 바꾸지 않는다', async () => {
    await expect(ports().hasConfirmedReservation('ws', 'slot')).rejects.toThrow('reservation_lookup_unobserved')
  })
  it('승인 목록 null을 중복 승인 없음으로 바꾸지 않는다', async () => {
    await expect(ports().findApprovedProposalForSlot('ws', 'slot', 'proposal')).rejects.toThrow('approved_lookup_unobserved')
  })
  it('전이 readback null을 관측된 전이 실패로 바꾸지 않는다', async () => {
    await expect(ports().transitionToApproved('ws', 'proposal', { proposedEnvelope: {}, evidenceContext: {} } as any)).rejects.toThrow('approval_transition_unobserved')
  })
})
