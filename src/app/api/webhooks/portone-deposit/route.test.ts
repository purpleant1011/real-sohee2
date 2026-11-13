import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, createDepositWebhookRouteDeps, dynamic, runtime } from './route'
import type { WebhookRouteEnv } from '@/features/payments/webhook-route'

const WS_A = '11111111-1111-4111-8111-111111111111'
const SECRET = 'route-secret-value'

const ENV_BASE: WebhookRouteEnv = {
  DEPOSIT_WEBHOOK_ENABLED: '1',
  DEPOSIT_WEBHOOK_WORKSPACE_ALLOWLIST: WS_A,
  DEPOSIT_WEBHOOK_TEST_SECRET: SECRET,
  NODE_ENV: 'test',
}

const MANAGED_KEYS = [
  'DEPOSIT_WEBHOOK_ENABLED',
  'DEPOSIT_WEBHOOK_WORKSPACE_ALLOWLIST',
  'DEPOSIT_WEBHOOK_TEST_SECRET',
  'NODE_ENV',
] as const

function applyEnv(env: WebhookRouteEnv) {
  // process.env is typed read-only for NODE_ENV; tests must still swap it.
  const mutable = process.env as Record<string, string | undefined>
  for (const key of MANAGED_KEYS) {
    const value = env[key]
    if (value === undefined) delete mutable[key]
    else mutable[key] = value
  }
}

const saved = Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]])) as Record<string, string | undefined>

afterEach(() => {
  applyEnv(saved)
})

function request(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/portone-deposit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

describe('portone-deposit route — 계약 상수와 export', () => {
  it('동적 라우트이며 nodejs runtime 이다', () => {
    expect(dynamic).toBe('force-dynamic')
    expect(runtime).toBe('nodejs')
  })

  it('POST/GET 핸들러를 export 한다', () => {
    expect(typeof POST).toBe('function')
    expect(typeof GET).toBe('function')
  })

  it('GET 은 405 를 낸다', async () => {
    const res = GET()
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ ok: false, code: 'METHOD_NOT_ALLOWED' })
  })
})

describe('portone-deposit route — deps 조립', () => {
  it('영속 원장 배선이 없으면 LEDGER_NOT_CONFIGURED 로 정직하게 실패한다', () => {
    const resolved = createDepositWebhookRouteDeps(ENV_BASE)
    expect(resolved.kind).toBe('UNAVAILABLE')
    if (resolved.kind !== 'UNAVAILABLE') throw new Error('unreachable')
    expect(resolved.response).toEqual({ status: 503, body: { ok: false, code: 'LEDGER_NOT_CONFIGURED' } })
  })
})

describe('portone-deposit route — POST 게이트', () => {
  it('플래그가 없으면 본문을 읽지 않고 503 WEBHOOK_DISABLED 다', async () => {
    applyEnv({ ...ENV_BASE, DEPOSIT_WEBHOOK_ENABLED: undefined })

    const res = await POST(request('{not json at all', { 'x-sohee-test-workspace': WS_A }))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, code: 'WEBHOOK_DISABLED' })
  })

  it("플래그가 '0' 이면 503 WEBHOOK_DISABLED 다", async () => {
    applyEnv({ ...ENV_BASE, DEPOSIT_WEBHOOK_ENABLED: '0' })

    const res = await POST(request('{}'))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, code: 'WEBHOOK_DISABLED' })
  })

  it('production 에서는 플래그가 켜져 있어도 503 PRODUCTION_FORBIDDEN 이다', async () => {
    applyEnv({ ...ENV_BASE, NODE_ENV: 'production' })

    const res = await POST(request('{}'))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, code: 'PRODUCTION_FORBIDDEN' })
  })

  it('플래그가 켜져 있어도 배선 전에는 503 LEDGER_NOT_CONFIGURED 이고 성공을 흉내내지 않는다', async () => {
    applyEnv(ENV_BASE)

    const res = await POST(request(JSON.stringify({ type: 'PAYMENT_PAID' })))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ ok: false, code: 'LEDGER_NOT_CONFIGURED' })
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })
})
