/**
 * PortOne 예약금 웹훅 route (TEST 전용 · 기본 OFF).
 * ANI-1616
 *
 * 이 route 는 판정하지 않는다. raw bytes 와 헤더를 `handleDepositWebhook` 에 넘기고
 * 그 결과를 그대로 HTTP 응답으로 옮기기만 한다.
 *
 * 영속 원장/독립 조회/예약 조회 배선은 이번 범위 밖이다.
 *   - 영속 원장: `createPsqlRpc`/service_role 어댑터. 계약·키 확정 후 별도 승인 필요.
 *   - 독립 조회(readback): PortOne 조회 API 계약 확정 후 별도 승인 필요.
 *   - 예약 현재 상태: 서버 명령 API 경유 조회로 배선.
 * 배선이 없는데 성공을 흉내내지 않는다. 조립할 수 없으면 503 으로 정직하게 끝낸다.
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  handleDepositWebhook,
  preflightDepositWebhook,
  type WebhookRouteDeps,
  type WebhookRouteEnv,
  type WebhookRouteResponse,
} from '@/features/payments/webhook-route'
import type { PaymentLedgerPort } from '@/features/payments/ledger-port'
import type { ReadbackPort } from '@/features/payments/payment-webhook'
import type { BookingFact } from '@/features/payments/deposit-ledger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 영속 원장 팩토리. 계약·키 확정 후 별도 승인 시에만 채운다. */
const createLedgerPort: ((env: WebhookRouteEnv) => PaymentLedgerPort) | null = null

/** PortOne 독립 조회 팩토리. 계약 확정 후 별도 승인 시에만 채운다. */
const createReadbackPort: ((env: WebhookRouteEnv) => ReadbackPort) | null = null

/** 예약 현재 상태 조회 팩토리. 서버 명령 API 경유 조회로 배선한다. */
const createBookingLookup:
  | ((env: WebhookRouteEnv) => (query: { workspaceId: string; intentId: string }) => Promise<BookingFact | null>)
  | null = null

/**
 * 서명 검증기 팩토리. 실제 서명 검증 어댑터 계약 확정 후 별도 승인 시에만 채운다.
 * 테스트용 검증기를 운영 코드가 값으로 import 하지 않도록, 다른 포트와 같은 주입 지점을 쓴다.
 */
const createVerifier: ((env: WebhookRouteEnv) => WebhookRouteDeps['verifier']) | null = null

export type DepositWebhookDepsResolution =
  | Readonly<{ kind: 'READY'; deps: WebhookRouteDeps }>
  | Readonly<{ kind: 'UNAVAILABLE'; response: WebhookRouteResponse }>

const unavailable = (code: string): DepositWebhookDepsResolution => ({
  kind: 'UNAVAILABLE',
  response: { status: 503, body: { ok: false, code } },
})

/** 배선 가능한 deps 만 조립한다. 하나라도 없으면 원장·readback 을 대신하지 않고 503 을 돌려준다. */
export function createDepositWebhookRouteDeps(
  env: WebhookRouteEnv,
  now: () => Date = () => new Date()
): DepositWebhookDepsResolution {
  if (!createLedgerPort) return unavailable('LEDGER_NOT_CONFIGURED')
  if (!createReadbackPort || !createBookingLookup) return unavailable('READBACK_NOT_CONFIGURED')
  if (!createVerifier) return unavailable('VERIFIER_NOT_CONFIGURED')

  return {
    kind: 'READY',
    deps: {
      env,
      now,
      ledger: createLedgerPort(env),
      verifier: createVerifier(env),
      readback: createReadbackPort(env),
      currentBooking: createBookingLookup(env),
    },
  }
}

function toResponse(result: WebhookRouteResponse): NextResponse {
  return NextResponse.json(result.body, { status: result.status })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const env: WebhookRouteEnv = process.env

  // 플래그 OFF/production 이면 본문을 읽지도 않는다.
  const gate = preflightDepositWebhook(env)
  if (gate) return toResponse(gate)

  const resolved = createDepositWebhookRouteDeps(env)
  if (resolved.kind === 'UNAVAILABLE') return toResponse(resolved.response)

  // 서명 대상은 원문 bytes 다. 재직렬화하면 서명이 달라진다.
  const rawBody = new Uint8Array(await req.arrayBuffer())
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  return toResponse(await handleDepositWebhook({ deps: resolved.deps, rawBody, headers }))
}

export function GET(): NextResponse {
  return NextResponse.json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, { status: 405 })
}
