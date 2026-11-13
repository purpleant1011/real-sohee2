import { describe, it, expect, vi } from 'vitest'
import { redirect } from 'next/navigation'
import PluginsPage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('Legacy /app/plugins Route Redirect (ANI-887)', () => {
  it('redirects to /app/sohee?tab=capabilities to preserve bookmarks', () => {
    PluginsPage()
    expect(redirect).toHaveBeenCalledWith('/app/sohee?tab=capabilities')
  })
})
