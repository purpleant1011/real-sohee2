import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CustomerConversationService,
  classifyCustomerIntent,
  normalizeSubjectToHash,
} from '../customer-conversation-service'

describe('Customer Identity & Conversation Normalization + Intent Taxonomy (ANI-1215)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const channel = 'instagram'
  const rawSubjectId = 'instagram-user-123456789'
  const actorUserId = '00000000-0000-4000-a000-000000000001'

  let mockConversationsDb: Record<string, any> = {}
  let mockMissionsDb: Record<string, any> = {}

  const mockSupabaseClient = {
    from: (table: string) => {
      if (table === 'customer_conversations') {
        return {
          upsert: vi.fn().mockImplementation((payload: any) => {
            const key = `${payload.workspace_id}:${payload.channel}:${payload.external_subject_reference_hash}`
            const existing = mockConversationsDb[key] || {}
            const item = { ...existing, ...payload, id: existing.id || `conv-${Date.now()}` }
            mockConversationsDb[key] = item
            return {
              select: () => ({
                single: async () => ({ data: item, error: null }),
              }),
            }
          }),
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              maybeSingle: async () => {
                const match = Object.values(mockConversationsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: null }
              },
            }
            return chain
          }),
        }
      }

      if (table === 'marketing_missions') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              single: async () => {
                const match = Object.values(mockMissionsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: null }
              },
              maybeSingle: async () => {
                const match = Object.values(mockMissionsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: null }
              },
            }
            return chain
          }),
          update: vi.fn().mockImplementation((updates: any) => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              select: () => ({
                single: async () => {
                  const match = Object.values(mockMissionsDb).find(r =>
                    filters.every(f => r[f.col] === f.val)
                  )
                  if (match) {
                    Object.assign(match, updates)
                    return { data: match, error: null }
                  }
                  return { data: null, error: new Error('Not found') }
                },
              }),
            }
            return chain
          }),
        }
      }

      if (table === 'mission_events') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  } as any

  beforeEach(() => {
    mockConversationsDb = {}
    mockMissionsDb = {}
  })

  it('1. MUST normalize external subject into strict 64-char SHA256 hex hash', () => {
    const hash = normalizeSubjectToHash(rawSubjectId)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    // Idempotent
    expect(normalizeSubjectToHash(rawSubjectId)).toBe(hash)
  })

  it('2. MUST accurately classify customer intents across the 9-tier taxonomy', () => {
    expect(classifyCustomerIntent('자연눈썹 시술 비용이 어떻게 되나요?').intent).toBe('price')
    expect(classifyCustomerIntent('내일 오후 3시에 예약 가능한가요?').intent).toBe('availability')
    expect(classifyCustomerIntent('자연눈썹 예약하고 싶어요!').intent).toBe('booking_intent')
    expect(classifyCustomerIntent('금요일 2시 예약 확정 부탁드립니다').intent).toBe('booking')
    expect(classifyCustomerIntent('시술 후 관리는 어떻게 하나요?').intent).toBe('inquiry')
    expect(classifyCustomerIntent('원장님 실력 최악이네요 환불해주세요').intent).toBe('complaint')
    expect(classifyCustomerIntent('원장님 실력 최악이네요 환불해주세요').requiresHumanReview).toBe(true)
    expect(classifyCustomerIntent('인스타그램 팔로워 1만명 보장 부업 문의').intent).toBe('spam')
    expect(classifyCustomerIntent('인스타그램 팔로워 1만명 보장 부업 문의').requiresHumanReview).toBe(true)
  })

  it('3. MUST record inbound interaction to customer_conversations and link to mission', async () => {
    const service = new CustomerConversationService(mockSupabaseClient)

    // Prepopulate an active mission in LISTENING state
    const missionId = 'msn-byreum-listening'
    mockMissionsDb[missionId] = {
      id: missionId,
      workspace_id: workspaceId,
      trace_id: 'trc-listening-001',
      status: 'LISTENING',
      goal: '가을 자연눈썹 예약 고객 확보',
      content_id: 'cnt-001',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const conversation = await service.recordCustomerInbound({
      workspaceId,
      channel: 'instagram',
      externalSubjectId: rawSubjectId,
      displayLabel: '인스타 고객',
      messageText: '이번 주 토요일 오후에 자연눈썹 예약하고 싶습니다!',
      relatedContentItemId: 'cnt-001',
      missionId,
      actorUserId,
    })

    expect(conversation.id).toBeDefined()
    expect(conversation.external_subject_reference_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(conversation.intent).toBe('booking_intent')
    expect(conversation.status).toBe('open')
    expect(conversation.related_content_item_id).toBe('cnt-001')

    // Mission status should advance from LISTENING -> CUSTOMER_ENGAGED -> BOOKING_INTENT
    const updatedMission = mockMissionsDb[missionId]
    expect(updatedMission.status).toBe('BOOKING_INTENT')
    expect(updatedMission.customer_id).toBe(conversation.id)
  })
})
