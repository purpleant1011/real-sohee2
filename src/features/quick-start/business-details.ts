import { z } from 'zod'
import { normalizeBusinessNumber, validateBusinessNumberChecksum } from '@/lib/auth/business-verification'

/**
 * 가입 첫 화면('우리 가게')에서 사장님이 **직접 입력**하는 사업자·운영 정보.
 *
 * 네이버 플레이스 링크가 없는 매장도 시작할 수 있도록 만든 자가 입력 통로다.
 * 여기 값은 국세청 검증·운영팀 승인을 거치지 않았으므로 절대 "인증됨"으로
 * 표시하지 않는다. 검증된 정본은 business_verifications 이다.
 */

const optionalText = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim())
    .refine((value) => value.length <= max, { message: `최대 ${max}자까지 입력할 수 있어요.` })
    .optional()
    .default('')

const optionalDigits = (length: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/[^0-9]/gu, ''))
    .refine((value) => value.length === 0 || value.length === length, {
      message: `${label}은(는) ${length}자리 숫자로 입력해 주세요.`,
    })
    .optional()
    .default('')

const optionalUrl = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length === 0 || /^https?:\/\/\S+$/iu.test(value), {
    message: 'http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.',
  })
  .refine((value) => value.length <= 300, { message: '주소는 300자 이내로 입력해 주세요.' })
  .optional()
  .default('')

export const businessDetailsSchema = z
  .object({
    businessNumber: optionalDigits(10, '사업자등록번호'),
    representativeName: optionalText(60),
    businessStartDate: optionalDigits(8, '개업일자'),
    businessType: optionalText(60),
    businessItem: optionalText(60),
    phone: optionalText(30),
    businessHours: optionalText(120),
    closedDays: optionalText(60),
    parkingInfo: optionalText(120),
    reservationMethod: optionalText(120),
    websiteUrl: optionalUrl,
    priceRange: optionalText(60),
    naverPlaceUrl: optionalUrl,
    intakeSource: z.enum(['manual', 'naver_sync']).optional().default('manual'),
  })
  .superRefine((value, ctx) => {
    // 사업자등록번호는 형식(체크섬)이 틀리면 저장하지 않는다. 비워두는 것은 허용.
    if (value.businessNumber.length === 10 && !validateBusinessNumberChecksum(value.businessNumber)) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessNumber'],
        message: '사업자등록번호 형식이 올바르지 않아요. 사업자등록증의 번호를 확인해 주세요.',
      })
    }
    if (value.businessStartDate.length === 8) {
      const year = Number(value.businessStartDate.slice(0, 4))
      const month = Number(value.businessStartDate.slice(4, 6))
      const day = Number(value.businessStartDate.slice(6, 8))
      const valid = year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31
      if (!valid) {
        ctx.addIssue({
          code: 'custom',
          path: ['businessStartDate'],
          message: '개업일자를 YYYYMMDD 형식으로 정확히 입력해 주세요.',
        })
      }
    }
  })

export type BusinessDetailsInput = z.infer<typeof businessDetailsSchema>

export const EMPTY_BUSINESS_DETAILS: BusinessDetailsInput = {
  businessNumber: '',
  representativeName: '',
  businessStartDate: '',
  businessType: '',
  businessItem: '',
  phone: '',
  businessHours: '',
  closedDays: '',
  parkingInfo: '',
  reservationMethod: '',
  websiteUrl: '',
  priceRange: '',
  naverPlaceUrl: '',
  intakeSource: 'manual',
}

/** DB 행을 폼 상태로 되돌린다(재방문 시 자동 채움). */
export function businessDetailsFromRow(row: Record<string, unknown> | null | undefined): BusinessDetailsInput {
  if (!row) return { ...EMPTY_BUSINESS_DETAILS }
  const pick = (key: keyof BusinessDetailsInput): string => {
    const value = row[key]
    return typeof value === 'string' ? value : ''
  }
  const source = row.intakeSource ?? row.intake_source
  return {
    businessNumber: pick('businessNumber'),
    representativeName: pick('representativeName'),
    businessStartDate: pick('businessStartDate'),
    businessType: pick('businessType'),
    businessItem: pick('businessItem'),
    phone: pick('phone'),
    businessHours: pick('businessHours'),
    closedDays: pick('closedDays'),
    parkingInfo: pick('parkingInfo'),
    reservationMethod: pick('reservationMethod'),
    websiteUrl: pick('websiteUrl'),
    priceRange: pick('priceRange'),
    naverPlaceUrl: pick('naverPlaceUrl'),
    intakeSource: source === 'naver_sync' ? 'naver_sync' : 'manual',
  }
}

/** 저장된 값이 하나라도 있는지(관리자 화면에서 "입력 없음"을 구분할 때 쓴다). */
export function hasAnyBusinessDetail(value: BusinessDetailsInput | null | undefined): boolean {
  if (!value) return false
  return Object.entries(value).some(([key, entry]) => key !== 'intakeSource' && typeof entry === 'string' && entry.length > 0)
}

export { normalizeBusinessNumber }
