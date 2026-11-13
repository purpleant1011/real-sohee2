import { describe, expect, it } from 'vitest'
import { publishStatusFor, type PublishStatusInput } from './publish-status'

const VERIFIED_INPUT: PublishStatusInput = {
  deliveryStatus: 'succeeded',
  readbackUrl: 'https://www.instagram.com/p/example/',
  verifiedAt: '2026-10-24T03:00:00.000Z',
}

describe('publishStatusFor', () => {
  it('독립 재조회 근거(주소+확인 시각)가 있을 때만 게시 확인이 된다', () => {
    const status = publishStatusFor(VERIFIED_INPUT)
    expect(status.state).toBe('VERIFIED')
    expect(status.kind).toBe('verified')
    expect(status.label).toBe('게시 확인')
    expect(status.permalink).toBe('https://www.instagram.com/p/example/')
  })

  it('전송 접수(succeeded)만으로는 게시 성공을 표시하지 않는다', () => {
    const status = publishStatusFor({ deliveryStatus: 'succeeded' })
    expect(status.state).toBe('CHECKING')
    expect(status.kind).toBe('checking_external')
    expect(status.label).toBe('외부 확인 중')
    expect(status.permalink).toBeNull()
    expect(status.retryAllowed).toBe(false)
  })

  it('게시물 주소가 있어도 확인 시각이 없으면 확인 중으로 둔다', () => {
    const status = publishStatusFor({ deliveryStatus: 'succeeded', readbackUrl: VERIFIED_INPUT.readbackUrl })
    expect(status.state).toBe('CHECKING')
  })

  it('읽을 수 없는 확인 시각은 근거로 쓰지 않는다', () => {
    const status = publishStatusFor({ deliveryStatus: 'succeeded', readbackUrl: VERIFIED_INPUT.readbackUrl, verifiedAt: '어제쯤' })
    expect(status.state).toBe('CHECKING')
  })

  it('http(s) 가 아니거나 호스트가 없는 주소는 근거로 쓰지 않는다', () => {
    for (const readbackUrl of ['javascript:alert(1)', '/app/outcome/1', 'not-a-url', 'https://localhost/p/1']) {
      const status = publishStatusFor({ deliveryStatus: 'succeeded', readbackUrl, verifiedAt: VERIFIED_INPUT.verifiedAt })
      expect(status.state).toBe('CHECKING')
      expect(status.permalink).toBeNull()
    }
  })

  it('전송 중은 전송 중으로만 보여 준다', () => {
    const status = publishStatusFor({ deliveryStatus: 'pending' })
    expect(status.state).toBe('CHECKING')
    expect(status.label).toBe('전송 중')
    expect(status.retryAllowed).toBe(false)
  })

  it('실패는 원인에 따라 재시도 가능 여부를 나눈다', () => {
    const rejected = publishStatusFor({ deliveryStatus: 'failed', failureCause: 'PROVIDER_REJECTED' })
    expect(rejected.state).toBe('FAILED')
    expect(rejected.kind).toBe('action_needed')
    expect(rejected.label).toBe('게시 실패')
    expect(rejected.retryAllowed).toBe(true)

    const unreadable = publishStatusFor({ deliveryStatus: 'failed', failureCause: 'READBACK_UNKNOWN' })
    expect(unreadable.state).toBe('FAILED')
    expect(unreadable.retryAllowed).toBe(false)
    expect(unreadable.detail).toContain('중복')
  })

  it('상태를 모르면 결과 확인 불가로 둔다(성공으로 추정하지 않는다)', () => {
    for (const deliveryStatus of ['unknown', null, undefined] as const) {
      const status = publishStatusFor({ deliveryStatus })
      expect(status.state).toBe('UNKNOWN')
      expect(status.kind).toBe('review')
      expect(status.label).toBe('결과 확인 불가')
      expect(status.permalink).toBeNull()
    }
  })

  it('수동 전달(복사·내려받기)은 게시 확인으로 올리지 않는다', () => {
    for (const manualDelivery of ['copy', 'download'] as const) {
      const status = publishStatusFor({ deliveryStatus: 'succeeded', manualDelivery })
      expect(status.state).toBe('MANUAL')
      expect(status.kind).toBe('draft')
      expect(status.label).toBe('직접 전달')
      expect(status.permalink).toBeNull()
      expect(status.retryAllowed).toBe(false)
      expect(status.detail).toContain('직접 확인')
    }
  })

  it('독립 재조회 근거가 있으면 수동 전달 기록보다 확인된 사실을 먼저 보여 준다', () => {
    const status = publishStatusFor({ ...VERIFIED_INPUT, manualDelivery: 'copy' })
    expect(status.state).toBe('VERIFIED')
  })

  it('보관은 발행 준비 완료로만 표시하고 예약 문구를 쓰지 않는다', () => {
    const status = publishStatusFor({ archived: true })
    expect(status.state).toBe('ARCHIVED')
    expect(status.label).toBe('발행 준비 완료 · 외부 게시 전')
    expect(status.label).not.toContain('예약')
    expect(status.permalink).toBeNull()
    expect(status.retryAllowed).toBe(false)
  })

  it('전송 기록이 있는데 보관 표시가 함께 와도 전송 상태를 감추지 않는다', () => {
    expect(publishStatusFor({ archived: true, deliveryStatus: 'succeeded' }).state).toBe('CHECKING')
    expect(publishStatusFor({ archived: true, deliveryStatus: 'failed' }).state).toBe('FAILED')
    expect(publishStatusFor({ archived: true, deliveryStatus: 'unknown' }).state).toBe('UNKNOWN')
  })

  it('확인 전 상태의 사용자 문구에 게시 성공·게시 완료를 쓰지 않는다', () => {
    const inputs: PublishStatusInput[] = [
      { deliveryStatus: 'pending' },
      { deliveryStatus: 'succeeded' },
      { deliveryStatus: 'failed' },
      { deliveryStatus: 'unknown' },
      { manualDelivery: 'copy' },
      { archived: true },
    ]
    for (const input of inputs) {
      const status = publishStatusFor(input)
      expect(status.label).not.toContain('게시 성공')
      expect(status.label).not.toContain('게시 완료')
      expect(status.label).not.toContain('게시됨')
      expect(status.detail).not.toContain('게시 성공')
      expect(status.detail).not.toContain('게시 완료')
    }
  })

  it('확인되지 않은 상태는 어떤 경우에도 게시물 링크를 내려주지 않는다', () => {
    const inputs: PublishStatusInput[] = [
      { deliveryStatus: 'pending' },
      { deliveryStatus: 'succeeded' },
      { deliveryStatus: 'failed' },
      { deliveryStatus: 'unknown' },
      { manualDelivery: 'download' },
      { archived: true },
    ]
    for (const input of inputs) {
      const status = publishStatusFor(input)
      expect(status.state).not.toBe('VERIFIED')
      expect(status.permalink).toBeNull()
    }
  })
})
