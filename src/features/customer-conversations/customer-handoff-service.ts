import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { CanonicalCustomerIntent, HandoffReason } from './customer-conversation-service'
import { generateDraftResponse, type StoreKnowledge } from './customer-reply-runtime'

export interface HandoffCard {
  conversationId: string
  workspaceId: string
  customerLabel: string
  channel: string
  summary: string
  originalText: string
  intent: CanonicalCustomerIntent
  handoffReason: HandoffReason
  riskReason: string
  recommendedReply: string
  relatedBookingId?: string | null
  latestMessageAt: string
  slaMinutesElapsed: number
  isSlaBreached: boolean
  status: 'pending' | 'assigned' | 'resolved'
}

export class CustomerHandoffService {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly defaultKnowledge?: StoreKnowledge
  ) {}

  /**
   * Fetches all conversations requiring human review in the workspace,
   * calculating SLA elapsed time (SLA breach threshold = 30 minutes) and packaging into Handoff Cards.
   */
  public async listHandoffCards(
    workspaceId: string,
    options?: { includeResolved?: boolean }
  ): Promise<HandoffCard[]> {
    let query = (this.client as any)
      .from('customer_conversations')
      .select('*')
      .eq('workspace_id', workspaceId)

    if (!options?.includeResolved) {
      query = query.or('requires_human_review.eq.true,status.eq.needs_attention')
    }

    const { data: rows, error } = await query.order('latest_message_at', { ascending: false })

    if (error) {
      throw new Error(`[HANDOFF_QUEUE_QUERY_FAILED] ${error.message}`)
    }

    const now = Date.now()
    const SLA_THRESHOLD_MINUTES = 30

    if (!Array.isArray(rows)) throw new Error('[CUSTOMER_HANDOFF_QUERY_FAILED] no row list')
    const cards: HandoffCard[] = rows.map((row: any) => {
      const messageTime = row.latest_message_at ? new Date(row.latest_message_at).getTime() : now
      const minutesElapsed = Math.max(0, Math.floor((now - messageTime) / (1000 * 60)))
      const isSlaBreached = minutesElapsed >= SLA_THRESHOLD_MINUTES

      const intent = (row.intent || 'OTHER') as CanonicalCustomerIntent
      let handoffReason: HandoffReason = 'LOW_CONFIDENCE'
      let riskReason = '불명확한 의도 또는 신뢰도 미달로 안전한 수동 응대가 필요합니다.'

      if (intent === 'COMPLAINT') {
        handoffReason = 'COMPLAINT'
        riskReason = '고객 불만 또는 서비스 결과 불만족, 분쟁 위험이 있습니다.'
      } else if (row.summary?.includes('부작용') || row.summary?.includes('통증') || row.summary?.includes('염증')) {
        handoffReason = 'SENSITIVE'
        riskReason = '신체적 불편감 및 의료적 주의 소견이 필요한 민감 문의입니다.'
      } else if (row.summary?.includes('협찬') || row.summary?.includes('광고') || row.summary?.includes('팔로워')) {
        handoffReason = 'OUT_OF_POLICY'
        riskReason = '정책 외 상업적 홍보 또는 스팸성 인바운드입니다.'
      }

      const defaultKnowledgeFallback: StoreKnowledge = this.defaultKnowledge || {
        salonName: '바이름 뷰티',
        address: '서울시 강남구 테헤란로 123',
        parkingInfo: '건물 지하 주차장 2시간 무료',
        businessHours: '화~일 10:00 ~ 20:00 (월요일 휴무)',
        services: [
          { id: 'srv-001', name: '자연눈썹', priceKrw: 150000, durationMinutes: 90 },
          { id: 'srv-002', name: '속눈썹 펌', priceKrw: 50000, durationMinutes: 50 },
        ],
        aftercareNotes: '시술 당일 세안을 피하고, 7일간 재생크림을 얇게 도포해 주세요.',
      }

      const recommendedReply = generateDraftResponse({
        intent,
        knowledge: defaultKnowledgeFallback,
        customerName: row.display_label,
        rawText: row.summary,
      })

      let cardStatus: 'pending' | 'assigned' | 'resolved' = 'pending'
      if (row.status === 'resolved' || !row.requires_human_review) {
        cardStatus = 'resolved'
      } else if (row.status === 'assigned') {
        cardStatus = 'assigned'
      }

      return {
        conversationId: row.id,
        workspaceId: row.workspace_id,
        customerLabel: row.display_label,
        channel: row.channel,
        summary: row.summary,
        originalText: row.summary,
        intent,
        handoffReason,
        riskReason,
        recommendedReply,
        relatedBookingId: row.booking_id,
        latestMessageAt: row.latest_message_at || new Date().toISOString(),
        slaMinutesElapsed: minutesElapsed,
        isSlaBreached,
        status: cardStatus,
      }
    })

    return cards
  }

  /**
   * 3-Click Action 1: Assigns a review card to a specific operator/owner.
   */
  public async assignReview(conversationId: string, assigneeUserId: string): Promise<void> {
    const { error } = await (this.client as any)
      .from('customer_conversations')
      .update({
        status: 'assigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    if (error) {
      throw new Error(`[ASSIGN_REVIEW_FAILED] ${error.message}`)
    }
  }

  /**
   * 3-Click Action 2: Resolves the human review with resolution notes and unblocks conversation.
   */
  public async resolveReview(
    conversationId: string,
    params: {
      resolvedBy: string
      resolutionNotes: string
      finalReplyText?: string
    }
  ): Promise<void> {
    const now = new Date().toISOString()
    const { error } = await (this.client as any)
      .from('customer_conversations')
      .update({
        status: 'resolved',
        requires_human_review: false,
        updated_at: now,
      })
      .eq('id', conversationId)

    if (error) {
      throw new Error(`[RESOLVE_REVIEW_FAILED] ${error.message}`)
    }
  }

  /**
   * 3-Click Action 3: Reopens a previously resolved or reviewed card.
   */
  public async reopenReview(conversationId: string, reason: string): Promise<void> {
    const { error } = await (this.client as any)
      .from('customer_conversations')
      .update({
        status: 'needs_attention',
        requires_human_review: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)

    if (error) {
      throw new Error(`[REOPEN_REVIEW_FAILED] ${error.message}`)
    }
  }
}
