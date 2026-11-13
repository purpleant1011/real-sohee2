// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { resolvePushTokenStatus } from '../push-token-status'
import {
  PUSH_SUBSCRIPTION_STORE_READY,
  readPushTokenLookup,
  toPushTokenRecord,
  type PushTokenGateway,
  type PushSubscriptionLookup,
} from './read-push-token'

const USER = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-10-24T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function gateway(result: PushSubscriptionLookup | Error): PushTokenGateway & { findSubscription: ReturnType<typeof vi.fn> } {
  return {
    findSubscription: vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    }),
  }
}

describe('푸시 구독 조회(ANI-1724) — 저장소 게이트', () => {
  it('이 배포에는 구독 테이블이 없으므로 저장소 미구성 상태다', () => {
    expect(PUSH_SUBSCRIPTION_STORE_READY).toBe(false)
  })

  it('저장소가 없으면 조회를 보내지 않고 undefined 를 돌려준다', async () => {
    const deps = gateway({ kind: 'empty' })
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: false, gateway: deps })

    // undefined 는 '등록 없음'도 '확인 실패'도 아니다. 화면은 상태 줄을 그리지 않는다.
    expect(lookup).toBeUndefined()
    expect(deps.findSubscription).not.toHaveBeenCalled()
  })
})

describe('푸시 구독 조회(ANI-1724) — 서버가 확인한 값', () => {
  it('유효한 구독은 표시용 값으로 넘어가 "준비됨"이 된다', async () => {
    const expiresAt = new Date(NOW + 60 * DAY).toISOString()
    const deps = gateway({ kind: 'row', row: { status: 'active', expires_at: expiresAt, revoked_at: null } })
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: true, gateway: deps })

    expect(lookup).toEqual({ ok: true, record: { status: 'active', expiresAt, revokedAt: null } })
    expect(resolvePushTokenStatus({ lookup: lookup!, now: NOW })).toBe('active')
  })

  it('만료 시각이 지난 구독은 "만료됐어요"가 된다', async () => {
    const expiresAt = new Date(NOW - DAY).toISOString()
    const deps = gateway({ kind: 'row', row: { status: 'active', expires_at: expiresAt } })
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: true, gateway: deps })

    expect(resolvePushTokenStatus({ lookup: lookup!, now: NOW })).toBe('expired')
  })

  it('곧 만료되는 구독은 "곧 만료돼요"가 된다', async () => {
    const expiresAt = new Date(NOW + 2 * DAY).toISOString()
    const deps = gateway({ kind: 'row', row: { status: 'active', expires_at: expiresAt } })
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: true, gateway: deps })

    expect(resolvePushTokenStatus({ lookup: lookup!, now: NOW })).toBe('expiring')
  })

  it('서버가 해제했다고 하면 만료 시각이 남아 있어도 "꺼져 있어요"다', async () => {
    const deps = gateway({
      kind: 'row',
      row: { status: 'active', expires_at: new Date(NOW + 60 * DAY).toISOString(), revoked_at: new Date(NOW - DAY).toISOString() },
    })
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: true, gateway: deps })

    expect(resolvePushTokenStatus({ lookup: lookup!, now: NOW })).toBe('revoked')
  })

  it('행이 없으면 "없음"을 확인한 것이므로 등록 없음으로 넘긴다', async () => {
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: true, gateway: gateway({ kind: 'empty' }) })

    expect(lookup).toEqual({ ok: true, record: null })
    expect(resolvePushTokenStatus({ lookup: lookup!, now: NOW })).toBe('not_registered')
  })
})

describe('푸시 구독 조회(ANI-1724) — 실패는 실패로 남긴다', () => {
  it('조회 실패를 등록 없음으로 바꾸지 않는다', async () => {
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: true, gateway: gateway({ kind: 'error' }) })

    expect(lookup).toEqual({ ok: false })
    expect(resolvePushTokenStatus({ lookup: lookup!, now: NOW })).toBe('unknown')
  })

  it('게이트웨이가 예외를 던져도 확인 실패로 닫는다', async () => {
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: true, gateway: gateway(new Error('network')) })

    expect(lookup).toEqual({ ok: false })
  })

  it('행이 객체가 아니면 값을 지어내지 않고 확인 실패로 닫는다', async () => {
    const lookup = await readPushTokenLookup({ userId: USER, storeReady: true, gateway: gateway({ kind: 'row', row: 'nope' }) })

    expect(lookup).toEqual({ ok: false })
  })
})

describe('푸시 구독 조회(ANI-1724) — 값 노출 금지', () => {
  it('endpoint·키·토큰은 표시용 record 로 옮기지 않는다', () => {
    const record = toPushTokenRecord({
      status: 'active',
      expires_at: '2026-12-01T00:00:00.000Z',
      revoked_at: null,
      endpoint: 'https://push.example.test/secret-endpoint',
      p256dh: 'secret-key',
      auth: 'secret-auth',
      id: '44444444-4444-4444-8444-444444444444',
    })

    expect(Object.keys(record).sort()).toEqual(['expiresAt', 'revokedAt', 'status'])
    expect(JSON.stringify(record)).not.toContain('secret')
    expect(JSON.stringify(record)).not.toContain('push.example.test')
  })
})
