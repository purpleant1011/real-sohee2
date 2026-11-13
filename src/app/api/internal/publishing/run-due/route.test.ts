import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), publish: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/features/publishing/actions/live-publish', () => ({ executeLivePublishSchedule: mocks.publish }))

import { POST } from './route'

const due = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  scheduleId: '20000000-0000-4000-8000-000000000001',
  actorUserId: '30000000-0000-4000-8000-000000000001',
}

describe('scheduled publishing endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret-with-enough-entropy'
    mocks.rpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: [{ workspace_id: due.workspaceId, schedule_id: due.scheduleId, actor_user_id: due.actorUserId }], error: null })
    mocks.publish.mockResolvedValue({ data: { status: 'published' } })
  })

  it('recovers stale leases, lists due intents, and sends each through the same live service', async () => {
    const response = await POST(new Request('https://example.com/api/internal/publishing/run-due', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ recovered: 0, claimed: 1, completed: 1, needsReview: 0 })
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['recover_expired_publish_leases', 'list_due_publish_schedules'])
    expect(mocks.publish).toHaveBeenCalledWith(due)
  })

  it('does not reveal whether the cron secret exists to an unauthorized caller', async () => {
    const response = await POST(new Request('https://example.com/api/internal/publishing/run-due', { method: 'POST' }))
    expect(response.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('counts unknown results for operator review instead of retrying them', async () => {
    mocks.publish.mockResolvedValue({ data: { status: 'unknown' } })
    const response = await POST(new Request('https://example.com/api/internal/publishing/run-due', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }))
    await expect(response.json()).resolves.toMatchObject({ completed: 0, needsReview: 1 })
    expect(mocks.publish).toHaveBeenCalledOnce()
  })
})
