import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendCommentReply } from '@/features/engagement/send'
import type { SocialComment } from '@/features/engagement/types'

// Top-level mocks to prevent hoisting warnings
vi.mock('@/features/engagement/draft', () => ({
  computeApprovalFingerprint: vi.fn().mockReturnValue('fp-valid'),
}))

vi.mock('@/features/engagement/engagement-allowlist', () => ({
  isEngagementWorkspaceAllowed: vi.fn().mockReturnValue(true),
}))

describe('Engagement Channel Learning Gate (ANI-2191, ANI-2204)', () => {
  const mockWorkspaceId = '11111111-1111-4111-8111-111111111111'
  const prevSend = process.env.ENGAGEMENT_SEND_ENABLED
  const prevLearning = process.env.SOHEE_CHANNEL_LEARNING_ENABLED

  afterEach(() => {
    if (prevSend !== undefined) process.env.ENGAGEMENT_SEND_ENABLED = prevSend
    else delete process.env.ENGAGEMENT_SEND_ENABLED

    if (prevLearning !== undefined) process.env.SOHEE_CHANNEL_LEARNING_ENABLED = prevLearning
    else delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED

    vi.restoreAllMocks()
  })

  it('채널 지식이 철회되었으면(validate_learning_result false) 댓글 실발송을 차단하고 사유를 반환한다', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'

    const comment: SocialComment = {
      id: 'cmt-1',
      workspace_id: mockWorkspaceId,
      channel: 'instagram',
      channel_connection_id: 'conn-1',
      provider_comment_id: 'p-cmt-1',
      provider_media_id: 'p-media-1',
      author_handle: 'customer1',
      comment_text: '가격이 얼마인가요?',
      comment_created_at: new Date().toISOString(),
      classification: 'QUESTION',
      confidence: 0.9,
      status: 'APPROVED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const mockRepo = {
      findDraftByCommentId: vi.fn().mockResolvedValue({
        id: 'draft-1',
        draft_text: '안녕하세요! 대표 메뉴 가격은 10,000원입니다.',
        approved_fingerprint: 'fp-valid',
      }),
    }

    const mockAdminClient = {
      rpc: vi.fn((name: string) => {
        if (name === 'get_approved_learning_context') {
          return Promise.resolve({
            data: {
              epoch: 1,
              items: [
                {
                  id: 'fact-1',
                  category: 'PRICE',
                  content: '10,000원',
                  source_type: 'channel',
                  source_id: 'src-1',
                  source_revision: 1,
                  dependencies: [{ workspaceId: mockWorkspaceId, sourceId: 'src-1', revision: 1 }],
                },
              ],
            },
            error: null,
          })
        }
        if (name === 'validate_learning_result') {
          // 채널 출처 철회 상태 모사
          return Promise.resolve({ data: false, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
      from: vi.fn((table: string) => {
        if (table === 'knowledge_sources') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockResolvedValue({
                    data: [{ id: 'src-1', lifecycle_revision: 1 }],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'workspace_knowledge_epochs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { epoch: 1 },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: table === 'business_profiles' ? { business_name: '테스트매장' } : null,
            error: null,
          }),
        }
      }),
    }

    const result = await sendCommentReply(
      comment,
      { type: 'owner', userId: 'usr-1' },
      {
        repo: mockRepo as any,
        getChannelCredential: vi.fn(),
        adminClient: mockAdminClient as any,
      }
    )

    // 발송 차단 검증
    expect(result.sent).toBe(false)
    expect(result.reason).toContain('매장 공식 채널 정보가 변경/철회되어')
  })

  it('채널 지식 검증 중 RPC 예외 발생 시 Fail-Open 하지 않고 안전하게 발송을 일시 차단한다', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'

    const comment: SocialComment = {
      id: 'cmt-1',
      workspace_id: mockWorkspaceId,
      channel: 'instagram',
      channel_connection_id: 'conn-1',
      provider_comment_id: 'p-cmt-1',
      provider_media_id: 'p-media-1',
      author_handle: 'customer1',
      comment_text: '가격 문의',
      comment_created_at: new Date().toISOString(),
      classification: 'QUESTION',
      confidence: 0.9,
      status: 'APPROVED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const mockRepo = {
      findDraftByCommentId: vi.fn().mockResolvedValue({
        id: 'draft-1',
        draft_text: '안녕하세요!',
        approved_fingerprint: 'fp-valid',
      }),
    }

    const mockAdminClient = {
      rpc: vi.fn().mockRejectedValue(new Error('NETWORK_TIMEOUT')),
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({
                data: [{ id: 'src-1', lifecycle_revision: 1 }],
                error: null,
              }),
            }),
            maybeSingle: vi.fn().mockResolvedValue({ data: { epoch: 1 }, error: null }),
          }),
        }),
      })),
    }

    const result = await sendCommentReply(
      comment,
      { type: 'owner', userId: 'usr-1' },
      {
        repo: mockRepo as any,
        getChannelCredential: vi.fn(),
        adminClient: mockAdminClient as any,
      }
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/매장 공식 채널 정보가 변경\/철회되어|채널 지식 검증 중 오류가 발생하여/)
  })
})
