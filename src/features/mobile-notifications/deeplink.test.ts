import { describe, expect, it } from 'vitest'
import { resolveNotificationTarget, previewText } from './deeplink'

describe('resolveNotificationTarget (M23)', () => {
  it('현재 매장 알림의 /app 내부 링크만 허용', () => {
    expect(resolveNotificationTarget({ workspaceId: 'w1', href: '/app/approvals?item=x' }, 'w1')).toEqual({ ok: true, href: '/app/approvals?item=x' })
  })
  it('다른 매장 알림은 이동하지 않고 매장 확인을 요구', () => {
    expect(resolveNotificationTarget({ workspaceId: 'w2', href: '/app/approvals' }, 'w1')).toEqual({ ok: false, reason: 'other_workspace' })
  })
  it('외부/스킴 상대/백슬래시 링크 차단', () => {
    for (const href of ['https://evil.test/app', '//evil.test', '/app/../x\\y', 'javascript:alert(1)'])
      expect(resolveNotificationTarget({ workspaceId: 'w1', href }, 'w1')).toEqual({ ok: false, reason: 'unsafe_link' })
  })
  it('링크가 없으면 안전한 안내', () => {
    expect(resolveNotificationTarget({ workspaceId: 'w1', href: null }, 'w1')).toEqual({ ok: false, reason: 'no_link' })
  })
})

describe('previewText (잠금화면/목록 미리보기 마스킹)', () => {
  it('고객 문의 계열은 본문 대신 일반 문구', () => {
    expect(previewText('approval', '김지수님 010-1234-5678 금요일 예약')).toBe('확인할 답변이 있어요')
  })
  it('시스템/게시 알림은 이미 정제된 본문 유지', () => {
    expect(previewText('publish', '게시 처리 상태를 확인해 주세요.')).toBe('게시 처리 상태를 확인해 주세요.')
  })
})
