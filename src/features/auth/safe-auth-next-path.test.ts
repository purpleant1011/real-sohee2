import { describe, expect, it } from 'vitest'
import { safeAuthNextPath } from './safe-auth-next-path'

describe('safeAuthNextPath', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/system?tab=health', '/admin/system?tab=health'],
    ['/operator', '/admin'],
    ['/operator/system?tab=health', '/admin/system?tab=health'],
    ['/operator?next=/app', '/admin'],
    ['/operator%2F..%2Fapp', '/app'],
    ['/%2Foperator', '/app'],
    ['/operator.evil', '/app'],
    ['/auth/admin-setup', '/auth/admin-setup'],
    ['/auth/admin-setup?next=https://evil.example', '/app'],
    ['/auth/anything-else', '/app'],
  ])('dispatches only a literal safe admin/operator candidate: %s', (input, expected) => {
    expect(safeAuthNextPath(input)).toBe(expected)
  })

  it.each([
    ['/app', '/app'],
    ['/app/work/123?tab=recent', '/app/work/123?tab=recent'],
    ['https://evil.example', '/app'],
    [undefined, '/app'],
  ])('preserves the customer redirect contract: %s', (input, expected) => {
    expect(safeAuthNextPath(input)).toBe(expected)
  })
})
