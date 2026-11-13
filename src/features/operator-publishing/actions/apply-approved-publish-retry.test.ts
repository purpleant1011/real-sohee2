import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }))

import { applyApprovedPublishRetryAction } from './apply-approved-publish-retry'

const approvalRequestId = '10000000-0000-4000-8000-000000000001'

describe('applyApprovedPublishRetryAction', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: { retry_attempt_id: '10000000-0000-4000-8000-000000000002' }, error: null }) })

  it('uses the approval-bound apply RPC and never calls a provider', async () => {
    await expect(applyApprovedPublishRetryAction({ approvalRequestId })).resolves.toEqual({ data: { applied: true, retryAttemptId: '10000000-0000-4000-8000-000000000002' } })
    expect(mocks.rpc).toHaveBeenCalledWith('apply_approved_publish_retry', { p_approval_request_id: approvalRequestId })
  })

  it('rejects malformed approval ids before mutation', async () => {
    await expect(applyApprovedPublishRetryAction({ approvalRequestId: 'not-a-uuid' })).resolves.toHaveProperty('error')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
