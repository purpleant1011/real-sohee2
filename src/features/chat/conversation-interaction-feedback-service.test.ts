import { describe, expect, it, vi } from 'vitest'
import { parseInteractionDraftSnapshot } from '@/features/engagement/interaction-draft-contract'
import {
  processInteractionFeedbackRequest,
  type FeedbackGateway,
  type FeedbackInboxItem,
  type FeedbackRequestInput,
} from './conversation-interaction-feedback-service'

const mockWorkspaceId = '10000000-0000-4000-8000-000000000001'
const mockCommentId1 = '20000000-0000-4000-8000-000000000001'
const mockCommentId2 = '20000000-0000-4000-8000-000000000002'
const mockDmThreadId1 = '30000000-0000-4000-8000-000000000001'
const mockDmMessageId1 = '40000000-0000-4000-8000-000000000001'

describe('conversation-interaction-feedback-service', () => {
  it('filters reservation inquiries and generates draft cards with user approval requirement', async () => {
    const inboxItems: FeedbackInboxItem[] = [
      {
        id: mockCommentId1,
        targetKind: 'comment',
        channel: 'instagram',
        text: '이번 주 토요일 4명 저녁 예약 가능한가요?',
        customerLabel: '예약희망자',
        createdAt: '2026-11-11T09:00:00Z',
      },
      {
        id: mockCommentId2,
        targetKind: 'comment',
        channel: 'instagram',
        text: '항상 사진 너무 멋져요 응원합니다!',
        customerLabel: '단골손님',
        createdAt: '2026-11-11T09:10:00Z',
      },
      {
        id: mockDmThreadId1,
        targetKind: 'dm',
        channel: 'instagram',
        text: '내일 점심 룸 예약 문의드립니다.',
        customerLabel: '문의고객',
        createdAt: '2026-11-11T09:20:00Z',
        sourceRef: mockDmMessageId1,
      },
    ]

    const gateway: FeedbackGateway = {
      loadInbox: vi.fn().mockResolvedValue(inboxItems),
    }

    const input: FeedbackRequestInput = {
      workspaceId: mockWorkspaceId,
      filter: {
        channel: 'instagram',
        topic: 'reservation',
      },
      now: '2026-11-11T10:00:00Z',
    }

    const result = await processInteractionFeedbackRequest(input, gateway)

    expect(gateway.loadInbox).toHaveBeenCalledWith({
      workspaceId: mockWorkspaceId,
      channel: 'instagram',
      topic: 'reservation',
      now: '2026-11-11T10:00:00Z',
    })

    expect(result.totalCount).toBe(3)
    expect(result.filteredCount).toBe(2)
    expect(result.drafts).toHaveLength(2)

    // Verify natural language sending prohibition and draft status in feedbackSummary
    expect(result.feedbackSummary).toContain('예약 문의')
    expect(result.feedbackSummary).toContain('DRAFT')
    expect(result.feedbackSummary).toContain('검토')

    // Verify first draft card (Instagram comment)
    const commentDraft = result.drafts[0]
    expect(commentDraft.targetKind).toBe('comment')
    expect(commentDraft.channel).toBe('instagram')
    expect(commentDraft.targetId).toBe(mockCommentId1)
    expect(commentDraft.customerLabel).toBe('예약희망자')
    expect(commentDraft.requiresUserApproval).toBe(true)
    expect(commentDraft.draftText).toContain('예약')
    expect(commentDraft.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(commentDraft.sourceRef).toMatch(/^[a-f0-9]{64}$/u)

    // Verify contract schema validity
    expect(() => parseInteractionDraftSnapshot(commentDraft, mockWorkspaceId)).not.toThrow()

    // Verify second draft card (Instagram DM)
    const dmDraft = result.drafts[1]
    expect(dmDraft.targetKind).toBe('dm')
    expect(dmDraft.channel).toBe('instagram')
    expect(dmDraft.targetId).toBe(mockDmThreadId1)
    expect(dmDraft.customerLabel).toBe('문의고객')
    expect(dmDraft.requiresUserApproval).toBe(true)
    expect(dmDraft.sourceRef).toBe(mockDmMessageId1)
    expect(dmDraft.fingerprint).toMatch(/^[a-f0-9]{64}$/u)

    // Verify contract schema validity for DM
    expect(() => parseInteractionDraftSnapshot(dmDraft, mockWorkspaceId)).not.toThrow()
  })

  it('filters pricing inquiries when topic is pricing', async () => {
    const inboxItems: FeedbackInboxItem[] = [
      {
        id: mockCommentId1,
        targetKind: 'comment',
        channel: 'instagram',
        text: '기본 코스 가격이 어떻게 되나요?',
        customerLabel: '가격문의자',
      },
      {
        id: mockCommentId2,
        targetKind: 'comment',
        channel: 'instagram',
        text: '이번 주 금요일 자리 있나요?',
        customerLabel: '예약문의자',
      },
    ]

    const gateway: FeedbackGateway = {
      loadInbox: vi.fn().mockResolvedValue(inboxItems),
    }

    const input: FeedbackRequestInput = {
      workspaceId: mockWorkspaceId,
      filter: {
        topic: 'pricing',
      },
    }

    const result = await processInteractionFeedbackRequest(input, gateway)

    expect(result.totalCount).toBe(2)
    expect(result.filteredCount).toBe(1)
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].targetId).toBe(mockCommentId1)
    expect(result.drafts[0].draftText).toContain('가격')
    expect(result.feedbackSummary).toContain('가격 문의')
  })

  it('processes all items when topic is all or omitted', async () => {
    const inboxItems: FeedbackInboxItem[] = [
      {
        id: mockCommentId1,
        targetKind: 'comment',
        channel: 'threads',
        text: '스레드 첫 방문 후기입니다.',
        customerLabel: '스레더',
      },
      {
        id: mockCommentId2,
        targetKind: 'comment',
        channel: 'threads',
        text: '메뉴 얼마인가요?',
        customerLabel: '메뉴문의자',
      },
    ]

    const gateway: FeedbackGateway = {
      loadInbox: vi.fn().mockResolvedValue(inboxItems),
    }

    const input: FeedbackRequestInput = {
      workspaceId: mockWorkspaceId,
      filter: {
        channel: 'threads',
        topic: 'all',
      },
    }

    const result = await processInteractionFeedbackRequest(input, gateway)

    expect(result.totalCount).toBe(2)
    expect(result.filteredCount).toBe(2)
    expect(result.drafts).toHaveLength(2)
    expect(result.drafts[0].channel).toBe('threads')
    expect(() => parseInteractionDraftSnapshot(result.drafts[0], mockWorkspaceId)).not.toThrow()
  })

  it('handles empty inbox gracefully with summary message', async () => {
    const gateway: FeedbackGateway = {
      loadInbox: vi.fn().mockResolvedValue([]),
    }

    const input: FeedbackRequestInput = {
      workspaceId: mockWorkspaceId,
      filter: {
        topic: 'reservation',
      },
    }

    const result = await processInteractionFeedbackRequest(input, gateway)

    expect(result.totalCount).toBe(0)
    expect(result.filteredCount).toBe(0)
    expect(result.drafts).toEqual([])
    expect(result.feedbackSummary).toContain('문의가 없습니다')
  })

  it('handles agent inbox format with reviews and dmThreads', async () => {
    const gateway: FeedbackGateway = {
      loadInbox: vi.fn().mockResolvedValue({
        reviews: [
          {
            id: mockCommentId1,
            channel: 'instagram' as const,
            authorName: '리뷰고객',
            commentText: '예약 문의드려요! 주말 예약 가능한가요?',
            createdAt: '2026-11-11T08:00:00Z',
          },
        ],
        dmThreads: [
          {
            id: mockDmThreadId1,
            customerLabel: 'DM고객',
            lastMessageText: '단체 예약 일정 상담 부탁드려요.',
            latestCustomerMessageId: mockDmMessageId1,
            lastMessageAt: '2026-11-11T08:30:00Z',
          },
        ],
      }),
    }

    const input: FeedbackRequestInput = {
      workspaceId: mockWorkspaceId,
      filter: {
        topic: 'reservation',
      },
    }

    const result = await processInteractionFeedbackRequest(input, gateway)

    expect(result.totalCount).toBe(2)
    expect(result.filteredCount).toBe(2)
    expect(result.drafts).toHaveLength(2)
    expect(result.drafts[0].targetKind).toBe('comment')
    expect(result.drafts[1].targetKind).toBe('dm')
  })

  it('allows custom draft generation through gateway', async () => {
    const inboxItems: FeedbackInboxItem[] = [
      {
        id: mockCommentId1,
        targetKind: 'comment',
        channel: 'instagram',
        text: '주말 예약 문의드립니다.',
        customerLabel: '고객1',
      },
    ]

    const gateway: FeedbackGateway = {
      loadInbox: vi.fn().mockResolvedValue(inboxItems),
      generateDraftText: vi.fn().mockResolvedValue('커스텀 생성된 예약 답변 초안입니다.'),
    }

    const input: FeedbackRequestInput = {
      workspaceId: mockWorkspaceId,
      filter: { topic: 'reservation' },
    }

    const result = await processInteractionFeedbackRequest(input, gateway)

    expect(gateway.generateDraftText).toHaveBeenCalledWith(inboxItems[0], 'reservation')
    expect(result.drafts[0].draftText).toBe('커스텀 생성된 예약 답변 초안입니다.')
  })
})
