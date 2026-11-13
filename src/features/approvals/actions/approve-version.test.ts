import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), maybeSingle: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => {
      const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: mocks.maybeSingle }
      return query
    }),
    rpc: mocks.rpc,
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { approveVersionAction, rejectVersionAction } from './approve-version'

const input = {
  workspaceId: '20000000-0000-4000-8000-000000000001',
  contentId: '30000000-0000-4000-8000-000000000001',
  versionId: '40000000-0000-4000-8000-000000000001',
  fingerprint: 'a'.repeat(64),
  reason: '본문과 고지, 권리 근거를 모두 확인했습니다.',
  confirmations: {
    content: true as const,
    mediaOrder: true as const,
    altText: true as const,
    provenance: true as const,
    unresolved: true as const,
  },
}

describe('approveVersionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'reviewer', status: 'active' }, error: null })
    mocks.rpc.mockResolvedValue({ data: '50000000-0000-4000-8000-000000000001', error: null })
  })

  it('rechecks authority and calls the latest-version approval RPC once', async () => {
    await expect(approveVersionAction(input)).resolves.toEqual({
      data: { approvalId: '50000000-0000-4000-8000-000000000001' },
    })
    expect(mocks.rpc).toHaveBeenCalledWith('approve_content_version', {
      p_workspace_id: input.workspaceId,
      p_content_id: input.contentId,
      p_version_id: input.versionId,
      p_expected_fingerprint: input.fingerprint,
      p_disclosure_confirmed: true,
      p_rights_confirmed: true,
      p_reason: input.reason,
    })
  })

  it('rejects unchecked confirmations and viewers before the RPC', async () => {
    await expect(approveVersionAction({ ...input, confirmations: { ...input.confirmations, provenance: false } })).resolves.toMatchObject({ error: { requestId: 'content-approval' } })
    expect(mocks.getUser).not.toHaveBeenCalled()

    mocks.maybeSingle.mockResolvedValue({ data: { role: 'viewer', status: 'active' }, error: null })
    await approveVersionAction(input)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('records an explicit rejection for the exact latest fingerprint', async () => {
    await expect(rejectVersionAction({
      workspaceId: input.workspaceId,
      contentId: input.contentId,
      versionId: input.versionId,
      fingerprint: input.fingerprint,
      reason: '게시 전 문구를 다시 다듬어 주세요.',
    })).resolves.toEqual({ data: { approvalId: '50000000-0000-4000-8000-000000000001' } })
    expect(mocks.rpc).toHaveBeenCalledWith('reject_content_version', {
      p_workspace_id: input.workspaceId,
      p_content_id: input.contentId,
      p_version_id: input.versionId,
      p_expected_fingerprint: input.fingerprint,
      p_reason: '게시 전 문구를 다시 다듬어 주세요.',
    })
  })
})
