import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'

const mocks = vi.hoisted(() => ({
  getPreview: vi.fn(),
  getUser: vi.fn(),
  membership: vi.fn(),
  schedules: vi.fn(),
  attempts: vi.fn(),
  tracking: vi.fn(),
  backfill: vi.fn(),
}))

function membershipQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: mocks.membership,
  }
  return query
}

function listQuery(result: ReturnType<typeof vi.fn>) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: result,
  }
  return query
}


function trackingQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: mocks.tracking,
  }
  return query
}

vi.mock('@/features/approvals/approval-preview-repository', () => ({ getApprovalPreview: mocks.getPreview }))
vi.mock('@/features/publishing/backfill-published-destination', () => ({
  backfillPublishedDestination: mocks.backfill,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      if (table === 'workspace_members') return membershipQuery()
      if (table === 'schedules') return listQuery(mocks.schedules)
      if (table === 'publish_attempts') return listQuery(mocks.attempts)
      if (table === 'social_post_tracking') return trackingQuery()
      throw new Error(`unexpected table: ${table}`)
    }),
  })),
}))

import { loadConversationPublishingAction } from './load-conversation-publishing'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const contentId = '20000000-0000-4000-8000-000000000001'
const versionId = '30000000-0000-4000-8000-000000000001'

const preview: ApprovalPreviewSnapshot = {
  workspaceId,
  contentId,
  versionId,
  versionNumber: 3,
  fingerprint: 'a'.repeat(64),
  approval: { id: '40000000-0000-4000-8000-000000000001', status: 'approved', fingerprint: 'a'.repeat(64) },
  channel: 'threads',
  account: { connectionId: '50000000-0000-4000-8000-000000000001', label: '@sohee', status: 'connected' },
  caption: '게시 문구',
  hashtags: ['#소희'],
  disclosure: 'AI 보조 제작',
  text: '게시 문구\n\n#소희\n\nAI 보조 제작',
  media: [],
  issues: [],
}

describe('loadConversationPublishingAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: '60000000-0000-4000-8000-000000000001' } }, error: null })
    mocks.membership.mockResolvedValue({ data: { role: 'owner', status: 'active' }, error: null })
    mocks.getPreview.mockResolvedValue({ data: preview })
    mocks.schedules.mockResolvedValue({ data: [], error: null })
    mocks.attempts.mockResolvedValue({ data: [], error: null })
    mocks.tracking.mockResolvedValue({ data: null, error: null })
    mocks.backfill.mockResolvedValue(null)
  })

  it('returns the exact preview with no browser-invented receipt when nothing was dispatched', async () => {
    await expect(loadConversationPublishingAction({ workspaceId, contentId })).resolves.toEqual({
      data: { role: 'owner', preview, receipt: null },
    })
    expect(mocks.attempts).not.toHaveBeenCalled()
  })

  it('restores the latest provider-confirmed result for the exact preview version', async () => {
    mocks.schedules.mockResolvedValue({
      data: [{
        id: '70000000-0000-4000-8000-000000000001',
        version_id: versionId,
        publish_at: '2026-08-14T09:00:00.000Z',
        status: 'published',
      }],
      error: null,
    })
    mocks.attempts.mockResolvedValue({
      data: [{
        id: '80000000-0000-4000-8000-000000000001',
        status: 'succeeded',
        provider_reference: 'threads-post-1',
      }],
      error: null,
    })
    mocks.tracking.mockResolvedValue({
      data: { destination_url: 'https://www.threads.com/@sohee/post/THREAD1' },
      error: null,
    })

    await expect(loadConversationPublishingAction({ workspaceId, contentId })).resolves.toMatchObject({
      data: {
        role: 'owner',
        preview: { versionId },
        receipt: {
          next: 'published',
          scheduleId: '70000000-0000-4000-8000-000000000001',
          attemptId: '80000000-0000-4000-8000-000000000001',
          providerPostId: 'threads-post-1',
          destinationUrl: 'https://www.threads.com/@sohee/post/THREAD1',
        },
      },
    })
  })

  it('fails before reading content when the workspace membership is inactive', async () => {
    mocks.membership.mockResolvedValue({ data: { role: 'owner', status: 'inactive' }, error: null })

    await expect(loadConversationPublishingAction({ workspaceId, contentId })).resolves.toMatchObject({
      error: { message: '이 작업공간의 게시물을 검토할 수 없습니다.' },
    })
    expect(mocks.getPreview).not.toHaveBeenCalled()
  })

  it('repairs a missing destination from the provider without publishing again', async () => {
    mocks.schedules.mockResolvedValue({
      data: [{
        id: '70000000-0000-4000-8000-000000000001',
        version_id: versionId,
        publish_at: '2026-08-14T09:00:00.000Z',
        status: 'published',
      }],
      error: null,
    })
    mocks.attempts.mockResolvedValue({
      data: [{
        id: '80000000-0000-4000-8000-000000000001',
        status: 'succeeded',
        provider_reference: 'threads-post-1',
      }],
      error: null,
    })
    mocks.tracking.mockResolvedValue({ data: { destination_url: null }, error: null })
    mocks.backfill.mockResolvedValue('https://www.threads.com/@sohee/post/THREAD1')

    const result = await loadConversationPublishingAction({ workspaceId, contentId })

    expect(mocks.backfill).toHaveBeenCalledWith({
      workspaceId,
      channelConnectionId: preview.account.connectionId,
      channel: 'threads',
      attemptId: '80000000-0000-4000-8000-000000000001',
      providerPostId: 'threads-post-1',
    })
    expect(result.data?.receipt?.destinationUrl).toBe('https://www.threads.com/@sohee/post/THREAD1')
  })
})
