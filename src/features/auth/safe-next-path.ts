const defaultNextPath = '/app'

/**
 * Limits post-authentication redirects to routes owned by the protected app.
 *
 * `/start` (가입 직후 첫 게시물 여정) 는 인증 후 복귀 대상이므로 함께 허용한다.
 * 그 외 경로는 앱 홈으로 되돌린다.
 *
 * The value can originate from a query string, so encoded delimiters are
 * rejected rather than decoded into a different navigation target.
 */
export function safeNextPath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2_048) {
    return defaultNextPath
  }

  const pathname = input.split(/[?#]/, 1)[0]

  if (
    input.includes('\\') ||
    pathname.includes('%') ||
    /[\u0000-\u001F\u007F]/.test(input) ||
    !/^\/(?:app|start)(?:\/|$)/.test(pathname)
  ) {
    return defaultNextPath
  }

  return input
}
