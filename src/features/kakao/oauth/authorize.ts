import { isAllowedRedirect, type KakaoConfig } from '../config/kakao-config'

export interface BuildKakaoAuthorizeUrlOptions {
  readonly config: KakaoConfig
  readonly redirectUri: string
  readonly state: string
  readonly scope?: readonly string[]
  readonly prompt?: string
}

export type BuildKakaoAuthorizeUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: 'disallowed_redirect_uri' | 'missing_state' }

const KAKAO_AUTHORIZE_ENDPOINT = 'https://kauth.kakao.com/oauth/authorize'

/**
 * Builds Kakao OAuth Authorize URL.
 * Strictly verifies redirectUri against allowed redirect URIs via isAllowedRedirect.
 * Rejects disallowed, external, or malformed redirect URIs immediately.
 */
export function buildKakaoAuthorizeUrl(
  options: BuildKakaoAuthorizeUrlOptions,
): BuildKakaoAuthorizeUrlResult {
  const { config, redirectUri, state, scope, prompt } = options

  if (!state || typeof state !== 'string' || state.trim().length === 0) {
    return { ok: false, reason: 'missing_state' }
  }

  if (!isAllowedRedirect(redirectUri, config)) {
    return { ok: false, reason: 'disallowed_redirect_uri' }
  }

  const url = new URL(KAKAO_AUTHORIZE_ENDPOINT)
  url.searchParams.set('client_id', config.restApiKey)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)

  if (scope && scope.length > 0) {
    url.searchParams.set('scope', scope.join(' '))
  }

  if (prompt) {
    url.searchParams.set('prompt', prompt)
  }

  return { ok: true, url: url.toString() }
}
