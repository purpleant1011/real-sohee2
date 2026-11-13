import { describe, expect, it } from 'vitest'
import { confirmRecoveryBooking } from '../booking-adapter'

// ANI-1736: 화면 재시도(탭 재탭·네트워크 재요청)가 와도 예약 확정이 중복되지 않고, 어댑터가 스스로 재시도하지 않는다.
// 상태 있는 가짜 repository 가 RPC 의 원자 계약(버전 CAS·수락 메시지 필수·슬롯 단일 확정)을 흉내낸다.
const actor = { userId: 'u', workspaceId: 'w' } as any
function fakeRepo(opts: { acceptance: boolean; slotTaken?: boolean }) {
  const state = { reservations: [] as string[], version: 3, calls: 0 }
  return {
    state,
    repository: {
      confirmBooking: async (_a: unknown, p: { expectedVersion: number; inboundAcceptanceMessageId: string }) => {
        state.calls += 1
        if (!opts.acceptance || !p.inboundAcceptanceMessageId) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' })
        if (opts.slotTaken || p.expectedVersion !== state.version) throw Object.assign(new Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' })
        state.version += 1
        state.reservations.push('bk_1')
        return { reservation_id: 'bk_1', slot_id: 's1', confirmed_at: '2026-10-23T00:00:00Z', case: { id: 'c1', version: state.version } }
      },
    } as any,
  }
}
const params = { caseId: 'c1', expectedVersion: 3, proposalRevision: 1, inboundAcceptanceMessageId: 'm1', fingerprint: 'fp' }

describe('예약 확정 재시도 중복 안전', () => {
  it('성공 후 같은 요청을 재시도하면 두 번째는 충돌(VERSION_CONFLICT)이고 예약은 1건뿐', async () => {
    const { repository, state } = fakeRepo({ acceptance: true })
    const first = await confirmRecoveryBooking(actor, params, { repository, client: {} as any })
    const retry = await confirmRecoveryBooking(actor, params, { repository, client: {} as any })
    expect(first.ok).toBe(true)
    expect(retry).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
    expect(state.reservations).toHaveLength(1)
  })
  it('고객 수락 메시지가 없으면 NOT_FOUND 로 막히고 예약 0건 (어댑터 자동 재시도 없음)', async () => {
    const { repository, state } = fakeRepo({ acceptance: false })
    const r = await confirmRecoveryBooking(actor, params, { repository, client: {} as any })
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(state.calls).toBe(1)
    expect(state.reservations).toHaveLength(0)
  })
  it('슬롯 충돌은 성공으로 위장되지 않고 한 번만 시도한다', async () => {
    const { repository, state } = fakeRepo({ acceptance: true, slotTaken: true })
    const r = await confirmRecoveryBooking(actor, params, { repository, client: {} as any })
    expect(r).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' })
    expect(state.calls).toBe(1)
    expect(state.reservations).toHaveLength(0)
  })
  it('알 수 없는 오류는 INTERNAL_ERROR 로 내리며 예약 성공으로 보이지 않는다', async () => {
    const repository = { confirmBooking: async () => { throw new Error('boom') } } as any
    expect(await confirmRecoveryBooking(actor, params, { repository, client: {} as any })).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' })
  })
})
