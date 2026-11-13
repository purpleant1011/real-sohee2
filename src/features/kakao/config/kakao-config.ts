export interface KakaoConfig {
  readonly jsKey: string
  readonly restApiKey: string
  readonly clientSecret: string
  readonly stateSecret?: string
  readonly allowedOrigins: readonly string[]
  readonly redirectUris: readonly string[]
}

export interface PublicKakaoConfig {
  readonly jsKey: string
}

export type KakaoConfigResult =
  | { readonly ok: true; readonly config: KakaoConfig }
  | { readonly ok: false; readonly reason: string }

const REQUIRED_ENV_KEYS = [
  'KAKAO_JS_KEY',
  'KAKAO_REST_API_KEY',
  'KAKAO_CLIENT_SECRET',
  'KAKAO_ALLOWED_ORIGINS',
  'KAKAO_REDIRECT_URIS',
] as const

function isLocalhostHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]'
}

/**
 * Parses and strictly validates Kakao configuration from environment variables.
 * Does not throw exceptions; returns explicit { ok: false, reason } on missing keys or validation errors.
 */
export function loadKakaoConfig(
  env?: Record<string, string | undefined> | null,
): KakaoConfigResult {
  if (!env || typeof env !== 'object') {
    return {
      ok: false,
      reason: 'Environment variables object was not provided or invalid',
    }
  }

  const missing: string[] = []
  for (const key of REQUIRED_ENV_KEYS) {
    const val = env[key]
    if (typeof val !== 'string' || val.trim().length === 0) {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Missing required Kakao configuration: ${missing.join(', ')}`,
    }
  }

  const allowedOrigins = (env.KAKAO_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const redirectUris = (env.KAKAO_REDIRECT_URIS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (redirectUris.length === 0) {
    return {
      ok: false,
      reason: 'KAKAO_REDIRECT_URIS must contain at least one valid URI',
    }
  }

  // Validate redirect URIs: must be valid URL and only localhost can use http
  for (const uri of redirectUris) {
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch {
      return {
        ok: false,
        reason: `Invalid redirect URI format: ${uri}`,
      }
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        ok: false,
        reason: `Invalid redirect URI protocol: ${parsed.protocol} (only https or localhost http allowed)`,
      }
    }

    if (parsed.protocol === 'http:' && !isLocalhostHost(parsed.hostname)) {
      return {
        ok: false,
        reason: `Insecure http redirect URI is only allowed for localhost: ${uri}`,
      }
    }
  }

  const stateSecret =
    typeof env.KAKAO_STATE_SECRET === 'string' && env.KAKAO_STATE_SECRET.trim().length > 0
      ? env.KAKAO_STATE_SECRET.trim()
      : undefined

  return {
    ok: true,
    config: {
      jsKey: env.KAKAO_JS_KEY!.trim(),
      restApiKey: env.KAKAO_REST_API_KEY!.trim(),
      clientSecret: env.KAKAO_CLIENT_SECRET!.trim(),
      stateSecret,
      allowedOrigins: Object.freeze(allowedOrigins),
      redirectUris: Object.freeze(redirectUris),
    },
  }
}

/**
 * Extracts public client configuration (only JS Key).
 * Strictly guarantees that server secrets (REST API key, Client Secret) are never included.
 */
export function toPublicKakaoConfig(config: KakaoConfig): PublicKakaoConfig {
  return {
    jsKey: config.jsKey,
  }
}

/**
 * Validates whether the given redirect URI is allowed against the Kakao configuration.
 * - Exact match only (no wildcard, no path prefix, no partial match).
 * - Blocks open redirect, cross-host, protocol downgrade, and query/fragment modifications.
 * - Enforces HTTPS (HTTP allowed only for localhost / 127.0.0.1).
 */
export function isAllowedRedirect(uri: string, config: KakaoConfig): boolean {
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    return false
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(uri.trim())
  } catch {
    return false
  }

  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
    return false
  }

  if (targetUrl.protocol === 'http:' && !isLocalhostHost(targetUrl.hostname)) {
    return false
  }

  return config.redirectUris.some((allowed) => {
    try {
      const allowedUrl = new URL(allowed.trim())
      // Exact match check: scheme, host, port, path, search, and hash must match exactly
      return targetUrl.href === allowedUrl.href
    } catch {
      return false
    }
  })
}
