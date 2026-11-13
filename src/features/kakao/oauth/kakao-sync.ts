import { resolveCanonicalCustomer } from '@/features/customers/canonical-customer'
import type { KakaoUserProfile } from './token'

export interface KakaoSyncPhone {
  readonly phone010: string
  readonly phoneE164: string
}

export interface KakaoSyncCustomer {
  readonly kakaoUserId: string
  readonly name: string
  readonly phone010: string
  readonly phoneE164: string
}

export interface ProcessKakaoSyncBookingPipelineParams {
  readonly admin: any
  readonly workspaceId: string
  readonly profile: KakaoUserProfile
  readonly serviceName?: string
  readonly serviceId?: string
  readonly desiredStartsAt?: string
  readonly slotId?: string
  readonly totalAmountKrw?: number
  readonly metadata?: Record<string, unknown>
}

export type ProcessKakaoSyncBookingPipelineResult =
  | {
      readonly ok: true
      readonly customerUuid: string | null
      readonly reservationId: string
      readonly customer: KakaoSyncCustomer
    }
  | {
      readonly ok: false
      readonly reason: 'invalid_kakao_profile' | 'reservation_creation_failed' | 'invalid_workspace_id'
    }

/**
 * Parses raw phone numbers from Kakao Sync into normalized 11-digit 010 and E.164 formats.
 * Accepts formats: '+82 10-1234-5678', '+82 10 1234 5678', '+821012345678', '010-1234-5678', '01012345678'.
 * Fails-closed (returns null) for any non-010, landline, international, or malformed input.
 */
export function parseKakaoSyncPhone(
  rawPhone: string | undefined | null,
): KakaoSyncPhone | null {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return null
  }

  const cleaned = rawPhone.replace(/[\s\-().]/g, '')
  if (!cleaned) {
    return null
  }

  let phone010: string | null = null

  if (cleaned.startsWith('+82')) {
    const national = cleaned.slice(3)
    if (national.startsWith('10') && national.length === 10 && /^\d+$/.test(national)) {
      phone010 = `0${national}`
    } else if (national.startsWith('010') && national.length === 11 && /^\d+$/.test(national)) {
      phone010 = national
    } else {
      return null
    }
  } else if (cleaned.startsWith('82')) {
    const national = cleaned.slice(2)
    if (national.startsWith('10') && national.length === 10 && /^\d+$/.test(national)) {
      phone010 = `0${national}`
    } else if (national.startsWith('010') && national.length === 11 && /^\d+$/.test(national)) {
      phone010 = national
    } else {
      return null
    }
  } else if (cleaned.startsWith('010')) {
    if (cleaned.length === 11 && /^\d+$/.test(cleaned)) {
      phone010 = cleaned
    } else {
      return null
    }
  } else {
    return null
  }

  if (!phone010 || !/^010\d{8}$/.test(phone010)) {
    return null
  }

  const phoneE164 = `+8210${phone010.slice(3)}`

  return Object.freeze({
    phone010,
    phoneE164,
  })
}

/**
 * Extracts verified customer fields from KakaoUserProfile.
 * Returns null if Kakao ID, display name/nickname, or valid 010 phone is missing (Fail-Closed).
 */
export function extractKakaoSyncCustomer(
  profile: KakaoUserProfile,
): KakaoSyncCustomer | null {
  if (!profile || typeof profile !== 'object') {
    return null
  }

  if (
    typeof profile.id !== 'number' ||
    !Number.isFinite(profile.id) ||
    profile.id <= 0
  ) {
    return null
  }

  const account = profile.kakao_account
  if (!account || typeof account !== 'object') {
    return null
  }

  const rawName =
    typeof account.name === 'string' && account.name.trim().length > 0
      ? account.name.trim()
      : typeof account.profile?.nickname === 'string' &&
          account.profile.nickname.trim().length > 0
        ? account.profile.nickname.trim()
        : null

  if (!rawName) {
    return null
  }

  const parsedPhone = parseKakaoSyncPhone(account.phone_number)
  if (!parsedPhone) {
    return null
  }

  return Object.freeze({
    kakaoUserId: String(profile.id),
    name: rawName,
    phone010: parsedPhone.phone010,
    phoneE164: parsedPhone.phoneE164,
  })
}

/**
 * Executes one-click Kakao Sync reservation pipeline:
 * 1. Validates and extracts verified Kakao customer profile.
 * 2. Resolves canonical customer record (public.customers) via upsert_customer_by_phone RPC.
 * 3. Associates Kakao identity in public.customer_identities (channel: 'KAKAO').
 * 4. Persists atomic reservation in public.reservations (channel_source: 'KAKAO_SYNC', status: 'AWAITING_CONFIRMATION').
 */
export async function processKakaoSyncBookingPipeline(
  params: ProcessKakaoSyncBookingPipelineParams,
): Promise<ProcessKakaoSyncBookingPipelineResult> {
  const {
    admin,
    workspaceId,
    profile,
    serviceName,
    serviceId,
    desiredStartsAt,
    slotId,
    totalAmountKrw,
    metadata,
  } = params

  const trimmedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : ''
  if (!trimmedWorkspaceId) {
    return { ok: false, reason: 'invalid_workspace_id' }
  }

  const customer = extractKakaoSyncCustomer(profile)
  if (!customer) {
    return { ok: false, reason: 'invalid_kakao_profile' }
  }

  let customerUuid: string | null = null
  try {
    const canonicalResult = await resolveCanonicalCustomer({
      admin,
      workspaceId: trimmedWorkspaceId,
      displayName: customer.name,
      phone010: customer.phone010,
    })
    customerUuid = canonicalResult.customerUuid
  } catch {
    customerUuid = null
  }

  // If customer record was created/found, link Kakao identity
  if (customerUuid && admin?.from) {
    try {
      await admin.from('customer_identities').upsert(
        {
          workspace_id: trimmedWorkspaceId,
          customer_id: customerUuid,
          channel: 'KAKAO',
          subject_ref: customer.kakaoUserId,
        },
        { onConflict: 'workspace_id,channel,subject_ref' },
      )
    } catch {
      // Identity linking failure should not abort booking creation
    }
  }

  const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const nowIso = new Date().toISOString()

  try {
    const { error } = await admin.from('reservations').insert({
      id: reservationId,
      workspace_id: trimmedWorkspaceId,
      customer_uuid: customerUuid,
      customer_id: `kakao_${customer.kakaoUserId}`,
      customer_name: customer.name,
      customer_phone: customer.phone010,
      service_id: serviceId ?? 'srv_custom',
      service_name: serviceName ?? '카카오 1초 간편 예약',
      status: 'AWAITING_CONFIRMATION',
      channel_source: 'KAKAO_SYNC',
      slot_id: slotId ?? `slot_sync_${Date.now()}`,
      deposit_krw: 0,
      total_amount_krw: totalAmountKrw ?? 0,
      metadata: {
        source: 'kakao_sync',
        kakaoUserId: customer.kakaoUserId,
        desiredStartsAt: desiredStartsAt ?? null,
        ...(metadata ?? {}),
      },
      created_at: nowIso,
      updated_at: nowIso,
    })

    if (error) {
      return { ok: false, reason: 'reservation_creation_failed' }
    }

    return {
      ok: true,
      customerUuid,
      reservationId,
      customer,
    }
  } catch {
    return { ok: false, reason: 'reservation_creation_failed' }
  }
}
