import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceContext } from '@/features/auth/workspace-context'
import { createConversationsRouteHandlers } from './route'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const threadId = '20000000-0000-4000-8000-000000000001'
const requestKey = '30000000-0000-4000-8000-000000000001'
const userId = '40000000-0000-4000-8000-000000000001'
const clientMessageId = '50000000-0000-4000-8000-000000000001'
const thread = {
  id: threadId,
  workspaceId,
  title: '새 대화',
  status: 'active' as const,
  lastMessageAt: null,
  createdAt: '2026-08-14T01:00:00.000Z',
  updatedAt: '2026-08-14T01:00:00.000Z',
}
const userMessage = {
  id: '60000000-0000-4000-8000-000000000001',
  workspaceId,
  threadId,
  role: 'user' as const,
  content: '이번 주 게시물을 제안해줘',
  status: 'completed' as const,
  workItemId: null,
  createdAt: '2026-08-14T01:00:00.000Z',
  completedAt: '2026-08-14T01:00:00.000Z',
}

function dependencies() {
  return {
    authenticate: vi.fn(async () => userId),
    authorize: vi.fn(async (): Promise<WorkspaceContext> => ({ workspaceId, role: 'owner' })),
    list: vi.fn(async () => ({ items: [thread], hasMore: false })),
    start: vi.fn(async () => ({ thread, userMessage })),
  }
}

describe('conversation collection route', () => {
  it('lists only the authorized current workspace page', async () => {
    const deps = dependencies()
    const { GET } = createConversationsRouteHandlers(deps)
    const response = await GET(
      new Request(`https://sohee.test/api/workspaces/${workspaceId}/conversations?page=2`),
      { params: Promise.resolve({ workspaceId }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { items: [thread], hasMore: false } })
    expect(deps.list).toHaveBeenCalledWith({ workspaceId, page: 2, limit: 20 })
  })

  it('atomically creates one idempotent thread and its first message', async () => {
    const deps = dependencies()
    const { POST } = createConversationsRouteHandlers(deps)
    const response = await POST(
      new Request(`https://sohee.test/api/workspaces/${workspaceId}/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestKey,
          firstMessage: { clientMessageId, content: userMessage.content },
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ data: { thread, userMessage } })
    expect(deps.start).toHaveBeenCalledWith({
      workspaceId,
      requestKey,
      userId,
      clientMessageId,
      content: userMessage.content,
    })
  })

  it('does not reveal a different workspace or allow viewers to create', async () => {
    const foreign = dependencies()
    foreign.authorize.mockResolvedValueOnce({
      workspaceId: '10000000-0000-4000-8000-000000000002',
      role: 'owner',
    })
    const foreignResponse = await createConversationsRouteHandlers(foreign).GET(
      new Request(`https://sohee.test/api/workspaces/${workspaceId}/conversations`),
      { params: Promise.resolve({ workspaceId }) },
    )
    expect(foreignResponse.status).toBe(403)
    expect(foreign.list).not.toHaveBeenCalled()

    const viewer = dependencies()
    viewer.authorize.mockResolvedValueOnce({ workspaceId, role: 'viewer' })
    const viewerResponse = await createConversationsRouteHandlers(viewer).POST(
      new Request(`https://sohee.test/api/workspaces/${workspaceId}/conversations`, {
        method: 'POST',
        body: JSON.stringify({
          requestKey,
          firstMessage: { clientMessageId, content: userMessage.content },
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    )
    expect(viewerResponse.status).toBe(403)
    expect(viewer.start).not.toHaveBeenCalled()
  })
})
