import type { KakaoUnlinkPayload, KakaoUnlinkReferrerType } from './types'

export type ParseKakaoUnlinkResult =
  | { readonly ok: true; readonly payload: KakaoUnlinkPayload }
  | { readonly ok: false; readonly error: string }

/**
 * Masks user identifier to prevent PII leakage in logs.
 * Example: '1234567890' -> '12******90'
 */
export function maskUserId(userId: string): string {
  if (!userId || typeof userId !== 'string') {
    return '***'
  }
  const len = userId.length
  if (len <= 2) {
    return '**'
  }
  if (len <= 4) {
    return `${userId[0]}**${userId[len - 1]}`
  }
  const prefix = userId.slice(0, 2)
  const suffix = userId.slice(-2)
  const maskedLength = Math.max(2, len - 4)
  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`
}

/**
 * Strips raw PII and returns a sanitized representation of the payload safe for logging.
 */
export function sanitizePayloadForLogging(payload: KakaoUnlinkPayload): Record<string, unknown> {
  return {
    appId: payload.appId,
    referrerType: payload.referrerType,
    userIdMasked: maskUserId(payload.userId),
    hasGroupUserToken: Boolean(payload.groupUserToken),
  }
}

/**
 * Parses and validates Kakao Unlink webhook payload from JSON object or URLSearchParams.
 */
export function parseKakaoUnlinkPayload(data: unknown): ParseKakaoUnlinkResult {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Payload must be an object or form data' }
  }

  let appIdRaw: unknown
  let userIdRaw: unknown
  let referrerTypeRaw: unknown
  let groupUserTokenRaw: unknown

  if (data instanceof URLSearchParams) {
    appIdRaw = data.get('app_id') ?? data.get('appId')
    userIdRaw = data.get('user_id') ?? data.get('userId')
    referrerTypeRaw = data.get('referrer_type') ?? data.get('referrerType')
    groupUserTokenRaw = data.get('group_user_token') ?? data.get('groupUserToken')
  } else {
    const record = data as Record<string, unknown>
    appIdRaw = record.app_id ?? record.appId
    userIdRaw = record.user_id ?? record.userId
    referrerTypeRaw = record.referrer_type ?? record.referrerType
    groupUserTokenRaw = record.group_user_token ?? record.groupUserToken
  }

  if (appIdRaw === undefined || appIdRaw === null || String(appIdRaw).trim().length === 0) {
    return { ok: false, error: 'Missing required field: app_id' }
  }

  if (userIdRaw === undefined || userIdRaw === null || String(userIdRaw).trim().length === 0) {
    return { ok: false, error: 'Missing required field: user_id' }
  }

  if (
    referrerTypeRaw === undefined ||
    referrerTypeRaw === null ||
    String(referrerTypeRaw).trim().length === 0
  ) {
    return { ok: false, error: 'Missing required field: referrer_type' }
  }

  const appId = String(appIdRaw).trim()
  const userId = String(userIdRaw).trim()
  const referrerType = String(referrerTypeRaw).trim() as KakaoUnlinkReferrerType
  const groupUserToken =
    groupUserTokenRaw !== undefined && groupUserTokenRaw !== null
      ? String(groupUserTokenRaw).trim() || undefined
      : undefined

  return {
    ok: true,
    payload: {
      appId,
      userId,
      referrerType,
      groupUserToken,
    },
  }
}
