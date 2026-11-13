import { subscriptionOffers } from './subscription-offers'

export type SubscriptionOrderStatus =
  | 'created'
  | 'payment_pending'
  | 'paid'
  | 'cancelled'
  | 'failed'

export type SubscriptionOrder = Readonly<{
  orderId: string
  offerCode: string
  offerName?: string
  workspaceId: string
  actorUserId: string
  idempotencyKey: string
  amountKrw: number
  currency: 'KRW'
  status: SubscriptionOrderStatus
  createdAt: string
  storeId?: string
}>

export type CreateSubscriptionOrderDraftInput = Readonly<{
  offerCode: string
  workspaceId: string
  actorUserId: string
  idempotencyKey: string
  now?: Date | string
  storeId?: string
  idGenerator?: () => string
}>

export type VerifyPaymentFailureReason =
  | 'UNKNOWN_OFFER'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'ORDER_ID_MISMATCH'
  | 'STORE_ID_MISMATCH'
  | 'INVALID_ORDER'
  | 'INVALID_PAYMENT'

export type VerifyPaymentSuccess = Readonly<{
  ok: true
}>

export type VerifyPaymentFailure = Readonly<{
  ok: false
  reason: VerifyPaymentFailureReason
  message: string
}>

export type VerifyPaymentResult = VerifyPaymentSuccess | VerifyPaymentFailure

export type PaymentVerificationTarget = Readonly<{
  orderId?: string
  id?: string
  amountKrw?: number
  amount?: number | { total: number }
  currency?: string
  storeId?: string
}>

export type SubscriptionOrderEvent =
  | 'START_PAYMENT'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_COMPLETED'
  | 'PAY_SUCCESS'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'PAY_FAIL'
  | 'FAILED'
  | 'CANCEL'
  | 'CANCELLED'
  | SubscriptionOrderStatus
  | Readonly<{ type: string; [key: string]: unknown }>

export class InvalidOrderTransitionError extends Error {
  readonly code = 'INVALID_ORDER_TRANSITION'
  readonly fromStatus: SubscriptionOrderStatus
  readonly toStatus?: SubscriptionOrderStatus

  constructor(message: string, fromStatus: SubscriptionOrderStatus, toStatus?: SubscriptionOrderStatus) {
    super(message)
    this.name = 'InvalidOrderTransitionError'
    this.fromStatus = fromStatus
    this.toStatus = toStatus
  }
}

/**
 * 정본 전이 허용 맵 (created -> payment_pending -> paid -> cancelled, 실패 전이 허용)
 * 역행(backward) 및 동일 상태로의 중복(duplicate) 전이는 엄격히 차단한다.
 */
export const VALID_SUBSCRIPTION_ORDER_TRANSITIONS: Readonly<
  Record<SubscriptionOrderStatus, readonly SubscriptionOrderStatus[]>
> = Object.freeze({
  created: Object.freeze<SubscriptionOrderStatus[]>(['payment_pending', 'cancelled', 'failed']),
  payment_pending: Object.freeze<SubscriptionOrderStatus[]>(['paid', 'cancelled', 'failed']),
  paid: Object.freeze<SubscriptionOrderStatus[]>(['cancelled']),
  cancelled: Object.freeze<SubscriptionOrderStatus[]>([]),
  failed: Object.freeze<SubscriptionOrderStatus[]>([]),
})

/**
 * 신규 구독 주문 초안을 생성한다 (순수 도메인 모델).
 * 금액은 클라이언트 입력을 전혀 신뢰하지 않으며 오직 `subscriptionOffers` 정본에서만 가져온다.
 */
