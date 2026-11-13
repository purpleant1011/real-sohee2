// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.gte = mocks.count
      q.insert = mocks.insert
      return q
    },
  }),
}))

import { recordUsage, usedInLastDay } from './daily-quota'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'

describe('daily-quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries count within 24 hours for given workspaceId and eventType', async () => {
    mocks.count.mockResolvedValueOnce({ count: 3, error: null })
    const count = await usedInLastDay(workspaceId, 'image_style_preview')
    expect(count).toBe(3)
  })

  it('falls back to 0 when count is undefined or null', async () => {
    mocks.count.mockResolvedValueOnce({ count: null, error: null })
    const count = await usedInLastDay(workspaceId, 'image_style_preview')
    expect(count).toBe(0)
  })

  it('records usage into audit_events with workspaceId and userId', async () => {
    mocks.insert.mockResolvedValueOnce({ error: null })
    await recordUsage(workspaceId, userId, 'image_style_analysis', 'workspace_image_style')
    expect(mocks.insert).toHaveBeenCalledWith({
      workspace_id: workspaceId,
      actor_id: userId,
      event_type: 'image_style_analysis',
      entity_type: 'workspace_image_style',
      metadata: {},
    })
  })
})
