import { z } from 'zod'

/**
 * ANI-1609 — owner-entered service catalog (`workspace_products_services`).
 * Every optional fact stays `null` until the owner types it; nothing here ever invents a value.
 */

const MAX_PRICE_KRW = 100_000_000
const OFFSET_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value),
    z.string().max(max).nullable(),
  )

const priceField = z.number().int().min(0).max(MAX_PRICE_KRW).nullable()
const durationField = z.number().int().min(1).max(1440).nullable()
const dateTimeField = z.string().regex(OFFSET_DATETIME, '시간대가 포함된 날짜·시간이어야 합니다.').refine(
  (value) => Number.isFinite(Date.parse(value)),
  '올바른 날짜·시간이 아닙니다.',
).nullable()
const nameField = z.string().trim().min(1, '서비스명을 입력해 주세요.').max(100, '서비스명은 100자 이내로 입력해 주세요.')

const catalogFields = {
  name: nameField,
  price: priceField,
  durationMinutes: durationField,
  resourceName: optionalText(100),
  cancellationPolicy: optionalText(500),
  validFrom: dateTimeField,
  validUntil: dateTimeField,
  active: z.boolean(),
}

function validityOrdered(value: { validFrom?: string | null; validUntil?: string | null }): boolean {
  if (!value.validFrom || !value.validUntil) return true
  return Date.parse(value.validUntil) > Date.parse(value.validFrom)
}
const VALIDITY_MESSAGE = '유효기간 종료는 시작보다 뒤여야 합니다.'

export const catalogServiceCreateSchema = z
  .object({
    name: catalogFields.name,
    price: catalogFields.price.default(null),
    durationMinutes: catalogFields.durationMinutes.default(null),
    resourceName: catalogFields.resourceName.default(null),
    cancellationPolicy: catalogFields.cancellationPolicy.default(null),
    validFrom: catalogFields.validFrom.default(null),
    validUntil: catalogFields.validUntil.default(null),
    active: catalogFields.active.default(true),
  })
  .strict()
  .refine(validityOrdered, { message: VALIDITY_MESSAGE, path: ['validUntil'] })

export const catalogServiceUpdateSchema = z
  .object({
    expectedUpdatedAt: z.string().regex(OFFSET_DATETIME),
    name: catalogFields.name.optional(),
    price: catalogFields.price.optional(),
    durationMinutes: catalogFields.durationMinutes.optional(),
    resourceName: catalogFields.resourceName.optional(),
    cancellationPolicy: catalogFields.cancellationPolicy.optional(),
    validFrom: catalogFields.validFrom.optional(),
    validUntil: catalogFields.validUntil.optional(),
    active: catalogFields.active.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'expectedUpdatedAt'), {
    message: '변경할 내용을 입력해 주세요.',
  })
  .refine(validityOrdered, { message: VALIDITY_MESSAGE, path: ['validUntil'] })

export type CatalogServiceCreateInput = z.infer<typeof catalogServiceCreateSchema>
export type CatalogServiceUpdateInput = z.infer<typeof catalogServiceUpdateSchema>

export interface CatalogServiceRecord {
  id: string
  workspaceId: string
  name: string
  price: number | null
  durationMinutes: number | null
  resourceName: string | null
  cancellationPolicy: string | null
  validFrom: string | null
  validUntil: string | null
  active: boolean
  /** Doubles as the catalog version bound into booking slots (`catalog_version`). */
  updatedAt: string
  knowledgeFactId: string | null
}

export type ReadinessGap = 'PRICE' | 'DURATION' | 'INACTIVE' | 'EXPIRED' | 'NOT_STARTED'

/** Mirrors what `verifyOffer` needs; a gap here means booking confirmation would fail closed. */
export function bookingReadiness(
  service: CatalogServiceRecord,
  nowIso: string,
): { ready: boolean; missing: ReadinessGap[] } {
  const missing: ReadinessGap[] = []
  const now = Date.parse(nowIso)
  if (!service.active) missing.push('INACTIVE')
  if (service.price === null || !Number.isSafeInteger(service.price) || service.price < 0) missing.push('PRICE')
  if (service.durationMinutes === null || !Number.isSafeInteger(service.durationMinutes) || service.durationMinutes <= 0) {
    missing.push('DURATION')
  }
  if (service.validUntil && Date.parse(service.validUntil) <= now) missing.push('EXPIRED')
  if (service.validFrom && Date.parse(service.validFrom) > now) missing.push('NOT_STARTED')
  return { ready: missing.length === 0, missing }
}

export const READINESS_LABELS: Record<ReadinessGap, string> = {
  PRICE: '가격을 입력해야 예약 확정에 쓸 수 있어요',
  DURATION: '소요시간을 입력해야 예약 확정에 쓸 수 있어요',
  INACTIVE: '사용 중지된 서비스예요',
  EXPIRED: '유효기간이 끝났어요',
  NOT_STARTED: '아직 적용 시작 전이에요',
}