export function createSubscriptionOrderDraft(
  input: CreateSubscriptionOrderDraftInput
): SubscriptionOrder {
  if (typeof input !== 'object' || input === null) {
    throw new RangeError('유효한 주문 생성 입력이 필요합니다.')
  }

  const trimmedWorkspaceId = typeof input.workspaceId === 'string' ? input.workspaceId.trim() : ''
  if (!trimmedWorkspaceId) {
    throw new RangeError('유효한 워크스페이스 식별자가 필요합니다.')
  }

  const trimmedActorUserId = typeof input.actorUserId === 'string' ? input.actorUserId.trim() : ''
  if (!trimmedActorUserId) {
    throw new RangeError('유효한 사용자 식별자가 필요합니다.')
  }

  const trimmedIdempotencyKey =
    typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : ''
  if (!trimmedIdempotencyKey) {
    throw new RangeError('유효한 멱등성 키가 필요합니다.')
  }

  const matchedOffer = subscriptionOffers.find((offer) => offer.code === input.offerCode)
  if (!matchedOffer) {
    throw new RangeError(`지원하지 않거나 알 수 없는 구독 제안입니다: ${String(input.offerCode)}`)
  }

  let createdAt: string
  if (input.now instanceof Date) {
    if (!Number.isFinite(input.now.getTime())) {
      throw new RangeError('유효하지 않은 now Date 객체입니다.')
    }
    createdAt = input.now.toISOString()
  } else if (typeof input.now === 'string') {
    const parsed = new Date(input.now)
    if (!Number.isFinite(parsed.getTime())) {
      throw new RangeError('유효하지 않은 now ISO 문자열입니다.')
    }
    createdAt = parsed.toISOString()
  } else if (input.now === undefined) {
    createdAt = new Date().toISOString()
  } else {
    throw new RangeError('now는 Date 또는 ISO 문자열이어야 합니다.')
  }

  const idGenerator = input.idGenerator ?? (() => crypto.randomUUID())
  const orderId = idGenerator()
  if (typeof orderId !== 'string' || !orderId.trim()) {
    throw new RangeError('생성된 주문 식별자가 유효하지 않습니다.')
  }

  const trimmedStoreId =
    typeof input.storeId === 'string' && input.storeId.trim().length > 0
      ? input.storeId.trim()
      : undefined

  return Object.freeze({
    orderId: orderId.trim(),
    offerCode: matchedOffer.code,
    offerName: matchedOffer.name,
    workspaceId: trimmedWorkspaceId,
    actorUserId: trimmedActorUserId,
    idempotencyKey: trimmedIdempotencyKey,
    amountKrw: matchedOffer.monthlyTotalPriceKrw,
    currency: 'KRW' as const,
    status: 'created' as const,
    createdAt,
    ...(trimmedStoreId ? { storeId: trimmedStoreId } : {}),
  })
}

/**
 * 결제 결과가 주문 조건과 일치하는지 순수 도메인 검증을 수행한다.
 * unknown offer, orderId 불일치, 금액 불일치, 통화 불일치, 상점 식별자 불일치를 모두 거부한다.
 */
export function verifyPaymentAgainstOrder(
  order: SubscriptionOrder,
  payment: PaymentVerificationTarget,
  options?: { expectedStoreId?: string }
): VerifyPaymentResult {
  if (!order || typeof order !== 'object') {
    return Object.freeze({
      ok: false,
      reason: 'INVALID_ORDER',
      message: '유효한 주문 정보가 필요합니다.',
    })
  }

  if (!payment || typeof payment !== 'object') {
    return Object.freeze({
      ok: false,
      reason: 'INVALID_PAYMENT',
      message: '유효한 결제 정보가 필요합니다.',
    })
  }

  // 1. 구독 제안 정본 확인
  const matchedOffer = subscriptionOffers.find((offer) => offer.code === order.offerCode)
  if (!matchedOffer) {
    return Object.freeze({
      ok: false,
      reason: 'UNKNOWN_OFFER',
      message: `알 수 없는 구독 제안입니다: ${order.offerCode}`,
    })
  }

  // 주문에 기록된 금액이 제안 정본 금액과 다를 경우 위변조로 간주하여 거부
  if (order.amountKrw !== matchedOffer.monthlyTotalPriceKrw) {
    return Object.freeze({
      ok: false,
      reason: 'AMOUNT_MISMATCH',
      message: '주문 금액이 제안 정본 금액과 일치하지 않습니다.',
    })
  }

  // 2. 주문 식별자 일치 검증
  const paymentOrderId = payment.orderId ?? payment.id
  if (!paymentOrderId || paymentOrderId !== order.orderId) {
    return Object.freeze({
      ok: false,
      reason: 'ORDER_ID_MISMATCH',
      message: '주문 식별자가 일치하지 않습니다.',
    })
  }

  // 3. 결제 금액 일치 검증
  const paymentAmount =
    typeof payment.amountKrw === 'number'
      ? payment.amountKrw
      : typeof payment.amount === 'number'
      ? payment.amount
      : typeof payment.amount?.total === 'number'
      ? payment.amount.total
      : undefined

  if (paymentAmount === undefined || paymentAmount !== order.amountKrw) {
    return Object.freeze({
      ok: false,
      reason: 'AMOUNT_MISMATCH',
      message: '결제 금액이 주문 금액과 일치하지 않습니다.',
    })
  }

  // 4. 통화 일치 검증 (KRW 고정)
  if (!payment.currency || payment.currency !== order.currency || payment.currency !== 'KRW') {
    return Object.freeze({
      ok: false,
      reason: 'CURRENCY_MISMATCH',
      message: '결제 통화가 일치하지 않습니다.',
    })
  }

  // 5. 상점 식별자 일치 검증
  // expectedStoreId(옵션) 또는 order.storeId 중 하나가 반드시 있어야 하며, 둘 다 없으면 거부
  const hasExpectedStoreId =
    typeof options?.expectedStoreId === 'string' && options.expectedStoreId.trim().length > 0
  const hasOrderStoreId =
    typeof order.storeId === 'string' && order.storeId.trim().length > 0

  if (!hasExpectedStoreId && !hasOrderStoreId) {
    return Object.freeze({
      ok: false,
      reason: 'STORE_ID_MISMATCH',
      message: '검증 기준 상점 식별자(order.storeId 또는 expectedStoreId)가 필요합니다.',
    })
  }

  const expectedStore = hasExpectedStoreId ? options!.expectedStoreId!.trim() : undefined
  const orderStore = hasOrderStoreId ? order.storeId!.trim() : undefined

  // 둘 다 있는데 서로 다르면(order.storeId ≠ expectedStoreId) 거부
  if (expectedStore && orderStore && expectedStore !== orderStore) {
    return Object.freeze({
      ok: false,
      reason: 'STORE_ID_MISMATCH',
      message: '주문 상점 식별자와 기대 상점 식별자가 일치하지 않습니다.',
    })
  }

  const targetStoreId = expectedStore ?? orderStore!

  // 결제의 storeId 가 없거나 다르면 거부
  const paymentStoreId =
    typeof payment.storeId === 'string' && payment.storeId.trim().length > 0
      ? payment.storeId.trim()
      : undefined

  if (!paymentStoreId || paymentStoreId !== targetStoreId) {
    return Object.freeze({
      ok: false,
      reason: 'STORE_ID_MISMATCH',
      message: '결제 상점 식별자가 일치하지 않거나 누락되었습니다.',
    })
  }

  return Object.freeze({ ok: true })
}

