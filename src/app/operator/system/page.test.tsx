import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect }))

import OperatorSystemCompatibilityPage from './page'

describe('operator system compatibility page', () => {
  beforeEach(() => redirect.mockClear())

  it('preserves the query string while redirecting to the canonical route', async () => {
    await OperatorSystemCompatibilityPage({ searchParams: Promise.resolve({ tab: 'health' }) })
    expect(redirect).toHaveBeenCalledWith('/admin/system?tab=health')
  })
})
