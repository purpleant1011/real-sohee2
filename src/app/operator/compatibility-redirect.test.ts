import { describe, expect, it } from 'vitest'
import { getOperatorCompatibilityRedirect } from './compatibility-redirect'

describe('operator compatibility redirect', () => {
  it.each([
    ['/operator', '/admin'],
    ['/operator/workspaces', '/admin/workspaces'],
    ['/operator/system?tab=health', '/admin/system?tab=health'],
  ])('maps %s to %s without rendering protected content', (source, target) => {
    expect(getOperatorCompatibilityRedirect(source)).toBe(target)
  })
})
