import { describe, expect, it } from 'vitest'
import { safeOperatorNextPath } from './safe-operator-next-path'

describe('safeOperatorNextPath', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/system', '/admin/system'],
    ['/admin/system?tab=health', '/admin/system?tab=health'],
    ['/admin?from=login#top', '/admin?from=login#top'],
    ['/operator', '/admin'],
    ['/operator/system', '/admin/system'],
    ['/operator/system?tab=health', '/admin/system?tab=health'],
    ['/operator?from=login#top', '/admin?from=login#top'],
  ])('keeps a safe admin path and normalizes legacy operator paths: %s', (input, expected) => {
    expect(safeOperatorNextPath(input)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '\\\\evil.example',
    '/\\\\evil.example',
    '/operator/\\\\evil.example',
    '/%2F%2Fevil.example',
    '/%252F%252Fevil.example',
    '/%2foperator',
    '/%6fperator',
    '/operator%2F..%2Fapp',
    '/operator/%2e%2e/app',
    '/operator/../app',
    '/operator/./system',
    '/operator//system',
    '/operator%00',
    '/operator\u000d\u000aLocation:%20https://evil.example',
    '/login?next=https://evil.example',
    '/operator?next=/app',
    '/operator?redirect=https://evil.example',
    '/operator?returnTo=/app',
    '/operator?callback=/app',
    '/app/work',
    '/operator.evil',
    '/settings',
  ])('falls back for an encoded or external path: %s', (input) => {
    expect(safeOperatorNextPath(input)).toBe('/admin')
  })
})
