import { z } from 'zod'

export type SubscriptionConsentKind =
  | 'terms'
  | 'privacy'
  | 'refund_auto_renewal'
  | 'marketing'

export type SubscriptionConsentRecord = Readonly<{
  kind: SubscriptionConsentKind
  policyVersion: string
  acceptedAt: string
  locale: string
}>

export class ConsentValidationError extends Error {
  public readonly issues: readonly unknown[]

  constructor(message: string, issues: readonly unknown[] = []) {
    super(message)
    this.name = 'ConsentValidationError'
    this.issues = issues
  }
}

const acceptedSchema = z
  .object({
    terms: z.literal(true, {
      message: '이용약관 동의(terms)는 필수입니다.',
    }),
    privacy: z.literal(true, {
      message: '개인정보 처리방침 동의(privacy)는 필수입니다.',
    }),
    refund_auto_renewal: z.literal(true, {
      message: '환불 및 자동갱신 정책 동의(refund_auto_renewal)는 필수입니다.',
    }),
    marketing: z.boolean().optional(),
  })
  .strict()

const acceptedAtSchema = z.union([
  z.string().refine(
    (val) => {
      if (typeof val !== 'string' || val.trim().length === 0) return false
      const d = new Date(val)
      return !Number.isNaN(d.getTime())
    },
    { message: '유효한 ISO 시각 문자열이어야 합니다.' }
  ),
  z.date().refine((d) => !Number.isNaN(d.getTime()), {
    message: '유효한 Date 객체여야 합니다.',
  }),
])

const buildConsentInputSchema = z
  .object({
    accepted: acceptedSchema,
    policyVersion: z.string().trim().min(1, '정책 버전(policyVersion)은 필수입니다.'),
    acceptedAt: acceptedAtSchema,
    locale: z.string().trim().min(1).default('ko'),
  })
  .strict()

export type BuildConsentInput = z.input<typeof buildConsentInputSchema>

const MANDATORY_KINDS: readonly SubscriptionConsentKind[] = Object.freeze([
  'terms',
  'privacy',
  'refund_auto_renewal',
])

/**
 * 구독 주문 전 필수 동의 3종과 선택 마케팅 동의를 검증하고 동의 레코드를 생성한다.
 *
 * 제약:
 * - 순수 함수 (I/O 없음, Date/Math.random 직접 호출 없음)
 * - terms / privacy / refund_auto_renewal 필수 3종 중 누락 또는 false 시 거부
 * - allAgreed 등 번들 키 입력은 strict 스키마로 거부
 * - 개인정보 및 IP 주소 저장 필드 일절 없음
 */
export function buildConsentRecords(
  input: BuildConsentInput
): readonly SubscriptionConsentRecord[] {
  const parseResult = buildConsentInputSchema.safeParse(input)

  if (!parseResult.success) {
    const firstErrorMessage =
      parseResult.error.issues[0]?.message ?? '동의 입력 검증에 실패했습니다.'
    throw new ConsentValidationError(firstErrorMessage, parseResult.error.issues)
  }

  const { accepted, policyVersion, acceptedAt, locale } = parseResult.data

  const canonicalAcceptedAt =
    typeof acceptedAt === 'string'
      ? new Date(acceptedAt).toISOString()
      : acceptedAt.toISOString()

  const records: SubscriptionConsentRecord[] = MANDATORY_KINDS.map((kind) =>
    Object.freeze({
      kind,
      policyVersion,
      acceptedAt: canonicalAcceptedAt,
      locale,
    })
  )

  if (accepted.marketing === true) {
    records.push(
      Object.freeze({
        kind: 'marketing',
        policyVersion,
        acceptedAt: canonicalAcceptedAt,
        locale,
      })
    )
  }

  return Object.freeze(records)
}

export type BuildConsentResult =
  | { success: true; data: readonly SubscriptionConsentRecord[] }
  | { success: false; error: ConsentValidationError }

/**
 * 예외를 던지지 않는 안전한 동의 레코드 생성 함수
 */
export function safeBuildConsentRecords(input: unknown): BuildConsentResult {
  try {
    const records = buildConsentRecords(input as BuildConsentInput)
    return { success: true, data: records }
  } catch (error) {
    if (error instanceof ConsentValidationError) {
      return { success: false, error }
    }
    return {
      success: false,
      error: new ConsentValidationError(
        error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      ),
    }
  }
}
