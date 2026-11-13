import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabaseClient: mocks.createClient }))

import { NotificationsRealtime } from './notifications-realtime'

describe('NotificationsRealtime', () => {
  it('keeps the server-rendered page usable when public client configuration is unavailable', () => {
    mocks.createClient.mockImplementation(() => { throw new Error('invalid public config') })

    expect(() => render(
      <NotificationsRealtime
        userId="10000000-0000-4000-8000-000000000001"
        workspaceId="20000000-0000-4000-8000-000000000001"
      />,
    )).not.toThrow()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
