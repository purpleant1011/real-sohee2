export type ServiceErrorCode =
  | 'CREDIT_INSUFFICIENT'
  | 'CREDIT_RESERVATION_STALE'
  | 'PLAN_VERSION_CONFLICT'
  | 'CHECKOUT_PROVIDER_PENDING'
  | 'CREDIT_FORBIDDEN'
  | 'CREDIT_RPC_FAILED'
  | 'PLAN_RPC_FAILED'
  | 'CHECKOUT_RPC_FAILED'

export type ServiceResult<T> =
  | Readonly<{ data: T; error?: never }>
  | Readonly<{ data?: never; error: Readonly<{ code: ServiceErrorCode }> }>

const safeCodes = new Set<ServiceErrorCode>([
  'CREDIT_INSUFFICIENT',
  'CREDIT_RESERVATION_STALE',
  'PLAN_VERSION_CONFLICT',
  'CHECKOUT_PROVIDER_PENDING',
  'CREDIT_FORBIDDEN',
])

export function toSafeServiceError(error: unknown, fallback: Extract<ServiceErrorCode, `${string}_RPC_FAILED`>): ServiceResult<never> {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : ''
  const code = [...safeCodes].find((candidate) => message.includes(candidate))
  return { error: { code: code ?? fallback } }
}
