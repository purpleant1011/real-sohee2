import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMetaWebhookEventStore } from '@/features/meta-webhooks/event-store'
import type { NormalizedMetaEvent } from '@/features/meta-webhooks/handler'
import {
  CustomerConversationService,
  classifyCustomerIntent,
  normalizeSubjectToHash,
} from '@/features/customer-conversations/customer-conversation-service'
import {
  CustomerReplyRuntime,
  evaluateCustomerReplyPolicy,
  generateDraftResponse,
  type StoreKnowledge,
} from '@/features/customer-conversations/customer-reply-runtime'
import {
  CustomerHandoffService,
} from '@/features/customer-conversations/customer-handoff-service'

describe('V0.91 Wave 3 · Customer Conversation & Response Pipeline (ANI-1245, ANI-1246, ANI-1247, ANI-1250)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const connectionId = 'conn-byreum-insta-001'
  const externalAccountId = 'insta-act-byreum-official'

  const mockKnowledge: StoreKnowledge = {
    salonName: '바이름 뷰티 스튜디오',
    address: '서울시 강남구 테헤란로 123 4층',
    parkingInfo: '건물 지하 주차장 2시간 무료 지원',
    businessHours: '화~일 10:00 ~ 20:00 (월요일 정기휴무)',
    services: [
      { id: 'srv-001', name: '자연눈썹', priceKrw: 150000, durationMinutes: 90 },
      { id: 'srv-002', name: '콤보눈썹', priceKrw: 180000, durationMinutes: 100 },
      { id: 'srv-003', name: '속눈썹 펌', priceKrw: 50000, durationMinutes: 50 },
    ],
    aftercareNotes: '시술 당일은 세안을 피하고, 1주일간 아침저녁으로 재생크림을 얇게 펴발라주세요.',
  }

  let mockEventsDb: Record<string, any> = {}
  let mockConversationsDb: Record<string, any> = {}
  let mockResponseJobsDb: Record<string, any> = {}

  beforeEach(() => {
    mockEventsDb = {}
    mockConversationsDb = {}
    mockResponseJobsDb = {}
  })

  // --------------------------------------------------------------------------
  // 1. ANI-1245: Meta Webhook Ingress, Same-Name UUID Mapping & Idempotency
  // --------------------------------------------------------------------------
  describe('1. ANI-1245: Meta Webhook Ingress & Workspace Routing', () => {
    it('MUST route strictly by connection workspace_id UUID, bind inbound_event_id, and prevent duplicate ingestion', async () => {
      let savedResponseJob: any = null

      const mockGateway = {
        findConnection: vi.fn().mockImplementation(async (provider, actId) => {
          if (actId === externalAccountId) {
            // Same-Name regression guard: always returns immutable workspace_id UUID
            return { data: { id: connectionId, workspace_id: workspaceId }, error: null }
          }
          return { data: null, error: new Error('NOT_FOUND') }
        }),
        insertEvent: vi.fn().mockImplementation(async (row) => {
          const key = `${row.workspace_id}:${row.event_key}`
          if (mockEventsDb[key]) {
            return { data: { id: mockEventsDb[key].id }, error: null }
          }
          const item = { ...row, id: `evt-uuid-${Date.now()}` }
          mockEventsDb[key] = item
          return { data: { id: item.id }, error: null }
        }),
        updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
        insertResponseJob: vi.fn().mockImplementation(async (row) => {
          savedResponseJob = row
          mockResponseJobsDb[row.idempotency_key] = row
          return { data: { id: 'job-1' }, error: null }
        }),
        findMissionByPostReference: vi.fn().mockResolvedValue({
          data: { id: 'msn-byreum-target', content_id: 'cnt-post-777' },
          error: null,
        }),
        recordCustomerConversation: vi.fn().mockResolvedValue({
          data: { id: 'conv-001' },
          error: null,
        }),
      }

      const store = await createMetaWebhookEventStore(mockGateway as any)

      const event: NormalizedMetaEvent = {
        provider: 'instagram',
        category: 'comment',
        eventKey: 'instagram:comment:cmnt-1001',
        providerEventId: 'cmnt-1001',
        externalAccountId,
        instagramAccountId: externalAccountId,
        externalSubjectId: 'customer-user-111',
        providerPostReference: 'media-post-999',
        payload: {
          id: 'cmnt-1001',
          text: '자연눈썹 시술 비용이 어떻게 되나요?',
          from: { id: 'customer-user-111', username: 'lovely_customer' },
        },
        payloadSha256: 'sha256-hash-cmnt-1001',
        occurredAt: '2026-09-10T12:00:00.000Z',
      }

      // First ingestion
      await store.record([event])

      expect(mockGateway.findConnection).toHaveBeenCalledWith('instagram', externalAccountId)
      expect(mockGateway.insertEvent).toHaveBeenCalledTimes(1)
      expect(mockGateway.recordCustomerConversation).toHaveBeenCalledTimes(1)
      expect(savedResponseJob).toBeDefined()
      expect(savedResponseJob.workspace_id).toBe(workspaceId)
      expect(savedResponseJob.inbound_event_id).toMatch(/^evt-uuid-/)
      expect(savedResponseJob.response_kind).toBe('instagram_comment_reply')

      // Second ingestion (Idempotency test)
      await store.record([event])
      // Events DB count must still be 1
      expect(Object.keys(mockEventsDb).length).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // 2. ANI-1246: Customer Identity Normalization & 8-Tier Canonical Taxonomy
  // --------------------------------------------------------------------------
  describe('2. ANI-1246: Customer Identity Normalization & 8-Tier Intent Taxonomy', () => {
    it('MUST hash subject into 64-char SHA256 and accurately classify the 8 Canonical Intents', () => {
      const subjectHash = normalizeSubjectToHash('instagram-user-8888')
      expect(subjectHash).toMatch(/^[a-f0-9]{64}$/)

      // 8 Canonical Intents
      expect(classifyCustomerIntent('자연눈썹 가격이랑 비용 얼마인가요?').canonicalIntent).toBe('PRICE')
      expect(classifyCustomerIntent('자연눈썹이랑 콤보눈썹 시술 시간 얼마나 걸려요?').canonicalIntent).toBe('SERVICE')
      expect(classifyCustomerIntent('이번 주 금요일 오후에 예약 가능한 시간 있나요?').canonicalIntent).toBe('AVAILABILITY')
      expect(classifyCustomerIntent('내일 2시로 예약하고 싶습니다!').canonicalIntent).toBe('BOOKING_INTENT')
      expect(classifyCustomerIntent('매장 위치가 어디인가요? 주차 가능한가요?').canonicalIntent).toBe('LOCATION')
      expect(classifyCustomerIntent('시술 후에 세안이나 탈각 관리법 어떻게 되나요?').canonicalIntent).toBe('AFTERCARE')
      expect(classifyCustomerIntent('눈썹이 짝짝이로 망쳤어요. 환불해주세요.').canonicalIntent).toBe('COMPLAINT')
      expect(classifyCustomerIntent('눈썹이 짝짝이로 망쳤어요. 환불해주세요.').requiresHumanReview).toBe(true)
      expect(classifyCustomerIntent('팔로워 늘려드립니다 수익보장').canonicalIntent).toBe('OTHER')
      expect(classifyCustomerIntent('팔로워 늘려드립니다 수익보장').requiresHumanReview).toBe(true)
    })

    it('MUST group customer conversations into the 4 commercial work queues correctly', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'customer_conversations') {
            return {
              select: () => ({
                eq: () => ({
                  order: async () => ({
                    data: [
                      { id: 'c1', display_label: '고객1', intent: 'PRICE', status: 'open', requires_human_review: false },
                      { id: 'c2', display_label: '고객2', intent: 'BOOKING_INTENT', status: 'open', requires_human_review: false },
                      { id: 'c3', display_label: '고객3', intent: 'BOOKING_INTENT', status: 'confirmed', booking_id: 'bk-1', requires_human_review: false },
                      { id: 'c4', display_label: '고객4', intent: 'COMPLAINT', status: 'needs_attention', requires_human_review: true },
                    ],
                    error: null,
                  }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      } as any

      const service = new CustomerConversationService(mockSupabase)
      const queues = await service.getWorkspaceCustomerQueues(workspaceId)

      expect(queues.needsReply.length).toBe(1)
      expect(queues.needsReply[0].id).toBe('c1')

      expect(queues.bookingOpportunity.length).toBe(1)
      expect(queues.bookingOpportunity[0].id).toBe('c2')

      expect(queues.confirmedBooking.length).toBe(1)
      expect(queues.confirmedBooking[0].id).toBe('c3')

      expect(queues.humanReview.length).toBe(1)
      expect(queues.humanReview[0].id).toBe('c4')
    })
  })

  // --------------------------------------------------------------------------
  // 3. ANI-1247: Safe Auto-Response Runtime & Zero External Sent for Risks
  // --------------------------------------------------------------------------
  describe('3. ANI-1247: Customer Reply Policy & Safe Auto-Response Runtime', () => {
    it('MUST allow autonomous response for low-risk inquiries with factual knowledge grounded draft', () => {
      const locationEval = evaluateCustomerReplyPolicy({
        intent: 'LOCATION',
        confidence: 0.92,
        text: '위치가 어디인가요? 주차 되나요?',
        requiresHumanReview: false,
      })

      expect(locationEval.action).toBe('AUTONOMOUS_ALLOWED')
      expect(locationEval.riskTier).toBe('LOW')

      const draft = generateDraftResponse({
        intent: 'LOCATION',
        knowledge: mockKnowledge,
        customerName: '민지',
      })

      expect(draft).toContain(mockKnowledge.salonName)
      expect(draft).toContain(mockKnowledge.address)
      expect(draft).toContain(mockKnowledge.parkingInfo)
    })

    it('MUST strictly block external delivery (0 sends) and escalate COMPLAINT/Medical risks to human review', async () => {
      const complaintEval = evaluateCustomerReplyPolicy({
        intent: 'COMPLAINT',
        confidence: 0.95,
        text: '시술 부위가 염증나고 심하게 부었어요. 환불해주세요.',
        requiresHumanReview: true,
      })

      expect(complaintEval.action).toBe('HUMAN_REVIEW_REQUIRED')
      expect(complaintEval.riskTier).toBe('HIGH')
      expect(complaintEval.requiresEscalation).toBe(true)

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'channel_response_jobs') {
            return {
              upsert: vi.fn().mockImplementation((job) => ({
                select: () => ({
                  single: async () => ({ data: { ...job, id: 'resp-job-complaint' }, error: null }),
                }),
              })),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      } as any

      const runtime = new CustomerReplyRuntime(mockSupabase)
      const result = await runtime.processInboundResponse({
        workspaceId,
        channelConnectionId: connectionId,
        inboundEventId: 'evt-complaint-001',
        responseKind: 'instagram_dm',
        externalTargetId: 'user-complaining',
        intent: 'COMPLAINT',
        confidence: 0.95,
        inboundText: '시술 부위가 염증나고 심하게 부었어요. 환불해주세요.',
        requiresHumanReview: true,
        knowledge: mockKnowledge,
      })

      expect(result.action).toBe('HUMAN_REVIEW_REQUIRED')
      expect(result.status).toBe('human_review')
      expect(result.externalSent).toBe(false) // ZERO EXTERNAL SENDS!
    })
  })

  // --------------------------------------------------------------------------
  // 4. ANI-1250: Human Review Queue, 30-Minute SLA & 3-Click Actions
  // --------------------------------------------------------------------------
  describe('4. ANI-1250: Human Review Queue & 3-Click SLA Handoff', () => {
    it('MUST package handoff cards, calculate 30-minute SLA breach, and support assign/resolve/reopen lifecycle', async () => {
      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString()
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

      const conv1 = {
        id: 'conv-breached',
        workspace_id: workspaceId,
        channel: 'instagram',
        display_label: '불만고객',
        summary: '부작용이 생겼습니다. 책임져주세요.',
        intent: 'COMPLAINT',
        requires_human_review: true,
        status: 'needs_attention',
        latest_message_at: fortyMinutesAgo,
      }

      const conv2 = {
        id: 'conv-healthy',
        workspace_id: workspaceId,
        channel: 'threads',
        display_label: '일반질문',
        summary: '협찬 제휴 문의드립니다.',
        intent: 'OTHER',
        requires_human_review: true,
        status: 'needs_attention',
        latest_message_at: tenMinutesAgo,
      }

      mockConversationsDb = {
        'conv-breached': { ...conv1 },
        'conv-healthy': { ...conv2 },
      }

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'customer_conversations') {
            return {
              select: () => ({
                eq: () => ({
                  or: () => ({
                    order: async () => ({
                      data: Object.values(mockConversationsDb),
                      error: null,
                    }),
                  }),
                }),
              }),
              update: vi.fn().mockImplementation((updates) => ({
                eq: (_col: string, val: string) => {
                  if (mockConversationsDb[val]) {
                    Object.assign(mockConversationsDb[val], updates)
                    return { error: null }
                  }
                  return { error: new Error('Not found') }
                },
              })),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      } as any

      const handoffService = new CustomerHandoffService(mockSupabase, mockKnowledge)

      // 1. List cards & SLA breach verification
      const cards = await handoffService.listHandoffCards(workspaceId)
      expect(cards.length).toBe(2)

      const breachedCard = cards.find(c => c.conversationId === 'conv-breached')!
      expect(breachedCard.isSlaBreached).toBe(true) // >= 30 mins
      expect(breachedCard.handoffReason).toBe('COMPLAINT')
      expect(breachedCard.recommendedReply).toBeDefined()

      const healthyCard = cards.find(c => c.conversationId === 'conv-healthy')!
      expect(healthyCard.isSlaBreached).toBe(false) // < 30 mins

      // 2. Action 1: Assign Review
      await handoffService.assignReview('conv-breached', 'user-manager-001')
      expect(mockConversationsDb['conv-breached'].status).toBe('assigned')

      // 3. Action 2: Resolve Review
      await handoffService.resolveReview('conv-breached', {
        resolvedBy: 'user-manager-001',
        resolutionNotes: '고객님과 유선 통화 후 재방문 리터치 일정 확정',
      })
      expect(mockConversationsDb['conv-breached'].status).toBe('resolved')
      expect(mockConversationsDb['conv-breached'].requires_human_review).toBe(false)

      // 4. Action 3: Reopen Review
      await handoffService.reopenReview('conv-breached', '추가 증상 발현으로 재검토 필요')
      expect(mockConversationsDb['conv-breached'].status).toBe('needs_attention')
      expect(mockConversationsDb['conv-breached'].requires_human_review).toBe(true)
    })
  })
})
