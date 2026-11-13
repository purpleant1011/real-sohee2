import { describe, expect, it, vi } from 'vitest'
import { createConversationJobsPostHandler } from './route'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const threadId = '20000000-0000-4000-8000-000000000001'
const userId = '30000000-0000-4000-8000-000000000001'
const body = { content: '질문', clientMessageId: '40000000-0000-4000-8000-000000000001', attachmentIds: [] }

describe('POST conversation jobs', () => {
  it('returns 202 after authorized submission', async () => {
    const submit = vi.fn(async () => ({ job: { id: '50000000-0000-4000-8000-000000000001', status: 'queued' } }))
    const response = await createConversationJobsPostHandler({
      authenticate: async () => userId,
      authorize: async () => true,
      submit,
    })(new Request('https://sohee.test/jobs', { method: 'POST', body: JSON.stringify(body) }), {
      params: Promise.resolve({ workspaceId, threadId }),
    })
    expect(response.status).toBe(202)
    expect(submit).toHaveBeenCalledWith({ workspaceId, threadId, userId, request: body })
  })

  it('does not submit before authentication and thread authorization', async () => {
    const submit = vi.fn()
    const handler = createConversationJobsPostHandler({ authenticate: async () => null, authorize: vi.fn(), submit })
    const response = await handler(new Request('https://sohee.test/jobs', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ workspaceId, threadId }) })
    expect(response.status).toBe(401)
    expect(submit).not.toHaveBeenCalled()
  })
})
