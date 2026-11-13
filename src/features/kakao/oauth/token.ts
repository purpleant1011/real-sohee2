import type { KakaoConfig } from '../config/kakao-config'

export interface KakaoTokenResponse {
  readonly access_token: string
  readonly token_type: string
  readonly refresh_token: string
  readonly expires_in: number
  readonly scope?: string
  readonly refresh_token_expires_in?: number
  readonly id_token?: string
}

export interface KakaoUserProfile {
  readonly id: number
  readonly connected_at?: string
  readonly kakao_account?: {
    readonly email?: string
    readonly is_email_verified?: boolean
    readonly is_email_valid?: boolean
    readonly name?: string
    readonly phone_number?: string
    readonly profile?: {
      readonly nickname?: string
      readonly profile_image_url?: string
      readonly thumbnail_image_url?: string
    }
  }
}

export type ExchangeKakaoCodeResult =
  | { readonly ok: true; readonly tokens: KakaoTokenResponse }
  | { readonly ok: false; readonly error: string; readonly reason: string }

export type FetchKakaoUserProfileResult =
  | { readonly ok: true; readonly profile: KakaoUserProfile }
  | { readonly ok: false; readonly error: string; readonly reason: string }

export interface ExchangeKakaoCodeOptions {
  readonly code: string
  readonly redirectUri: string
  readonly config: KakaoConfig
  readonly fetchFn?: typeof fetch
}

export interface FetchKakaoUserProfileOptions {
  readonly accessToken: string
  readonly fetchFn?: typeof fetch
}

const KAKAO_TOKEN_ENDPOINT = 'https://kauth.kakao.com/oauth/token'
const KAKAO_USER_ME_ENDPOINT = 'https://kapi.kakao.com/v2/user/me'

/**
 * Strips secrets, tokens, and sensitive strings from error messages to prevent accidental exposure.
 */
export function sanitizeAuthErrorMessage(
  message: string,
  sensitiveValues: readonly (string | undefined | null)[],
): string {
  let sanitized = message
  for (const val of sensitiveValues) {
    if (val && typeof val === 'string' && val.trim().length > 3) {
      sanitized = sanitized.split(val).join('[REDACTED]')
    }
  }
  return sanitized
}

/**
 * Exchanges authorization code for Kakao access/refresh tokens.
 * Injected with custom fetch function for isolated unit testing.
 * Strictly redacts client secrets and tokens from error reasons.
 */
export async function exchangeKakaoCodeForToken(
  options: ExchangeKakaoCodeOptions,
): Promise<ExchangeKakaoCodeResult> {
  const { code, redirectUri, config, fetchFn = fetch } = options

  const sensitiveValues = [config.clientSecret, config.restApiKey]

  const params = new URLSearchParams()
  params.set('grant_type', 'authorization_code')
  params.set('client_id', config.restApiKey)
  params.set('redirect_uri', redirectUri)
  params.set('code', code)
  params.set('client_secret', config.clientSecret)

  try {
    const res = await fetchFn(KAKAO_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: params.toString(),
    })

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>

    if (!res.ok) {
      const errorCode = typeof data.error === 'string' ? data.error : 'token_exchange_failed'
      const errorDesc =
        typeof data.error_description === 'string'
          ? data.error_description
          : typeof data.msg === 'string'
            ? data.msg
            : 'Kakao token exchange failed'

      return {
        ok: false,
        error: errorCode,
        reason: sanitizeAuthErrorMessage(errorDesc, sensitiveValues),
      }
    }

    if (
      !data ||
      typeof data !== 'object' ||
      typeof data.access_token !== 'string' ||
      typeof data.token_type !== 'string' ||
      typeof data.refresh_token !== 'string' ||
      typeof data.expires_in !== 'number'
    ) {
      return {
        ok: false,
        error: 'invalid_token_response',
        reason: 'Malformed token payload from Kakao',
      }
    }

    const tokens: KakaoTokenResponse = Object.freeze({
      access_token: data.access_token,
      token_type: data.token_type,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
      refresh_token_expires_in:
        typeof data.refresh_token_expires_in === 'number'
          ? data.refresh_token_expires_in
          : undefined,
      id_token: typeof data.id_token === 'string' ? data.id_token : undefined,
    })

    return { ok: true, tokens }
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: 'network_error',
      reason: sanitizeAuthErrorMessage(rawMessage, sensitiveValues),
    }
  }
}

/**
 * Fetches user profile from Kakao /v2/user/me.
 * Injected with custom fetch function. Redacts access tokens on failure.
 */
export async function fetchKakaoUserProfile(
  options: FetchKakaoUserProfileOptions,
): Promise<FetchKakaoUserProfileResult> {
  const { accessToken, fetchFn = fetch } = options
  const sensitiveValues = [accessToken]

  try {
    const res = await fetchFn(KAKAO_USER_ME_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>

    if (!res.ok) {
      const rawMsg =
        typeof data.msg === 'string'
          ? data.msg
          : typeof data.error === 'string'
            ? data.error
            : 'Kakao user profile fetch failed'
      return {
        ok: false,
        error: 'profile_fetch_failed',
        reason: sanitizeAuthErrorMessage(rawMsg, sensitiveValues),
      }
    }

    if (!data || typeof data !== 'object' || typeof data.id !== 'number') {
      return {
        ok: false,
        error: 'invalid_profile_response',
        reason: 'Malformed profile payload from Kakao',
      }
    }

    const profile: KakaoUserProfile = Object.freeze({
      id: data.id,
      connected_at: typeof data.connected_at === 'string' ? data.connected_at : undefined,
      kakao_account:
        data.kakao_account && typeof data.kakao_account === 'object'
          ? (data.kakao_account as KakaoUserProfile['kakao_account'])
          : undefined,
    })

    return { ok: true, profile }
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: 'network_error',
      reason: sanitizeAuthErrorMessage(rawMessage, sensitiveValues),
    }
  }
}
