import { expect, it, vi } from 'vitest'
import { createConversationJobCancelPostHandler } from './route'

it('cancels only the authorized scoped job', async () => {
  const cancel = vi.fn(async () => ({ id: '30000000-0000-4000-8000-000000000001', status: 'cancel_requested' }))
  const response = await createConversationJobCancelPostHandler({
    authenticate: async () => '40000000-0000-4000-8000-000000000001',
    authorize: async () => true,
    cancel,
  })(new Request('https://sohee.test/cancel', { method: 'POST' }), { params: Promise.resolve({
    workspaceId: '10000000-0000-4000-8000-000000000001',
    jobId: '30000000-0000-4000-8000-000000000001',
  }) })
  expect(response.status).toBe(200)
  expect(cancel).toHaveBeenCalledTimes(1)
})
