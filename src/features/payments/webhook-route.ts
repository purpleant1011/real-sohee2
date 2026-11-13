/**
 * PortOne 예약금 웹훅 route 오케스트레이션 (TEST 전용 · 기본 OFF).
 * ANI-1616
 *
 * Next 에 의존하지 않는 순수 함수다. route 파일은 raw bytes 와 헤더만 넘기고,
 * 판정·원장 호출 순서는 전부 여기서 결정한다.
 *
 * 고정 순서:
 *   플래그 → production 금지 → workspace allowlist → TEST secret → 서명 검증
 *   → 본문 strict 파싱 → 예약 현재 상태 조회 → 독립 조회(readback) → 원장 커밋
 *
 * 원칙:
 *  - 어떤 경우에도 예약을 만들거나 확정하지 않는다. 예약은 읽기만 한다.
 *  - 플래그가 꺼져 있으면 본문 파싱·서명 검증·원장·readback 을 한 번도 호출하지 않는다.
 *  - 응답 본문에는 금액·결제번호·secret·내부 kind 원문을 넣지 않는다. 로그도 남기지 않는다.
 *  - 포트가 알 수 없는 결과를 주면 성공으로 위장하지 않고 500 으로 끝낸다.
 */

import { z } from 'zod'
import type { Context, Scope } from '../policy-gate/testing/minimal-admission'
import type { BookingFact } from './deposit-ledger'
import { LedgerPortError, type PaymentLedgerPort } from './ledger-port'
import { bodySchema, type ReadbackPort, type ReadbackResult } from './payment-webhook'
import type { TestVerifier } from './testing/minimal-webhook-verifier'

export type WebhookRouteEnv = Readonly<Record<string, string | undefined>>

export type WebhookRouteDeps = Readonly<{
  env: WebhookRouteEnv
  now: () => Date
  /** 업무 포트(주입). 인메모리 Map 을 SSOT 로 쓰지 않는다. */
  ledger: PaymentLedgerPort
  verifier: TestVerifier
  readback: ReadbackPort
  currentBooking: (query: { workspaceId: string; intentId: string }) => Promise<BookingFact | null>
}>

export type WebhookRouteResponse = Readonly<{
  status: number
  body: { ok: boolean; code: string; message?: string }
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const response = (status: number, code: string): WebhookRouteResponse => ({ status, body: { ok: false, code } })

const accepted = (status: number, code: string): WebhookRouteResponse => ({ status, body: { ok: true, code } })

/**
 * CSV UUID allowlist. 빈 목록·`*`·공백 항목·비UUID 항목은 목록 자체를 무효로 본다.
 * `parseMetaLiveAllowlist` 는 와일드카드를 환경에 따라 허용하므로 이 route 에서는 쓰지 않는다.
 */
export function parseDepositWebhookAllowlist(raw: string | undefined): readonly string[] | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return []
  const entries = trimmed.split(',')
  const allowed: string[] = []
  for (const entry of entries) {
    const value = entry.trim()
    if (value.length === 0 || value === '*' || !UUID_PATTERN.test(value)) return null
    allowed.push(value)
  }
  return allowed
}

function readHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value
  }
  return undefined
}

/**
 * 본문·서명을 보지 않고 판정할 수 있는 게이트. 플래그가 기본 OFF 다.
 * 통과하면 null, 아니면 그대로 반환할 응답.
 */
export function preflightDepositWebhook(env: WebhookRouteEnv): WebhookRouteResponse | null {
  // production 은 플래그와 무관하게 항상 거부한다. 이 route 는 TEST 전용이다.
  if (env.NODE_ENV === 'production') return response(503, 'PRODUCTION_FORBIDDEN')
  // 플래그가 정확히 '1' 이 아니면 기본 OFF. 본문·서명·원장·readback 을 건드리지 않는다.
  if (env.DEPOSIT_WEBHOOK_ENABLED !== '1') return response(503, 'WEBHOOK_DISABLED')
  return null
}

type ObservedOutcome = 'MATCHED' | 'MISMATCH' | 'UNCONFIRMED'

/** readback·예약 사실로 정산 outcome 을 계산한다. 예약을 되살리거나 확정하지 않는다. */
function decideOutcome(params: {
  observed: ReadbackResult
  bodyAmountKrw: number
  workspaceId: string
  booking: BookingFact | null
}): ObservedOutcome {
  if (params.observed.status !== 'PAID') return 'UNCONFIRMED'

  const reasons: string[] = []
  if (params.observed.amountKrw !== params.bodyAmountKrw) reasons.push('AMOUNT_MISMATCH')
  if (params.observed.currency !== 'KRW') reasons.push('CURRENCY_MISMATCH')
  if (!params.booking) {
    reasons.push('BOOKING_NOT_CONFIRMED')
  } else if (params.booking.workspaceId !== params.workspaceId || params.booking.status !== 'CONFIRMED') {
    reasons.push('BOOKING_NOT_CONFIRMED')
  }
  return reasons.length > 0 ? 'MISMATCH' : 'MATCHED'
}

/** readback 금액이 원장 입력으로 쓸 수 없는 값이면 본문 금액을 보존한다. */
function settlementAmountKrw(observed: ReadbackResult, bodyAmountKrw: number): number {
  if (observed.status !== 'PAID') return bodyAmountKrw
  const amount = observed.amountKrw
  return Number.isSafeInteger(amount) && amount > 0 ? amount : bodyAmountKrw
}

