import { describe, expect, it } from 'vitest'
import { resolveApprovalCta } from './cta'
import type { MobileApprovalViewV2 } from './contracts'

const FINGERPRINT = 'a'.repeat(64)

function v2(overrides: Partial<MobileApprovalViewV2> = {}): MobileApprovalViewV2 {
  return {
    v: 2,
    workspaceId: '11111111-1111-4111-8111-111111111111',
    id: 'dm:22222222-2222-4222-8222-222222222222',
    kind: 'dm_reply',
    title: '답장 확인',
    targetLabel: '고객 A',
    sourceText: '문의 있어요',
    fullContent: '네, 안녕하세요',
    imageUrls: [],
    datasetMode: 'ACTUAL',
    reason: '내용 검토만 할 수 있어요.',
    version: 3,
    fingerprint: FINGERPRINT,
    recipients: [{ label: '고객 A', verified: true }],
    schedule: { sendAt: null, windowEndsAt: null },
    cost: { estimated: 0, unit: '원', basis: 'CONFIRMED' },
    changes: [],
    consents: [{ purpose: '답장 발송', satisfied: true }],
    gate: { enabled: true, blockers: [], userMessage: '', evaluatedAt: '2026-10-24T00:00:00.000Z' },
    ...overrides,
  }
}

describe('resolveApprovalCta (M19)', () => {
  it('조회 중에는 실행할 수 없다고만 말한다', () => {
    const cta = resolveApprovalCta({ state: 'loading' })
    expect(cta.label).toBe('확인 중이에요')
    expect(cta.disabled).toBe(true)
    expect(cta.reason).toBe('전체 내용을 확인하고 있어요.')
  })

  it('조회 실패를 빈 내용으로 바꾸지 않고 확인을 요구한다', () => {
    const cta = resolveApprovalCta({ state: 'error' })
    expect(cta.label).toBe('내용을 확인해 주세요')
    expect(cta.disabled).toBe(true)
    expect(cta.reason).toContain('불러오지 못했어요')
  })

  it('v1 응답만 있으면 서버가 준 이유로 실행을 잠근다', () => {
    const cta = resolveApprovalCta({ state: 'ready', view: null, fallbackReason: '내용 검토만 할 수 있어요.' })
    expect(cta.label).toBe('소희가 실행 조건을 확인해요')
    expect(cta.disabled).toBe(true)
    expect(cta.reason).toBe('내용 검토만 할 수 있어요.')
  })

  it('서버 게이트가 막으면 게이트 문구를 그대로 쓴다', () => {
    const cta = resolveApprovalCta({
      state: 'ready',
      view: v2({ gate: { enabled: false, blockers: ['SOURCE_STALE'], userMessage: '고객의 새 메시지가 있을 수 있어요.', evaluatedAt: '2026-10-24T00:00:00.000Z' } }),
      fallbackReason: '내용 검토만 할 수 있어요.',
    })
    expect(cta.disabled).toBe(true)
    expect(cta.reason).toBe('고객의 새 메시지가 있을 수 있어요.')
  })

  it('게이트가 열려도 실행 경로가 없으면 실행한 척하지 않는다', () => {
    const cta = resolveApprovalCta({ state: 'ready', view: v2(), fallbackReason: '내용 검토만 할 수 있어요.' })
    expect(cta.disabled).toBe(true)
    expect(cta.label).toBe('실행 기능 준비 중')
    expect(cta.reason).toContain('지금은 내용 검토만')
  })
})
