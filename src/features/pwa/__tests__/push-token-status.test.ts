import { describe, expect, it } from 'vitest'
import {
  PUSH_TOKEN_EXPIRING_WINDOW_DAYS,
  PUSH_TOKEN_STATUS_COPY,
  pushTokenStatusCopy,
  resolvePushTokenStatus,
  type PushTokenLookup,
} from '../push-token-status'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 24, 3, 0, 0)
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString()

const record = (overrides: Record<string, unknown> = {}): PushTokenLookup => ({
  ok: true,
  record: { status: 'active', expiresAt: iso(30), revokedAt: null, ...overrides },
})

const status = (lookup: PushTokenLookup) => resolvePushTokenStatus({ lookup, now: NOW })

describe('토큰 상태 — 조회 실패와 "없음"을 섞지 않는다', () => {
  it('조회 실패는 unknown 이다. 등록 없음으로 치환하지 않는다', () => {
    expect(status({ ok: false })).toBe('unknown')
    expect(status({ ok: true, record: null })).toBe('not_registered')
  })

  it('해석할 수 없는 서버 값은 active 로 승격하지 않는다', () => {
    expect(status(record({ status: 'weird' }))).toBe('unknown')
    expect(status(record({ status: 42 }))).toBe('unknown')
    expect(status(record({ expiresAt: 'soon' }))).toBe('unknown')
    expect(status(record({ expiresAt: null }))).toBe('unknown')
    expect(status(record({ expiresAt: undefined }))).toBe('unknown')
  })

  it('만료 시각이 없으면 서버가 active 라 해도 active 로 표시하지 않는다', () => {
    expect(status({ ok: true, record: { status: 'active' } })).toBe('unknown')
  })
})

describe('토큰 상태 — 수명 판정', () => {
  it('만료 전이고 경고 기간 밖이면 active', () => {
    expect(status(record({ expiresAt: iso(PUSH_TOKEN_EXPIRING_WINDOW_DAYS + 1) }))).toBe('active')
    expect(status(record({ expiresAt: iso(90) }))).toBe('active')
  })

  it('경고 기간 안이면 expiring', () => {
    expect(status(record({ expiresAt: iso(PUSH_TOKEN_EXPIRING_WINDOW_DAYS) }))).toBe('expiring')
    expect(status(record({ expiresAt: iso(1) }))).toBe('expiring')
  })

  it('만료 시각이 지났거나 같으면 expired', () => {
    expect(status(record({ expiresAt: iso(0) }))).toBe('expired')
    expect(status(record({ expiresAt: iso(-1) }))).toBe('expired')
  })

  it('서버가 만료라고 하면 로컬 시각이 미래여도 만료로 믿는다', () => {
    expect(status(record({ status: 'expired', expiresAt: iso(90) }))).toBe('expired')
  })

  it('폐기는 만료보다 우선한다', () => {
    expect(status(record({ revokedAt: iso(-2), expiresAt: iso(90) }))).toBe('revoked')
    expect(status(record({ status: 'revoked', revokedAt: null, expiresAt: iso(90) }))).toBe('revoked')
  })

  it('폐기 시각을 해석할 수 없으면 상태를 단정하지 않는다', () => {
    expect(status(record({ revokedAt: 'whenever' }))).toBe('unknown')
  })
})

describe('토큰 상태 문구', () => {
  it('모든 상태에 문구가 있고 내부 코드가 새지 않는다', () => {
    for (const key of Object.keys(PUSH_TOKEN_STATUS_COPY) as Array<keyof typeof PUSH_TOKEN_STATUS_COPY>) {
      const copy = pushTokenStatusCopy(key)
      expect(copy.label.length).toBeGreaterThan(0)
      expect(copy.description.length).toBeGreaterThan(0)
      expect(copy.description).not.toMatch(/[A-Z_]{4,}/)
    }
  })

  it('active 라도 "알림을 받고 있다"로 단정하지 않는다', () => {
    const copy = pushTokenStatusCopy('active')
    expect(copy.description).not.toContain('받고 있어요')
    expect(copy.description).toContain('등록되어 있어요')
    expect(copy.action).toBe('none')
  })

  it('만료·폐기·곧 만료는 다시 연결을 안내한다', () => {
    for (const key of ['expiring', 'expired', 'revoked'] as const) {
      expect(pushTokenStatusCopy(key).action).toBe('renew')
      expect(pushTokenStatusCopy(key).actionLabel).toBeTruthy()
    }
  })

  it('확인 실패는 다시 확인을 안내하고, 등록 없음은 켜기를 안내한다', () => {
    expect(pushTokenStatusCopy('unknown').action).toBe('retry')
    expect(pushTokenStatusCopy('not_registered').action).toBe('enable')
    expect(pushTokenStatusCopy('unknown').description).toContain('없다는 뜻은 아니에요')
  })
})
