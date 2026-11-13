import { describe, expect, it, vi } from 'vitest'
import { getWorkspaceCanonicalReadModel } from '@/features/canonical-read-model/server'

describe('Canonical Server Read Model & Same-Truth (ANI-1003)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'

  it('renders honest NO_PROOF and zero synthetic metrics when no collections exist', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    business_name: '바이름 브로우',
                    industry: '뷰티/눈썹',
                    summary: '청라 1:1 맞춤 자연눈썹',
                    updated_at: '2026-09-07T00:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'workspace_credit_states') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { total_available_credits: 450, updated_at: '2026-09-07T00:00:00Z' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: 'conn-1', channel: 'instagram', status: 'connected', webhook_status: 'pending' }],
                error: null,
              }),
            }),
          }
        }
        if (table === 'channel_consents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        if (table === 'meta_channel_credentials' || table === 'external_action_requests') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        if (table === 'external_action_receipts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        if (table === 'channel_metric_collections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'channel_response_jobs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }
        }
        return { select: vi.fn() }
      }),
    }

    const model = await getWorkspaceCanonicalReadModel(workspaceId, mockClient)

    expect(model.workspaceId).toBe(workspaceId)
    expect(model.datasetMode).toBe('ACTUAL')
    expect(model.businessName.value).toBe('바이름 브로우')
    expect(model.businessName.state).toBe('AVAILABLE')
    expect(model.creditsAvailable.value).toBe(450)

    // Metrics must be NO_PROOF, not hallucinated numbers
    expect(model.metrics.views.state).toBe('NO_PROOF')
    expect(model.metrics.views.value).toBeNull()
    expect(model.metrics.likes.state).toBe('NO_PROOF')

    // Recent proof count must be 0
    expect(model.recentActionsCount).toBe(0)
    expect(model.inbox.length).toBe(0)
  })

  it('populates inbox work items from canonical response jobs with deep-linkable target ids', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'channel_response_jobs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'job-101',
                        response_kind: 'instagram_comment_reply',
                        external_target_id: 'comment-999',
                        draft_text: '감사합니다!',
                        status: 'sent',
                        created_at: '2026-09-07T05:00:00Z',
                        updated_at: '2026-09-07T05:01:00Z',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }
      }),
    }

    const model = await getWorkspaceCanonicalReadModel(workspaceId, mockClient)
    expect(model.inbox.length).toBe(1)
    const item = model.inbox[0]
    expect(item.id).toBe('job-101')
    expect(item.status).toBe('completed')
    expect(item.externalTargetId).toBe('comment-999')
  })
})
