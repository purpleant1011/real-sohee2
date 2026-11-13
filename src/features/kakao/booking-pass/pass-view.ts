import {
  verifyPassToken,
  type VerifyPassTokenFailureReason,
} from './pass-token'
import { maskCustomerName } from '../notify/booking-notification-mapper'

export type BookingPassViewData = Readonly<{
  bookingId: string
  bookingNumber?: string
  workspaceId: string
  status: string
  statusLabel: string
  shopName: string
  address?: string
  customerNameMasked?: string
  customerPhoneMasked?: string
  serviceName?: string
  startsAt: string
  paymentSummary?: string
  cancelReason?: string
  naverMapUrl?: string
  kakaoChannelChatUrl?: string
  requiresReauth?: boolean
}>

export type ResolveBookingPassFailureReason =
  | VerifyPassTokenFailureReason
  | 'not_found'
  | 'db_error'

export type ResolveBookingPassResult =
  | Readonly<{ ok: true; pass: BookingPassViewData }>
  | Readonly<{ ok: false; reason: ResolveBookingPassFailureReason; error: string }>

export type ResolveBookingPassOptions = Readonly<{
  now?: Date | number
  verified?: boolean
}>

/**
 * 전화번호 가운데 자리 마스킹
 * 010-1234-5678 -> 010-****-5678
 * 010-123-4567  -> 010-***-4567
 * 02-1234-5678  -> 02-****-5678
 */
export function maskCustomerPhone(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') {
    return ''
  }
  const clean = phone.trim()
  if (!clean) {
    return ''
  }

  // 표준 하이픈 포맷인 경우 (010-xxxx-xxxx 또는 02-xxxx-xxxx)
  const hyphenParts = clean.split('-')
  if (hyphenParts.length === 3) {
    const [p1, p2, p3] = hyphenParts
    return `${p1}-${'*'.repeat(p2.length)}-${p3}`
  }

  // 하이픈 없는 숫자만 있는 경우
  const digits = clean.replace(/\D/gu, '')
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    if (digits.startsWith('02')) {
      return `${digits.slice(0, 2)}-****-${digits.slice(6)}`
    }
    return `${digits.slice(0, 3)}-***-${digits.slice(6)}`
  }

  // 그 외 규격 외 번호는 뒤 4자리 앞을 마스킹
  if (digits.length >= 7) {
    const tail = digits.slice(-4)
    const head = digits.slice(0, Math.min(3, digits.length - 4))
    const midCount = digits.length - head.length - 4
    return `${head}-${'*'.repeat(midCount)}-${tail}`
  }

  return '*'.repeat(clean.length)
}

function resolveStatusLabel(status: string): string {
  const normalized = status.toUpperCase().trim()
  switch (normalized) {
    case 'CONFIRMED':
      return '예약 확정'
    case 'CANCELLED':
      return '예약 취소'
    case 'PENDING':
      return '예약 대기'
    default:
      return status || '예약 완료'
  }
}

export function resolvePaymentText(
  status: string,
  depositKrw?: number,
  totalAmountKrw?: number,
  paymentStatus?: string | null,
): string {
  const isCancelled = status.toUpperCase().trim() === 'CANCELLED'
  const deposit = typeof depositKrw === 'number' && depositKrw > 0 ? depositKrw : 0
  const total = typeof totalAmountKrw === 'number' && totalAmountKrw > 0 ? totalAmountKrw : 0
  const normalizedPaymentStatus = paymentStatus ? paymentStatus.toUpperCase().trim() : null
  const isPaid = normalizedPaymentStatus === 'PAID' || normalizedPaymentStatus === 'COMPLETED'

  if (isCancelled) {
    if (deposit > 0) {
      if (isPaid) {
        return `예약금 ${deposit.toLocaleString()}원 환불 처리 진행`
      }
      return `예약금 안내 (${deposit.toLocaleString()}원, 결제 여부 매장 문의)`
    }
    return '결제 내역 없음'
  }

  // Active / Confirmed / Pending
  if (deposit > 0) {
    if (isPaid) {
      const remaining = total > deposit ? ` (잔여 현장 결제 ${(total - deposit).toLocaleString()}원)` : ''
      return `예약금 ${deposit.toLocaleString()}원 결제 완료${remaining}`
    }
    const remaining = total > deposit ? ` (총 예상 금액 ${total.toLocaleString()}원)` : ''
    return `예약금 안내: ${deposit.toLocaleString()}원${remaining}`
  }

  if (total > 0) {
    if (isPaid) {
      return `결제 완료 (${total.toLocaleString()}원)`
    }
    return `현장 결제 예정 (${total.toLocaleString()}원)`
  }

  return '현장 결제 예정'
}

type QueryResult<T> = {
  data: T | null
  error: unknown
}

interface DbClientLike {
  from(table: string): {
    select(columns: string): {
      eq(col1: string, val1: string): {
        eq(col2: string, val2: string): {
          maybeSingle(): PromiseLike<QueryResult<Record<string, unknown>>>
        }
        maybeSingle?(): PromiseLike<QueryResult<Record<string, unknown>>>
      }
    }
  }
}

/**
 * 고객 모바일 예약패스 데이터 해석 함수
 * 1. pass-token 서명 및 만료 검증
 * 2. reservations 테이블에서 해당 테넌트/예약 단건 조회
 * 3. business_profiles 테이블에서 매장명 및 주소 안전 병합
 * 4. PII(이름, 연락처) 마스킹 후 BookingPassViewData 반환
 */
