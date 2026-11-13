import { describe, expect, it } from 'vitest'
import { pickVerifiedPostUrl, toHistoryMessages, buildVersionTimeline, toPanelConnectionStatus, type ReceiptRow } from './work-studio-model'

describe('toHistoryMessages', () => {
  it('사용자 지시와 소희 답변만, 시간순으로, 길면 줄여서 돌려준다', () => {
    const rows = [
      { id: 'm2', role: 'assistant', content: '네, 수정했어요', created_at: '2026-11-02T01:01:00Z' },
      { id: 'm1', role: 'user', content: '더 따뜻하게 써줘', created_at: '2026-11-02T01:00:00Z' },
      { id: 'm3', role: 'system', content: '내부', created_at: '2026-11-02T01:02:00Z' },
      { id: 'm4', role: 'user', content: 'x'.repeat(2000), created_at: '2026-11-02T01:03:00Z' },
    ]
    const out = toHistoryMessages(rows)
    expect(out.map(m => m.id)).toEqual(['m1', 'm2', 'm4'])
    expect(out[0]).toMatchObject({ role: 'user', text: '더 따뜻하게 써줘' })
    expect(out[2].text.length).toBeLessThanOrEqual(601)
  })
  it('내용이 비었거나 문자열이 아니면 빼고 지어내지 않는다', () => {
    expect(toHistoryMessages([{ id: 'a', role: 'user', content: null, created_at: '2026-11-02T00:00:00Z' }])).toEqual([])
  })
})

describe('pickVerifiedPostUrl', () => {
  it('읽어 확인(verified)된 영수증의 https 주소만 실제 게시물로 인정한다', () => {
    const url = pickVerifiedPostUrl([
      { verified: false, verified_at: null, result_url: 'https://instagram.com/p/a', external_url: null, provider_post_url: null },
      { verified: true, verified_at: '2026-11-02T02:00:00Z', result_url: null, external_url: null, provider_post_url: 'https://www.instagram.com/p/xyz/' },
    ])
    expect(url).toEqual({ url: 'https://www.instagram.com/p/xyz/', verifiedAt: '2026-11-02T02:00:00Z' })
  })
  it('미확인·비 https·javascript: 주소는 null', () => {
    expect(pickVerifiedPostUrl([{ verified: true, verified_at: '2026-11-02T02:00:00Z', result_url: 'javascript:alert(1)', external_url: 'http://x.com', provider_post_url: null }])).toBeNull()
    expect(pickVerifiedPostUrl([])).toBeNull()
  })
  it('receipt 있을 때 receipt 우선', () => {
    const receipts = [
      { verified: true, verified_at: '2026-11-02T02:00:00Z', result_url: null, external_url: null, provider_post_url: 'https://www.instagram.com/p/from-receipt/' },
    ]
    const attempts = [
      { status: 'succeeded', finished_at: '2026-11-02T03:00:00Z', destination_url: 'https://www.instagram.com/p/from-attempt/' },
    ]
    const result = pickVerifiedPostUrl(receipts, attempts)
    expect(result).toEqual({ url: 'https://www.instagram.com/p/from-receipt/', verifiedAt: '2026-11-02T02:00:00Z' })
  })
  it('없고 attempt 성공 URL 있으면 폴백 (가장 최근 1건)', () => {
    const receipts: ReceiptRow[] = []
    const attempts = [
      { status: 'succeeded', finished_at: '2026-11-02T01:00:00Z', destination_url: 'https://www.instagram.com/p/older/' },
      { status: 'succeeded', finished_at: '2026-11-02T03:00:00Z', destination_url: 'https://www.instagram.com/p/newer/' },
    ]
    const result = pickVerifiedPostUrl(receipts, attempts)
    expect(result).toEqual({ url: 'https://www.instagram.com/p/newer/', verifiedAt: '2026-11-02T03:00:00Z' })
  })
  it('둘 다 없으면 null', () => {
    expect(pickVerifiedPostUrl([], [])).toBeNull()
    expect(pickVerifiedPostUrl([], [{ status: 'failed', finished_at: '2026-11-02T03:00:00Z', destination_url: 'https://www.instagram.com/p/fail/' }])).toBeNull()
  })
  it('http/비정상 URL 거부', () => {
    const attempts = [
      { status: 'succeeded', finished_at: '2026-11-02T03:00:00Z', destination_url: 'http://insecure.com/p/123' },
      { status: 'succeeded', finished_at: '2026-11-02T02:00:00Z', destination_url: 'javascript:alert(1)' },
      { status: 'succeeded', finished_at: '2026-11-02T01:00:00Z', destination_url: 'not-a-url' },
    ]
    expect(pickVerifiedPostUrl([], attempts)).toBeNull()
  })
})

describe('buildVersionTimeline', () => {
  it('최신 버전이 위, 수정 사유(revisionReason)와 현재 버전 표시', () => {
    const t = buildVersionTimeline([
      { id: 'v1', versionNumber: 1, revisionReason: null, createdAt: '2026-11-01T00:00:00Z', caption: '첫 글' },
      { id: 'v2', versionNumber: 2, revisionReason: '더 짧게', createdAt: '2026-11-02T00:00:00Z', caption: '둘째' },
    ] as never, 'v2')
    expect(t.map(x => [x.versionNumber, x.current, x.reason])).toEqual([[2, true, '더 짧게'], [1, false, '처음 만든 원고']])
  })
})

describe('toPanelConnectionStatus', () => {
  it('연결 상태를 4단계로 줄이고 모르는 값은 unknown 으로 둔다', () => {
    expect(toPanelConnectionStatus('connected')).toBe('connected')
    expect(toPanelConnectionStatus('reauth_required')).toBe('expired')
    expect(toPanelConnectionStatus(null)).toBe('disconnected')
    expect(toPanelConnectionStatus('provider_error')).toBe('unknown')
  })
})
