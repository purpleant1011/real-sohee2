import { describe, expect, it, vi } from 'vitest'
import { createConversationThreadRouteHandler } from './route'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const threadId = '20000000-0000-4000-8000-000000000001'

describe('conversation detail route', () => {
  it('uses a reversible archive policy and never deletes the thread', async () => {
    const updateStatus = vi.fn(async ({ status }: { status: 'active' | 'archived' }) => ({
      id: threadId,
      workspaceId,
      title: '주간 콘텐츠 계획',
      status,
      lastMessageAt: null,
      createdAt: '2026-08-14T01:00:00.000Z',
      updatedAt: '2026-08-14T02:00:00.000Z',
    }))
    const PATCH = createConversationThreadRouteHandler({
      authorize: vi.fn(async () => ({ workspaceId, role: 'manager' as const })),
      updateStatus,
    })
    const response = await PATCH(
      new Request('https://sohee.test', {
        method: 'PATCH', body: JSON.stringify({ status: 'archived' }),
      }),
      { params: Promise.resolve({ workspaceId, threadId }) },
    )

    expect(response.status).toBe(200)
    expect(updateStatus).toHaveBeenCalledWith({ workspaceId, threadId, status: 'archived' })
    expect(await response.json()).toMatchObject({ data: { thread: { status: 'archived' } } })
  })
})
