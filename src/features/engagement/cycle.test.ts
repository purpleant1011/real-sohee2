import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runEngagementCycle } from './cycle'
import type { EngagementRepository } from './repository'
import type { TextGenerator } from '@/features/vault/transform/ports/text-generator'
import type { EngagementPolicy, SocialComment } from './types'

vi.mock('./send', () => ({
  sendCommentReply: vi.fn().mockResolvedValue({
    sent: true,
    status: 'SENT',
    providerReplyId: 'mock-reply-id',
  }),
}))

describe('runEngagementCycle cost caps and cycle logic (Invariant 9)', () => {
  let mockRepo: EngagementRepository
  let mockGen: TextGenerator

  const mockPolicy: EngagementPolicy = {
    id: 'pol-1',
    workspace_id: 'ws-1',
    channel: 'instagram',
    auto_reply_enabled: true,
    is_paused: false,
    allowed_classes: ['THANKS', 'GREETING'],
    min_confidence: 0.85,
    daily_cap: 10,
    quiet_hours_enabled: false,
    quiet_hours_start: null,
    quiet_hours_end: null,
    max_comment_age_days: 7,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockGen = {
      generateText: vi.fn().mockImplementation((prompt: string) => {
        if (prompt.includes('분류기')) {
          return Promise.resolve(JSON.stringify({ classification: 'THANKS', confidence: 0.95 }))
        }
        return Promise.resolve(JSON.stringify({ reply: '감사합니다 고객님!' }))
      }),
    }
  })

  it('enforces cost caps: max 20 classified+drafted and max 5 sends per cycle', async () => {
    // Generate 25 synthetic unclassified comments
    const comments: SocialComment[] = Array.from({ length: 25 }, (_, i) => ({
      id: `cm-${i}`,
      workspace_id: 'ws-1',
      channel_connection_id: 'conn-1',
      channel: 'instagram',
      provider_comment_id: `prov-cm-${i}`,
      provider_media_id: 'med-1',
      author_handle: `user_${i}`,
      comment_text: `너무 좋아요 ${i}`,
      comment_created_at: new Date().toISOString(),
      classification: null,
      confidence: null,
      status: 'RECEIVED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    mockRepo = {
      listUnprocessedComments: vi.fn().mockImplementation((_ws: string, limit: number) => {
        // limit should be at most 20
        return Promise.resolve(comments.slice(0, limit))
      }),
      findDraftByCommentId: vi.fn().mockResolvedValue(null),
      saveDraft: vi.fn().mockImplementation((ws, id, text, fp) => {
        return Promise.resolve({
          id: `draft-${id}`,
          workspace_id: ws,
          comment_id: id,
          draft_text: text,
          approved_fingerprint: fp,
          approved_by: null,
          approved_at: null,
          is_auto_approved: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }),
      updateCommentClassification: vi.fn().mockResolvedValue(undefined),
      approveDraft: vi.fn().mockResolvedValue(undefined),
      findPolicy: vi.fn().mockResolvedValue(mockPolicy),
      countAutoRepliesSentToday: vi.fn().mockResolvedValue(0),
    } as unknown as EngagementRepository

    const result = await runEngagementCycle('ws-1', {
      repo: mockRepo,
      textGenerator: mockGen,
      loadContext: vi.fn().mockResolvedValue({
        businessName: '소희 매장',
        industry: '카페',
        location: '서울',
        facts: [],
        tone: { presetKey: null, brandVoice: '친절한' },
        knowledgeVersion: 1,
        warnings: [],
      }),
      getChannelCredential: vi.fn().mockResolvedValue({
        accessToken: 'token',
        grantedScopes: ['instagram_manage_comments'],
      }),
    })

    // maxClassifyAndDraft default is 20
    expect(mockRepo.listUnprocessedComments).toHaveBeenCalledWith('ws-1', 20)
    expect(result.classifiedCount).toBe(20)
    expect(result.draftedCount).toBe(20)
    // maxSends default is 5
    expect(result.autoSentCount).toBe(5)
    expect(result.skippedCount).toBe(15)
  })

  it('generates draft using policy default_tone and auto-approves & sends for L2_ASSISTED', async () => {
    const l2Policy: EngagementPolicy = {
      ...mockPolicy,
      autonomy_level: 'L2_ASSISTED',
      default_tone: 'witty',
    }

    const singleComment: SocialComment = {
      id: 'cm-witty-1',
      workspace_id: 'ws-1',
      channel_connection_id: 'conn-1',
      channel: 'instagram',
      provider_comment_id: 'p-cm-witty',
      provider_media_id: 'med-1',
      author_handle: 'happy_user',
      comment_text: '공간이 너무 이뻐요!',
      comment_created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
      classification: 'THANKS',
      confidence: 0.95,
      status: 'RECEIVED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    mockRepo = {
      listUnprocessedComments: vi.fn().mockResolvedValue([singleComment]),
      findDraftByCommentId: vi.fn().mockResolvedValue(null),
      saveDraft: vi.fn().mockImplementation((ws, id, text, fp) => {
        return Promise.resolve({
          id: `draft-${id}`,
          workspace_id: ws,
          comment_id: id,
          draft_text: text,
          approved_fingerprint: fp,
          approved_by: null,
          approved_at: null,
          is_auto_approved: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }),
      updateCommentClassification: vi.fn().mockResolvedValue(undefined),
      approveDraft: vi.fn().mockResolvedValue(undefined),
      findPolicy: vi.fn().mockResolvedValue(l2Policy),
      countAutoRepliesSentToday: vi.fn().mockResolvedValue(0),
    } as unknown as EngagementRepository

    const result = await runEngagementCycle('ws-1', {
      repo: mockRepo,
      textGenerator: mockGen,
      loadContext: vi.fn().mockResolvedValue({
        businessName: '바이름',
        industry: '뷰티',
        location: '인천',
        facts: [],
        tone: { presetKey: null, brandVoice: '친절한' },
        knowledgeVersion: 1,
        warnings: [],
      }),
      getChannelCredential: vi.fn().mockResolvedValue({
        accessToken: 'token',
        grantedScopes: ['instagram_manage_comments'],
      }),
    })

    expect(result.classifiedCount).toBe(0) // already classified
    expect(result.draftedCount).toBe(1)
    expect(result.autoSentCount).toBe(1)
    expect(mockRepo.saveDraft).toHaveBeenCalledWith(
      'ws-1',
      'cm-witty-1',
      expect.stringContaining('센스 만점 댓글'),
      expect.any(String)
    )
    expect(mockRepo.approveDraft).toHaveBeenCalledWith(
      'ws-1',
      'cm-witty-1',
      expect.any(String),
      null,
      true
    )
  })
})
