import 'server-only'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { MarketingMissionService } from '@/features/missions/marketing-mission-service'

export type CanonicalCustomerIntent =
  | 'PRICE'
  | 'SERVICE'
  | 'AVAILABILITY'
  | 'BOOKING_INTENT'
  | 'LOCATION'
  | 'AFTERCARE'
  | 'COMPLAINT'
  | 'OTHER'

export type CustomerIntentType =
  | CanonicalCustomerIntent
  | 'inquiry'
  | 'price'
  | 'availability'
  | 'booking_intent'
  | 'booking'
  | 'support'
  | 'complaint'
  | 'spam'
  | 'unknown'

export type HandoffReason =
  | 'LOW_CONFIDENCE'
  | 'COMPLAINT'
  | 'SENSITIVE'
  | 'OUT_OF_POLICY'
  | 'MANUAL_REQUEST'

export interface ClassifiedIntentResult {
  intent: CustomerIntentType
  canonicalIntent: CanonicalCustomerIntent
  legacyIntent: CustomerIntentType
  confidence: number
  requiresHumanReview: boolean
  reason: string
  evidenceSnippet?: string
  handoffReason?: HandoffReason | null
}

export function normalizeSubjectToHash(subjectId: string): string {
  return crypto.createHash('sha256').update(subjectId.trim()).digest('hex')
}

