const defaultAdminNextPath = '/admin'

function isNestedRedirectQuery(input: string): boolean {
  const queryStart = input.indexOf('?')
  if (queryStart < 0) return false
  const query = input.slice(queryStart + 1).split('#', 1)[0] ?? ''
  return query.split('&').some((part) => {
    const key = part.split('=', 1)[0] ?? ''
    return /^(?:next|redirect|returnTo|callback)$/iu.test(key)
  })
}

/** Limits post-authentication redirects to the internal admin console. */
export function safeOperatorNextPath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2_048) {
    return defaultAdminNextPath
  }

  const pathname = input.split(/[?#]/u, 1)[0] ?? ''
  const segments = pathname.split('/')
  const hasUnsafeSegment = segments.slice(1).some((segment) =>
    segment.length === 0 || segment === '.' || segment === '..')

  if (
    input.includes('%') ||
    input.includes('\\') ||
    /[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/u.test(input) ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(input) ||
    !/^\/(?:admin|operator)(?:\/|$)/u.test(pathname) ||
    hasUnsafeSegment ||
    isNestedRedirectQuery(input)
  ) {
    return defaultAdminNextPath
  }

  return input.replace(/^\/operator(?=\/|[?#]|$)/u, '/admin')
}
