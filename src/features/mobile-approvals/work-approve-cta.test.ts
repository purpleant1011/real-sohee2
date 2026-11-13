import { describe, expect, it } from 'vitest'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { resolveWorkApproveCta } from './work-approve-cta'

const FINGERPRINT = 'a'.repeat(64)

function snapshot(overrides: Partial<ApprovalPreviewSnapshot> = {}): ApprovalPreviewSnapshot {
  return {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    contentId: '22222222-2222-4222-8222-222222222222',
    versionId: '33333333-3333-4333-8333-333333333333',
    versionNumber: 3,
    fingerprint: FINGERPRINT,
    approval: { id: null, status: 'unreviewed', fingerprint: null },
    channel: 'instagram',
    account: { connectionId: '44444444-4444-4444-8444-444444444444', label: '@sohee', status: 'connected' },
    caption: '본문',
    hashtags: [],
    disclosure: '',
    text: '본문',
    media: [],
    issues: [],
    ...overrides,
  }
}

describe('resolveWorkApproveCta (M07)', () => {
  it('조회 중에는 승인할 수 없다고만 말한다', () => {
    const cta = resolveWorkApproveCta({ state: 'loading' })
    expect(cta.disabled).toBe(true)
    expect(cta.label).toBe('확인 중이에요')
  })

  it('조회 실패를 빈 승인으로 바꾸지 않고 확인을 요구한다', () => {
    const cta = resolveWorkApproveCta({ state: 'error' })
    expect(cta.disabled).toBe(true)
    expect(cta.reason).toContain('불러오지 못했어요')
  })

  it('승인 권한이 없으면 사유를 말하고 잠근다', () => {
    const cta = resolveWorkApproveCta({ state: 'ready', snapshot: snapshot(), canApprove: false })
    expect(cta.disabled).toBe(true)
    expect(cta.reason).toContain('승인 권한이 없어요')
  })

  it('서버가 확인한 문제가 있으면 그 사유로 잠근다', () => {
    const cta = resolveWorkApproveCta({
      state: 'ready',
      canApprove: true,
      snapshot: snapshot({ issues: [{ code: 'ACCOUNT_DISCONNECTED', message: '계정 연결이 끊겼어요.' }] }),
    })
    expect(cta.disabled).toBe(true)
    expect(cta.reason).toBe('계정 연결이 끊겼어요.')
  })

  it('계정이 연결돼 있지 않으면 승인을 열지 않는다', () => {
    const cta = resolveWorkApproveCta({
      state: 'ready',
      canApprove: true,
      snapshot: snapshot({ account: { connectionId: null, label: '', status: 'disconnected' } }),
    })
    expect(cta.disabled).toBe(true)
    expect(cta.reason).toContain('계정 연결')
  })

  it('이미 승인된 네이버 블로그는 "승인됨"으로 잠긴다', () => {
    const cta = resolveWorkApproveCta({
      state: 'ready',
      canApprove: true,
      snapshot: snapshot({
        channel: 'naver_blog',
        approval: { id: 'a', status: 'approved', fingerprint: FINGERPRINT },
      }),
    })
    expect(cta.disabled).toBe(true)
    expect(cta.label).toBe('승인됨')
    expect(cta.action).toBe('approve')
  })

  it('이미 승인된 메타 채널(Instagram/Threads)은 빈칸이 없으면 "지금 게시 요청" CTA를 연다', () => {
    const cta = resolveWorkApproveCta({
      state: 'ready',
      canApprove: true,
      hasPlaceholders: false,
      snapshot: snapshot({ approval: { id: 'a', status: 'approved', fingerprint: FINGERPRINT } }),
    })
    expect(cta.disabled).toBe(false)
    expect(cta.label).toBe('지금 게시 요청')
    expect(cta.action).toBe('publish')
  })

  it('이미 승인된 메타 채널이라도 빈칸이 있으면 실제 "지금 게시 요청"이 잠긴다', () => {
    const cta = resolveWorkApproveCta({
      state: 'ready',
      canApprove: true,
      hasPlaceholders: true,
      snapshot: snapshot({ approval: { id: 'a', status: 'approved', fingerprint: FINGERPRINT } }),
    })
    expect(cta.disabled).toBe(true)
    expect(cta.label).toBe('지금 게시 요청')
    expect(cta.reason).toContain('빈칸')
    expect(cta.action).toBe('publish')
  })

  it('이미 승인된 메타 채널이라도 정보 요청이 있으면 실제 "지금 게시 요청"이 잠긴다', () => {
    const cta = resolveWorkApproveCta({
      state: 'ready',
      canApprove: true,
      hasInfoRequest: true,
      snapshot: snapshot({ approval: { id: 'a', status: 'approved', fingerprint: FINGERPRINT } }),
    })
    expect(cta.disabled).toBe(true)
    expect(cta.label).toBe('지금 게시 요청')
    expect(cta.reason).toContain('정보 요청')
    expect(cta.action).toBe('publish')
  })

  it('승인됐지만 지문이 달라졌으면(내용 변경) 다시 승인할 수 있다', () => {
    const cta = resolveWorkApproveCta({
      state: 'ready',
      canApprove: true,
      snapshot: snapshot({ approval: { id: 'a', status: 'approved', fingerprint: 'b'.repeat(64) } }),
    })
    expect(cta.disabled).toBe(false)
    expect(cta.label).toBe('승인')
    expect(cta.action).toBe('approve')
  })

  it('서버 확인이 끝난 버전만 승인을 연다 — 그래도 게시는 아니다', () => {
    const cta = resolveWorkApproveCta({ state: 'ready', canApprove: true, snapshot: snapshot() })
    expect(cta.disabled).toBe(false)
    expect(cta.reason).toContain('바로 게시되지 않아요')
    expect(cta.action).toBe('approve')
  })
})