export function classifyCustomerIntent(text: string): ClassifiedIntentResult {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) {
    return {
      intent: 'unknown',
      canonicalIntent: 'OTHER',
      legacyIntent: 'unknown',
      confidence: 0.1,
      requiresHumanReview: true,
      reason: 'Empty message text',
      evidenceSnippet: '',
      handoffReason: 'LOW_CONFIDENCE',
    }
  }

  // 1. Complaint / Negative feedback / Serious complaints (Highest priority, always requires human review)
  const complaintKeywords = [
    '환불', '불만', '최악', '망쳤', '취소해주세요', '고소', '신고', '따질', '불친절',
    '부작용', '상처', '염증', '감염', '흉터', '마비', '아파 죽겠', '책임져'
  ]
  const matchedComplaint = complaintKeywords.find(kw => trimmed.includes(kw))
  if (matchedComplaint) {
    return {
      intent: 'complaint',
      canonicalIntent: 'COMPLAINT',
      legacyIntent: 'complaint',
      confidence: 0.95,
      requiresHumanReview: true,
      reason: 'Detected negative customer feedback, complaint or health risk',
      evidenceSnippet: matchedComplaint,
      handoffReason: 'COMPLAINT',
    }
  }

  // 2. Spam / Solicitation / Out of policy
  const spamKeywords = ['팔로워', '부업', '홍보대행', '수익보장', '선팔', '맞팔', '계정구매', '코인']
  const matchedSpam = spamKeywords.find(kw => trimmed.includes(kw))
  if (matchedSpam) {
    return {
      intent: 'spam',
      canonicalIntent: 'OTHER',
      legacyIntent: 'spam',
      confidence: 0.9,
      requiresHumanReview: true,
      reason: 'Detected marketing solicitation or spam pattern',
      evidenceSnippet: matchedSpam,
      handoffReason: 'OUT_OF_POLICY',
    }
  }

  // 3. Booking Intent & Concrete booking confirmation
  const bookingConfirmKeywords = ['예약 확정', '예약할게요', '확정 부탁', '확정해주세요', '그 시간으로 해주세요']
  const matchedConfirm = bookingConfirmKeywords.find(kw => trimmed.includes(kw))
  if (matchedConfirm) {
    return {
      intent: 'booking',
      canonicalIntent: 'BOOKING_INTENT',
      legacyIntent: 'booking',
      confidence: 0.92,
      requiresHumanReview: false,
      reason: 'Explicit customer request to confirm specific booking slot',
      evidenceSnippet: matchedConfirm,
      handoffReason: null,
    }
  }

  const bookingIntentKeywords = ['예약하고 싶', '예약 원해', '예약 부탁', '예약 문의', '상담받고 싶', '시술받고 싶']
  const matchedBooking = bookingIntentKeywords.find(kw => trimmed.includes(kw))
  if (matchedBooking) {
    return {
      intent: 'booking_intent',
      canonicalIntent: 'BOOKING_INTENT',
      legacyIntent: 'booking_intent',
      confidence: 0.9,
      requiresHumanReview: false,
      reason: 'Customer expressed intent to book a procedure',
      evidenceSnippet: matchedBooking,
      handoffReason: null,
    }
  }

  // 4. Availability inquiry (check specific appointment schedule / open slots)
  const availabilityKeywords = [
    '가능한 시간', '비어있', '언제 되', '몇 시에', '자리 있', '예약 가능한', '예약 가능해', '예약 가능할', '비는 시간', '예약 스케줄'
  ]
  const matchedAvailability = availabilityKeywords.find(kw => trimmed.includes(kw))
  if (matchedAvailability) {
    return {
      intent: 'availability',
      canonicalIntent: 'AVAILABILITY',
      legacyIntent: 'availability',
      confidence: 0.88,
      requiresHumanReview: false,
      reason: 'Customer inquiring about open appointment schedule slots',
      evidenceSnippet: matchedAvailability,
      handoffReason: null,
    }
  }

  // 5. Service / Procedure specifications & duration (Check BEFORE price to avoid '얼마나 걸려' matching '얼마')
  const serviceKeywords = ['시술 시간', '얼마나 걸려', '소요시간', '자연눈썹이랑', '콤보눈썹', '섀도우눈썹', '엠보눈썹', '속눈썹 펌', '속눈썹 연장', '기법', '아픈가요']
  const matchedService = serviceKeywords.find(kw => trimmed.includes(kw))
  if (matchedService) {
    return {
      intent: 'inquiry',
      canonicalIntent: 'SERVICE',
      legacyIntent: 'inquiry',
      confidence: 0.88,
      requiresHumanReview: false,
      reason: 'Customer inquiring about specific procedure techniques, options, or duration',
      evidenceSnippet: matchedService,
      handoffReason: null,
    }
  }

  // 6. Price / Cost inquiry (Exclude '얼마나' which is duration/time)
  const priceKeywords = ['가격', '비용', '할인', '이벤트가', '금액', '추가요금']
  const hasPriceWord = priceKeywords.some(kw => trimmed.includes(kw)) || (trimmed.includes('얼마') && !trimmed.includes('얼마나'))
  if (hasPriceWord) {
    const snippet = priceKeywords.find(kw => trimmed.includes(kw)) || '얼마'
    return {
      intent: 'price',
      canonicalIntent: 'PRICE',
      legacyIntent: 'price',
      confidence: 0.92,
      requiresHumanReview: false,
      reason: 'Customer inquiring about procedure pricing or promotions',
      evidenceSnippet: snippet,
      handoffReason: null,
    }
  }

  // 7. Aftercare / Maintenance inquiry
  const aftercareKeywords = ['관리법', '탈각', '세안', '씻어도', '리터치', '재생크림', '주의사항', '딱지', '물 닿아도', '사후관리']
  const matchedAftercare = aftercareKeywords.find(kw => trimmed.includes(kw))
  if (matchedAftercare) {
    return {
      intent: 'inquiry',
      canonicalIntent: 'AFTERCARE',
      legacyIntent: 'inquiry',
      confidence: 0.9,
      requiresHumanReview: false,
      reason: 'Customer inquiring about procedure aftercare and post-treatment maintenance',
      evidenceSnippet: matchedAftercare,
      handoffReason: null,
    }
  }

  // 8. Location / Direction inquiry
  const locationKeywords = ['위치', '주소', '어디', '역 출구', '주차', '찾아가는', '길', '지도']
  const matchedLocation = locationKeywords.find(kw => trimmed.includes(kw))
  if (matchedLocation) {
    return {
      intent: 'support',
      canonicalIntent: 'LOCATION',
      legacyIntent: 'support',
      confidence: 0.9,
      requiresHumanReview: false,
      reason: 'Customer inquiring about salon location, parking, or directions',
      evidenceSnippet: matchedLocation,
      handoffReason: null,
    }
  }

  // 9. General procedure questions
  const generalInquiryKeywords = ['어떻게', '관리', '유지기간']
  const matchedGeneral = generalInquiryKeywords.find(kw => trimmed.includes(kw))
  if (matchedGeneral) {
    return {
      intent: 'inquiry',
      canonicalIntent: 'SERVICE',
      legacyIntent: 'inquiry',
      confidence: 0.8,
      requiresHumanReview: false,
      reason: 'General inquiry about salon or service details',
      evidenceSnippet: matchedGeneral,
      handoffReason: null,
    }
  }

  return {
    intent: 'unknown',
    canonicalIntent: 'OTHER',
    legacyIntent: 'unknown',
    confidence: 0.5,
    requiresHumanReview: true,
    reason: 'Unclassified low-confidence interaction pattern',
    evidenceSnippet: trimmed.slice(0, 50),
    handoffReason: 'LOW_CONFIDENCE',
  }
}

export interface RecordCustomerInboundParams {
  workspaceId: string
  channel: 'instagram' | 'threads' | 'naver_blog' | 'naver_place'
  externalSubjectId: string
  displayLabel: string
  messageText: string
  relatedContentItemId?: string | null
  missionId?: string | null
  actorUserId?: string
}