export async function resolveBookingPass(
  token: string,
  secret: string,
  dbClient: DbClientLike | unknown,
  options?: ResolveBookingPassOptions,
): Promise<ResolveBookingPassResult> {
  const tokenVerify = await verifyPassToken(token, {
    secret,
    now: options?.now,
  })

  if (!tokenVerify.ok) {
    const errorMap: Record<VerifyPassTokenFailureReason, string> = {
      expired: '만료된 예약패스입니다.',
      tampered: '위조되거나 유효하지 않은 예약패스입니다.',
      tenant_mismatch: '접근 권한이 없는 예약패스입니다.',
      malformed: '잘못된 형식의 예약패스입니다.',
    }
    return {
      ok: false,
      reason: tokenVerify.reason,
      error: errorMap[tokenVerify.reason] || '유효하지 않은 예약패스입니다.',
    }
  }

  const { workspaceId, bookingId } = tokenVerify.payload
  const client = dbClient as DbClientLike

  let resData: Record<string, unknown> | null = null
  try {
    const reservationRes = await client
      .from('reservations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', bookingId)
      .maybeSingle()

    if (reservationRes.error) {
      return {
        ok: false,
        reason: 'db_error',
        error: '예약 정보를 불러오지 못했습니다.',
      }
    }
    resData = reservationRes.data
  } catch {
    return {
      ok: false,
      reason: 'db_error',
      error: '예약 정보를 불러오지 못했습니다.',
    }
  }

  if (!resData) {
    return {
      ok: false,
      reason: 'not_found',
      error: '예약 정보를 찾을 수 없습니다.',
    }
  }

  // 매장 프로필 조회 (fallback 허용)
  let profileData: Record<string, unknown> | null = null
  try {
    const profileRes = await client
      .from('business_profiles')
      .select('business_name, address, location, contact_phone')
      .eq('workspace_id', workspaceId)
      .maybeSingle?.()

    if (profileRes && !profileRes.error) {
      profileData = profileRes.data
    }
  } catch {
    // 매장 프로필 조회 실패 시 안전 fallback 유지
    profileData = null
  }

  const shopName =
    typeof profileData?.business_name === 'string' && profileData.business_name.trim()
      ? profileData.business_name.trim()
      : '매장 안내'

  const address =
    typeof profileData?.address === 'string' && profileData.address.trim()
      ? profileData.address.trim()
      : typeof profileData?.location === 'string' && profileData.location.trim()
        ? profileData.location.trim()
        : undefined

  const customerName = typeof resData.customer_name === 'string' ? resData.customer_name : ''
  const customerPhone = typeof resData.customer_phone === 'string' ? resData.customer_phone : ''
  const serviceName = typeof resData.service_name === 'string' ? resData.service_name : '예약 서비스'
  const status = typeof resData.status === 'string' ? resData.status : 'CONFIRMED'
  const statusLabel = resolveStatusLabel(status)

  const metadata = (resData.metadata as Record<string, unknown> | undefined) ?? {}
  const startsAt =
    typeof metadata.startsAt === 'string' && metadata.startsAt.trim()
      ? metadata.startsAt.trim()
      : typeof metadata.starts_at === 'string' && metadata.starts_at.trim()
        ? metadata.starts_at.trim()
        : typeof resData.confirmed_at === 'string' && resData.confirmed_at.trim()
          ? resData.confirmed_at.trim()
          : typeof resData.created_at === 'string' && resData.created_at.trim()
            ? resData.created_at.trim()
            : '일정 확인 필요'

  const bookingNumber =
    typeof metadata.bookingNumber === 'string'
      ? metadata.bookingNumber
      : typeof resData.id === 'string'
        ? resData.id
        : undefined

  const isLocked = tokenVerify.payload.requiresReauth === true && options?.verified !== true

  if (isLocked) {
    const pass: BookingPassViewData = Object.freeze({
      bookingId,
      bookingNumber,
      workspaceId,
      status,
      statusLabel,
      shopName,
      startsAt,
      requiresReauth: true,
    })

    return {
      ok: true,
      pass,
    }
  }

  const depositKrw = typeof resData.deposit_krw === 'number' ? resData.deposit_krw : 0
  const totalAmountKrw = typeof resData.total_amount_krw === 'number' ? resData.total_amount_krw : 0
  const paymentStatus =
    typeof resData.payment_status === 'string'
      ? resData.payment_status
      : typeof (metadata as Record<string, unknown>).payment_status === 'string'
        ? String((metadata as Record<string, unknown>).payment_status)
        : null

  const paymentSummary = resolvePaymentText(status, depositKrw, totalAmountKrw, paymentStatus)

  const cancelReason =
    typeof resData.cancel_reason === 'string' && resData.cancel_reason.trim()
      ? resData.cancel_reason.trim()
      : undefined

  const naverMapUrl = address || (shopName && shopName !== '매장 안내')
    ? `https://map.naver.com/p/search/${encodeURIComponent(address || shopName)}`
    : undefined

  const pass: BookingPassViewData = Object.freeze({
    bookingId,
    bookingNumber,
    workspaceId,
    status,
    statusLabel,
    shopName,
    address,
    customerNameMasked: maskCustomerName(customerName),
    customerPhoneMasked: maskCustomerPhone(customerPhone),
    serviceName,
    startsAt,
    paymentSummary,
    cancelReason,
    naverMapUrl,
    requiresReauth: false,
  })

  return {
    ok: true,
    pass,
  }
}