function mapLedgerFailure(error: unknown): WebhookRouteResponse {
  if (error instanceof LedgerPortError) {
    switch (error.code) {
      case 'LEDGER_UNAVAILABLE':
        return response(503, 'LEDGER_UNAVAILABLE')
      case 'INVALID_LEDGER_INPUT':
        return response(400, 'INVALID_REQUEST')
      case 'LEDGER_CONTRACT_VIOLATION':
        return response(500, 'LEDGER_CONTRACT_VIOLATION')
      default:
        return response(500, 'INTERNAL_ERROR')
    }
  }
  return response(500, 'INTERNAL_ERROR')
}

export async function handleDepositWebhook(input: {
  deps: WebhookRouteDeps
  rawBody: Uint8Array
  headers: Readonly<Record<string, string>>
}): Promise<WebhookRouteResponse> {
  const { deps, rawBody, headers } = input

  // 1. 기본 OFF. 본문·서명·원장·readback 을 건드리지 않는다.
  const gate = preflightDepositWebhook(deps.env)
  if (gate) return gate

  // 2. workspace 는 본문이 아니라 서명 헤더에서만 온다. allowlist 밖이면 검증 전에 끝낸다.
  const allowed = parseDepositWebhookAllowlist(deps.env.DEPOSIT_WEBHOOK_WORKSPACE_ALLOWLIST)
  const headerWorkspace = readHeader(headers, 'x-sohee-test-workspace')
  if (allowed === null || allowed.length === 0 || !headerWorkspace || !allowed.includes(headerWorkspace)) {
    return response(403, 'WORKSPACE_NOT_ALLOWED')
  }

  // 3. secret 이 없으면 검증을 우회하지 않는다.
  const secret = deps.env.DEPOSIT_WEBHOOK_TEST_SECRET
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    return response(503, 'TEST_SECRET_MISSING')
  }

  const now = deps.now()
  const context: Context = { now }
  // provider/action 은 route 가 고정한다. refund/message 로 서명된 요청을 결제로 재사용할 수 없다.
  const expectedScope: Scope = {
    workspaceId: headerWorkspace,
    provider: 'portone',
    action: 'payment',
    operationKey: readHeader(headers, 'x-sohee-test-operation') ?? '',
  }

  // 4. 서명 검증. 실패하면 원장·readback 0회.
  let verification
  try {
    verification = await deps.verifier.verify(context, { expectedScope, rawBody, headers })
  } catch {
    return response(401, 'SIGNATURE_INVALID')
  }
  if (verification.kind !== 'TEST_SIGNATURE_OBSERVATION') {
    return response(401, 'SIGNATURE_INVALID')
  }

  // 5. 검증을 통과한 뒤에만 본문을 해석한다.
  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(JSON.parse(new TextDecoder().decode(rawBody)))
  } catch {
    return response(400, 'INVALID_REQUEST')
  }

  const workspaceId = verification.scope.workspaceId

  // 6. 예약 현재 상태(읽기 전용) → 독립 조회 → 원장 커밋.
  let booking: BookingFact | null
  try {
    booking = await deps.currentBooking({ workspaceId, intentId: parsed.intentId })
  } catch {
    return response(500, 'INTERNAL_ERROR')
  }

  let observed: ReadbackResult
  try {
    observed = await deps.readback({ workspaceId, paymentRef: parsed.paymentRef })
  } catch {
    return response(500, 'INTERNAL_ERROR')
  }

  const outcome = decideOutcome({
    observed,
    bodyAmountKrw: parsed.amountKrw,
    workspaceId,
    booking,
  })

  let committed
  try {
    committed = await deps.ledger.commitPaymentObservation({
      workspaceId,
      eventId: verification.eventId,
      payloadDigest: verification.bodyDigest,
      intentId: parsed.intentId,
      paymentRef: parsed.paymentRef,
      amountKrw: settlementAmountKrw(observed, parsed.amountKrw),
      currency: 'KRW',
      paidAt: observed.status === 'PAID' ? observed.paidAt : now,
      outcome,
    })
  } catch (error) {
    return mapLedgerFailure(error)
  }

  // 7. 포트 결과를 요청 outcome 과 대조한다. 모르는 kind 는 성공으로 승격하지 않는다.
  switch (committed.kind) {
    case 'INTENT_NOT_FOUND':
      return response(404, 'INTENT_NOT_FOUND')
    case 'TEST_CAPTURE_RECORDED':
      if (outcome !== 'MATCHED') return response(500, 'LEDGER_CONTRACT_VIOLATION')
      return accepted(200, 'TEST_CAPTURE_RECORDED')
    case 'NEEDS_REVIEW':
      if (outcome === 'MATCHED') return response(500, 'LEDGER_CONTRACT_VIOLATION')
      // 관측이 확인되지 않은 경우(PENDING/NOT_FOUND/ERROR)는 사람 확인이 아니라 UNCONFIRMED 로 알린다.
      return response(202, outcome === 'UNCONFIRMED' ? 'UNCONFIRMED' : 'NEEDS_REVIEW')
    case 'REPLAY':
      if (committed.outcome !== undefined && committed.outcome !== outcome) {
        // 이전 관측 결과가 이번 요청과 다르면 재전송이라고 주장하지 않는다.
        return response(500, 'LEDGER_CONTRACT_VIOLATION')
      }
      return accepted(200, 'REPLAY')
    default:
      return response(500, 'LEDGER_CONTRACT_VIOLATION')
  }
}