function resolveTargetStatus(
  event: SubscriptionOrderEvent
): SubscriptionOrderStatus {
  if (typeof event === 'object' && event !== null && 'type' in event && typeof event.type === 'string') {
    return resolveTargetStatus(event.type as SubscriptionOrderEvent)
  }

  if (typeof event !== 'string') {
    throw new InvalidOrderTransitionError(
      `유효하지 않은 주문 이벤트 형식입니다: ${String(event)}`,
      'created'
    )
  }

  const normalized = event.trim().toUpperCase()

  switch (normalized) {
    case 'START_PAYMENT':
    case 'PAYMENT_PENDING':
    case 'PAYMENT_REQUESTED':
      return 'payment_pending'
    case 'PAYMENT_COMPLETED':
    case 'PAY_SUCCESS':
    case 'PAYMENT_SUCCESS':
    case 'PAID':
      return 'paid'
    case 'PAYMENT_FAILED':
    case 'PAY_FAIL':
    case 'FAILED':
      return 'failed'
    case 'CANCEL':
    case 'CANCELLED':
      return 'cancelled'
    default: {
      const lower = event.trim().toLowerCase()
      if (
        lower === 'created' ||
        lower === 'payment_pending' ||
        lower === 'paid' ||
        lower === 'cancelled' ||
        lower === 'failed'
      ) {
        return lower as SubscriptionOrderStatus
      }
      throw new InvalidOrderTransitionError(
        `알 수 없는 주문 전이 이벤트입니다: ${event}`,
        'created'
      )
    }
  }
}

/**
 * 상태 전이가 가능한지 여부를 반환하는 순수 판별 함수.
 */
export function canTransitionOrder(
  currentStatus: SubscriptionOrderStatus,
  event: SubscriptionOrderEvent
): boolean {
  try {
    const targetStatus = resolveTargetStatus(event)
    if (currentStatus === targetStatus) {
      return false
    }
    const allowed = VALID_SUBSCRIPTION_ORDER_TRANSITIONS[currentStatus]
    return Boolean(allowed && allowed.includes(targetStatus))
  } catch {
    return false
  }
}

/**
 * 터미널(종료) 상태인지 여부를 반환한다.
 */
export function isTerminalOrderStatus(status: SubscriptionOrderStatus): boolean {
  const allowed = VALID_SUBSCRIPTION_ORDER_TRANSITIONS[status]
  return !allowed || allowed.length === 0
}

/**
 * 주문 상태를 전이시킨다 (순수 상태기계).
 * 역행(backward) 및 동일 상태 중복(duplicate) 전이를 엄격히 거부한다.
 */
export function transitionOrder(
  currentStatus: SubscriptionOrderStatus,
  event: SubscriptionOrderEvent
): SubscriptionOrderStatus {
  const targetStatus = resolveTargetStatus(event)

  if (currentStatus === targetStatus) {
    throw new InvalidOrderTransitionError(
      `중복 전이는 허용되지 않습니다: '${currentStatus}' -> '${targetStatus}'`,
      currentStatus,
      targetStatus
    )
  }

  const allowed = VALID_SUBSCRIPTION_ORDER_TRANSITIONS[currentStatus]
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new InvalidOrderTransitionError(
      `역행 또는 허용되지 않는 주문 상태 전이입니다: '${currentStatus}' -> '${targetStatus}'`,
      currentStatus,
      targetStatus
    )
  }

  return targetStatus
}
