export const ALLOWED_RETURN_PREFIXES = [
  '/app',
  '/onboarding',
  '/start',
] as const

export const ALLOWED_RETURN_PATHS = [
  '/app/settings/channels',
  '/app/onboarding',
  '/app',
  '/app/channels',
  '/start',
  '/start?step=channels',
  '/start/preview',
] as const

const DEFAULT_RETURN_PATH = '/app/channels'

/**
 * Validates and normalizes return paths for OAuth flows.
 * Protects strictly against Open Redirect attacks:
 * - Only relative paths starting with a single '/'
 * - No protocol-relative paths ('//evil.com')
 * - No backslashes ('/\evil.com')
 * - Only allows prefixes: /start, /app, /onboarding
 * - Preserves safe query strings (e.g. ?step=channels)
 */
export function parseReturnPath(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') {
    return DEFAULT_RETURN_PATH
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return DEFAULT_RETURN_PATH
  }

  try {
    const dummyOrigin = 'https://sohee.local'
    const parsed = new URL(trimmed, dummyOrigin)

    // Ensure no hostname injection happened
    if (parsed.origin !== dummyOrigin) {
      return DEFAULT_RETURN_PATH
    }

    const pathname = parsed.pathname

    const isAllowed = ALLOWED_RETURN_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )

    if (!isAllowed) {
      return DEFAULT_RETURN_PATH
    }

    // Return the safe relative path including query string
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return DEFAULT_RETURN_PATH
  }
}