export interface CanonicalCustomerConversationRecord {
  id: string
  workspace_id: string
  channel: string
  external_subject_reference_hash: string
  display_label: string
  status: string
  intent: string
  summary: string
  latest_message_at: string
  related_content_item_id?: string | null
  booking_id?: string | null
  requires_human_review: boolean
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export class CustomerConversationService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  public async recordCustomerInbound(
    params: RecordCustomerInboundParams
  ): Promise<CanonicalCustomerConversationRecord> {
    const {
      workspaceId,
      channel,
      externalSubjectId,
      displayLabel,
      messageText,
      relatedContentItemId = null,
      missionId = null,
      actorUserId = '00000000-0000-4000-a000-000000000001',
    } = params

    const hash = normalizeSubjectToHash(externalSubjectId)
    const classification = classifyCustomerIntent(messageText)
    const now = new Date().toISOString()
    const summary = messageText.slice(0, 500)

    const payload = {
      workspace_id: workspaceId,
      channel,
      external_subject_reference_hash: hash,
      display_label: displayLabel.slice(0, 120),
      status: classification.requiresHumanReview ? 'needs_attention' : 'open',
      intent: classification.intent,
      summary: summary || '신규 인바운드 고객 문의',
      latest_message_at: now,
      related_content_item_id: relatedContentItemId,
      requires_human_review: classification.requiresHumanReview,
      created_by_user_id: actorUserId,
      updated_at: now,
    }

    const { data: conversation, error: convError } = await (this.client as any)
      .from('customer_conversations')
      .upsert(payload, { onConflict: 'workspace_id,channel,external_subject_reference_hash' })
      .select()
      .single()

    if (convError || !conversation) {
      throw new Error(`[CUSTOMER_CONVERSATION_FAILED] ${convError?.message || 'Failed to upsert conversation'}`)
    }

    // Advance Marketing Mission state if linked to an active mission
    if (missionId) {
      try {
        const missionService = new MarketingMissionService(this.client)
        const { data: mission } = await (this.client as any)
          .from('marketing_missions')
          .select('*')
          .eq('id', missionId)
          .eq('workspace_id', workspaceId)
          .maybeSingle()

        if (mission) {
          let currentStatus = mission.status
          const traceId = mission.trace_id || `trc-inbound-${Date.now()}`

          // If mission is LISTENING, move to CUSTOMER_ENGAGED
          if (currentStatus === 'LISTENING') {
            const updated = await missionService.transitionMission({
              workspaceId,
              missionId,
              traceId,
              toStatus: 'CUSTOMER_ENGAGED',
              actorType: 'system',
              reason: '고객 인바운드 반응 감지 및 첫 대화 시작',
              downstreamUpdates: { customer_id: conversation.id },
            })
            currentStatus = updated.status
          }

          // If customer has booking intent, advance to BOOKING_INTENT
          const isBookingIntent =
            classification.intent === 'BOOKING_INTENT' ||
            classification.legacyIntent === 'booking_intent' ||
            classification.legacyIntent === 'booking'

          if (isBookingIntent && currentStatus === 'CUSTOMER_ENGAGED') {
            await missionService.transitionMission({
              workspaceId,
              missionId,
              traceId,
              toStatus: 'BOOKING_INTENT',
              actorType: 'system',
              reason: '고객 예약 의사 감지 (슬롯 조율 단계)',
              downstreamUpdates: { customer_id: conversation.id },
            })
          } else {
            await missionService.bindCustomerAndBooking({
              workspaceId,
              missionId,
              traceId,
              customerId: conversation.id,
              actorType: 'system',
              reason: 'Bind inbound customer conversation ID',
            })
          }
        }
      } catch (mErr) {
        console.warn('[CustomerConversationService] Non-fatal mission state advance warning:', mErr)
      }
    }

    return conversation as CanonicalCustomerConversationRecord
  }

  /**
   * Retrieves conversations for a workspace grouped into the 4 commercial customer queues:
   * 1. needsReply: open inquiries that can be responded to safely
   * 2. bookingOpportunity: customer showing availability/booking interest
   * 3. confirmedBooking: booking already confirmed or linked
   * 4. humanReview: inquiries requiring human review/escalation
   */
  public async getWorkspaceCustomerQueues(workspaceId: string): Promise<{
    needsReply: CanonicalCustomerConversationRecord[]
    bookingOpportunity: CanonicalCustomerConversationRecord[]
    confirmedBooking: CanonicalCustomerConversationRecord[]
    humanReview: CanonicalCustomerConversationRecord[]
  }> {
    const { data: rows, error } = await (this.client as any)
      .from('customer_conversations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('latest_message_at', { ascending: false })

    if (error || !Array.isArray(rows)) {
      throw new Error(`[CUSTOMER_QUEUES_QUERY_FAILED] ${error?.message ?? 'no row list'}`)
    }

    const conversations: CanonicalCustomerConversationRecord[] = rows

    const humanReview: CanonicalCustomerConversationRecord[] = []
    const confirmedBooking: CanonicalCustomerConversationRecord[] = []
    const bookingOpportunity: CanonicalCustomerConversationRecord[] = []
    const needsReply: CanonicalCustomerConversationRecord[] = []

    for (const conv of conversations) {
      if (conv.requires_human_review || conv.status === 'needs_attention') {
        humanReview.push(conv)
      } else if (conv.status === 'confirmed' || conv.booking_id) {
        confirmedBooking.push(conv)
      } else if (
        conv.intent === 'BOOKING_INTENT' ||
        conv.intent === 'AVAILABILITY' ||
        conv.intent === 'booking_intent' ||
        conv.intent === 'availability'
      ) {
        bookingOpportunity.push(conv)
      } else {
        needsReply.push(conv)
      }
    }

    return {
      needsReply,
      bookingOpportunity,
      confirmedBooking,
      humanReview,
    }
  }
}

