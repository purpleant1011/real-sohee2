import { describe, expect, it } from 'vitest'
import { toKakaoHistoryItem, type KakaoOutboxRowLike } from './contract'

const base: KakaoOutboxRowLike = {
  id: 'job-1',
  reservation_id: 'res-1',
  event: 'BOOKING_CONFIRMED',
  status: 'READY',
  reason_code: null,
  delivery_status: null,
  due_at: '2026-11-09T05:00:00.000Z',
  updated_at: '2026-11-09T05:00:00.000Z',
}

describe('toKakaoHistoryItem', () => {
  it('READY 는 발송 예정', () => {
    const item = toKakaoHistoryItem(base)
    expect(item?.status).toBe('SCHEDULED')
    expect(item?.eventLabel).toBe('예약 확정 안내')
  })

  it('SENT + DELIVERED 는 도착 확인, delivery 없음은 도착 확인 전', () => {
    expect(toKakaoHistoryItem({ ...base, status: 'SENT', delivery_status: 'DELIVERED' })?.status).toBe('DELIVERED')
    const sent = toKakaoHistoryItem({ ...base, status: 'SENT' })
    expect(sent?.status).toBe('SENT')
    expect(sent?.detailLabel).toContain('확인')
    expect(toKakaoHistoryItem({ ...base, status: 'SENT', delivery_status: 'FAILED' })?.status).toBe('FAILED')
  })

  it('UNKNOWN 은 확인 필요이며 재발송하지 않았다고 설명', () => {
    const item = toKakaoHistoryItem({ ...base, status: 'UNKNOWN', reason_code: 'SEND_REJECTED_HTTP_401' })
    expect(item?.status).toBe('NEEDS_CHECK')
    expect(item?.detailLabel).toContain('다시 보내지 않았어요')
  })

  it('BLOCKED 사유별 문구, 모르는 사유는 일반 문구, 원본 사유코드는 노출하지 않음', () => {
    const missing = toKakaoHistoryItem({ ...base, status: 'BLOCKED', reason_code: 'EVIDENCE_MISSING' })
    expect(missing?.status).toBe('HELD')
    expect(missing?.detailLabel).toContain('알렸다는 확인')
    const unknown = toKakaoHistoryItem({ ...base, status: 'BLOCKED', reason_code: 'SOMETHING_NEW' })
    expect(unknown?.detailLabel).toBe('조건이 맞지 않아 보내지 않았어요.')
    expect(JSON.stringify(unknown)).not.toContain('SOMETHING_NEW')
  })

  it('SUPERSEDED 는 취소, 알 수 없는 이벤트·상태는 null', () => {
    expect(toKakaoHistoryItem({ ...base, status: 'SUPERSEDED' })?.status).toBe('CANCELLED')
    expect(toKakaoHistoryItem({ ...base, event: 'UNKNOWN_EVENT' })).toBeNull()
    expect(toKakaoHistoryItem({ ...base, status: 'WHAT' })).toBeNull()
  })

  it('PAYMENT_CONFIRMED 는 결제 완료 안내 라벨을 가진다', () => {
    const item = toKakaoHistoryItem({ ...base, event: 'PAYMENT_CONFIRMED' })
    expect(item).not.toBeNull()
    expect(item?.event).toBe('PAYMENT_CONFIRMED')
    expect(item?.eventLabel).toBe('결제 완료 안내')
  })

  it('결과에 전화번호·비용 필드가 없다', () => {
    const keys = Object.keys(toKakaoHistoryItem(base)!)
    expect(keys.join(',')).not.toMatch(/phone|cost|credit|price|amount/i)
  })
})
