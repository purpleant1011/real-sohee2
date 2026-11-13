import { describe, expect, it, vi } from 'vitest'
import { createSingleFlight, isApprovalStale, APPROVAL_PHRASE } from './approval-gate'

describe('createSingleFlight — 같은 CTA 연속 2회 = 요청 1건', () => {
  it('진행 중 재호출은 같은 Promise를 돌려주고 실제 요청은 1회', async () => {
    const send = vi.fn(async () => 'ok')
    const sf = createSingleFlight(send)
    const [x, y] = await Promise.all([sf.run(), sf.run()])
    expect(send).toHaveBeenCalledTimes(1)
    expect([x, y]).toEqual(['ok', 'ok'])
  })
  it('완료 후에는 새 요청 허용, 실패 후에도 잠금이 풀린다', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok')
    const sf = createSingleFlight(send)
    await expect(sf.run()).rejects.toThrow()
    await expect(sf.run()).resolves.toBe('ok')
  })
})

describe('isApprovalStale — 승인 후 원고가 바뀌면 재승인', () => {
  it('지문이 다르면 stale', () => expect(isApprovalStale({ approvedFingerprint: 'A', currentFingerprint: 'B' })).toBe(true))
  it('같으면 유효', () => expect(isApprovalStale({ approvedFingerprint: 'A', currentFingerprint: 'A' })).toBe(false))
  it('승인 지문이 없으면 stale (fail-closed)', () => expect(isApprovalStale({ approvedFingerprint: null, currentFingerprint: 'A' })).toBe(true))
})

it('명시 승인 문구는 서버 계약과 동일', () => expect(APPROVAL_PHRASE).toBe('이 버전 승인하고 발행'))
