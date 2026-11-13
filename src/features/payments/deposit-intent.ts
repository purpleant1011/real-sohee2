import { z } from 'zod'

const ref = z.string().trim().min(1).max(200)
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime({ offset: true })
const bookingSchema = z.object({
  workspaceId: ref, bookingId: ref, customerId: ref, version: z.number().int().positive(),
  serviceVersion: ref, status: z.literal('CONFIRMED'), totalServicePriceKrw: money,
})
const requestSchema = z.object({
  workspaceId: ref, bookingId: ref, bookingVersion: z.number().int().positive(), serviceVersion: ref,
  policy: z.enum(['NONE', 'OPTIONAL', 'REQUIRED']).default('NONE'), selected: z.boolean().default(false),
  ownerConfirmed: z.boolean().optional(), depositAmountKrw: money.optional(),
  refundRuleVersion: ref.optional(), cancellationTerms: z.string().trim().min(1).max(2000).optional(),
  merchantRef: ref.optional(), settlementActor: z.literal('SHOP').optional(),
  expiresAt: timestamp.optional(), idempotencyKey: ref.optional(),
}).strict()

export type DepositSnapshot = Readonly<{
  workspaceId: string; bookingId: string; customerId: string; bookingVersion: number; serviceVersion: string
  policy: 'OPTIONAL' | 'REQUIRED'; amountKrw: number; currency: 'KRW'; totalServicePriceKrw: number
  remainingServicePriceKrw: number; refundRuleVersion: string; cancellationTerms: string
  merchantRef: string; settlementActor: 'SHOP'; expiresAt: string; idempotencyKey: string
}>
export type DepositPreparation =
  | Readonly<{ status: 'NOT_REQUIRED'; intent: null }>
  | Readonly<{ status: 'DRAFT'; intent: DepositSnapshot }>

/** Domain preparation only; this is neither a stored payment intent nor a provider request. */
export function prepareDepositIntent(input: unknown, currentBooking: unknown, now: string): DepositPreparation {
  const request = requestSchema.parse(input)
  const booking = bookingSchema.parse(currentBooking)
  const observedAt = Date.parse(timestamp.parse(now))
  if (request.workspaceId !== booking.workspaceId || request.bookingId !== booking.bookingId ||
      request.bookingVersion !== booking.version || request.serviceVersion !== booking.serviceVersion) {
    throw new Error('DEPOSIT_BOOKING_MISMATCH')
  }
  if (request.policy === 'NONE' || (request.policy === 'OPTIONAL' && !request.selected)) {
    return Object.freeze({ status: 'NOT_REQUIRED', intent: null })
  }
  if (!request.ownerConfirmed || !request.depositAmountKrw || request.depositAmountKrw > booking.totalServicePriceKrw ||
      !request.refundRuleVersion || !request.cancellationTerms || !request.merchantRef || request.settlementActor !== 'SHOP' ||
      !request.expiresAt || Date.parse(request.expiresAt) <= observedAt || !request.idempotencyKey) {
    throw new Error('DEPOSIT_TERMS_NOT_CONFIRMED')
  }
  const intent: DepositSnapshot = Object.freeze({
    workspaceId: booking.workspaceId, bookingId: booking.bookingId, customerId: booking.customerId,
    bookingVersion: booking.version, serviceVersion: booking.serviceVersion, policy: request.policy,
    amountKrw: request.depositAmountKrw, currency: 'KRW', totalServicePriceKrw: booking.totalServicePriceKrw,
    remainingServicePriceKrw: booking.totalServicePriceKrw - request.depositAmountKrw,
    refundRuleVersion: request.refundRuleVersion, cancellationTerms: request.cancellationTerms,
    merchantRef: request.merchantRef, settlementActor: request.settlementActor,
    expiresAt: request.expiresAt, idempotencyKey: request.idempotencyKey,
  })
  return Object.freeze({ status: 'DRAFT', intent })
}
