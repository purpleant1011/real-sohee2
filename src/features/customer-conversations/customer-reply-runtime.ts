import 'server-only'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { CanonicalCustomerIntent } from './customer-conversation-service'

export type CustomerReplyPolicyAction =
  | 'AUTONOMOUS_ALLOWED'
  | 'WAITING_FOR_APPROVAL'
  | 'HUMAN_REVIEW_REQUIRED'

export interface StoreKnowledge {
  salonName: string
  address: string
  parkingInfo: string
  businessHours: string
  services: Array<{
    id: string
    name: string
    priceKrw: number
    durationMinutes: number
  }>
  aftercareNotes: string
}

export interface ReplyPolicyEvaluation {
  action: CustomerReplyPolicyAction
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH'
  reason: string
  requiresEscalation: boolean
}

const SENSITIVE_MEDICAL_LEGAL_KEYWORDS = [
  '환불', '취소', '고소', '신고', '배상', '보상', '경찰', '소송',
  '부작용', '통증', '염증', '감염', '흉터', '마비', '알레르기', '괴사', '병원', '피부과', '진단서'
]

/**
 * Evaluates whether an inbound customer message can be answered autonomously by Sohee,
 * requires owner approval before sending, or must be escalated to human review immediately.
 */
export function evaluateCustomerReplyPolicy(params: {
  intent: CanonicalCustomerIntent
  confidence: number
  text: string
  requiresHumanReview: boolean
}): ReplyPolicyEvaluation {
  const { intent, confidence, text, requiresHumanReview } = params
  const trimmed = text.trim().toLowerCase()

  // 1. High Risk & Escalation triggers (COMPLAINT, SENSITIVE medical/legal, or explicit human review requirement)
  if (requiresHumanReview || intent === 'COMPLAINT') {
    return {
      action: 'HUMAN_REVIEW_REQUIRED',
      riskTier: 'HIGH',
      reason: '고객 불만 또는 신체적 이상/분쟁 가능성이 감지되어 대표자 직접 검토가 필요합니다.',
      requiresEscalation: true,
    }
  }

  const sensitiveMatch = SENSITIVE_MEDICAL_LEGAL_KEYWORDS.find(kw => trimmed.includes(kw))
  if (sensitiveMatch) {
    return {
      action: 'HUMAN_REVIEW_REQUIRED',
      riskTier: 'HIGH',
      reason: `의료적 주의 또는 법적 위험 키워드('${sensitiveMatch}') 감지로 자동 발송이 전면 차단되었습니다.`,
      requiresEscalation: true,
    }
  }

  if (confidence < 0.70) {
    return {
      action: 'HUMAN_REVIEW_REQUIRED',
      riskTier: 'HIGH',
      reason: `의도 분류 신뢰도(${Math.round(confidence * 100)}%)가 안전 기준치(70%) 미달하여 사람 검토로 격리합니다.`,
      requiresEscalation: true,
    }
  }

  // 2. Medium Risk: Booking and Schedule coordination requires owner awareness/conditional confirmation
  if (intent === 'BOOKING_INTENT' || intent === 'AVAILABILITY') {
    return {
      action: 'WAITING_FOR_APPROVAL',
      riskTier: 'MEDIUM',
      reason: '예약 슬롯 제안 및 확정 절차는 매장 스케줄 안전을 위해 승인 또는 확인 절차를 거칩니다.',
      requiresEscalation: false,
    }
  }

  // 3. Low Risk: General knowledge-backed inquiries (PRICE, LOCATION, SERVICE, AFTERCARE)
  return {
    action: 'AUTONOMOUS_ALLOWED',
    riskTier: 'LOW',
    reason: '검증된 매장 기초 정보(위치, 가격, 서비스 안내, 사후관리)에 기반한 안전한 자동 응대입니다.',
    requiresEscalation: false,
  }
}

/**
 * Generates an accurate, professional, knowledge-grounded draft response in Korean.
 * Strictly prevents hallucinations by adhering only to provided StoreKnowledge.
 */
export function generateDraftResponse(params: {
  intent: CanonicalCustomerIntent
  knowledge: StoreKnowledge
  customerName?: string
  rawText?: string
}): string {
  const { intent, knowledge, customerName } = params
  const greeting = customerName ? `안녕하세요, ${customerName} 고객님!` : '안녕하세요 고객님!'
  const brand = knowledge.salonName

  switch (intent) {
    case 'LOCATION': {
      return `${greeting} ${brand}입니다. 😊\n\n저희 매장 위치는 '${knowledge.address}'입니다.\n주차: ${knowledge.parkingInfo}\n영업시간: ${knowledge.businessHours}\n\n방문 시 도움이 필요하시면 언제든 말씀해 주세요!`
    }
    case 'PRICE': {
      const priceList = knowledge.services
        .map(s => `• ${s.name}: ${s.priceKrw.toLocaleString('ko-KR')}원 (소요시간 약 ${s.durationMinutes}분)`)
        .join('\n')
      return `${greeting} ${brand} 서비스 가격 안내드립니다. ✨\n\n${priceList}\n\n궁금하신 서비스가 있으시면 편하게 문의해 주세요!`
    }
    case 'AFTERCARE': {
      return `${greeting} ${brand} 이용 후 관리 방법 안내드립니다. 🌿\n\n${knowledge.aftercareNotes}\n\n건강하고 편안한 유지를 위해 안내사항을 꼭 지켜주세요!`
    }
    case 'SERVICE': {
      const serviceList = knowledge.services
        .map(s => `• ${s.name} (소요시간 약 ${s.durationMinutes}분)`)
        .join('\n')
      return `${greeting} ${brand} 서비스 프로그램 안내드립니다.\n\n${serviceList}\n\n고객님의 취향에 맞춘 1:1 맞춤 서비스로 진행해 드립니다.`
    }
    case 'AVAILABILITY':
    case 'BOOKING_INTENT': {
      return `${greeting} ${brand} 예약 문의 감사드립니다. 원하시는 날짜와 시간대를 알려주시면 가능한 일정을 빠르게 확인해 드리겠습니다.`
    }
    case 'COMPLAINT':
    case 'OTHER':
    default: {
      return `${greeting} 문의주셔서 감사합니다. 매장 담당 사장님께서 확인 후 신속하고 정성껏 답변드리겠습니다.`
    }
  }
}

export interface ExecuteResponseJobParams {
  workspaceId: string
  channelConnectionId: string
  inboundEventId: string
  responseKind: 'instagram_comment_reply' | 'instagram_dm' | 'threads_reply'
  externalTargetId: string
  intent: CanonicalCustomerIntent
  confidence: number
  inboundText: string
  requiresHumanReview: boolean
  knowledge: StoreKnowledge
  customerName?: string
  idempotencyKey?: string
}

export interface ExecuteResponseJobResult {
  jobId: string
  action: CustomerReplyPolicyAction
  status: 'sent' | 'waiting_for_approval' | 'human_review' | 'failed'
  externalSent: boolean
  draftText: string
  policyReason: string
}

export class CustomerReplyRuntime {
  constructor(private readonly client: SupabaseClient<Database>) {}

  public async processInboundResponse(
    params: ExecuteResponseJobParams
  ): Promise<ExecuteResponseJobResult> {
    const {
      workspaceId,
      channelConnectionId,
      inboundEventId,
      responseKind,
      externalTargetId,
      intent,
      confidence,
      inboundText,
      requiresHumanReview,
      knowledge,
      customerName,
      idempotencyKey = crypto.createHash('sha256').update(`${inboundEventId}:${inboundText}`).digest('hex'),
    } = params

    // 1. Evaluate Reply Policy
    const policy = evaluateCustomerReplyPolicy({
      intent,
      confidence,
      text: inboundText,
      requiresHumanReview,
    })

    // 2. Generate Grounded Draft Text
    const draftText = generateDraftResponse({
      intent,
      knowledge,
      customerName,
      rawText: inboundText,
    })
    const draftFingerprint = crypto.createHash('sha256').update(draftText).digest('hex')

    // 3. Determine status and external delivery
    let jobStatus: 'sent' | 'waiting_for_approval' | 'human_review' = 'waiting_for_approval'
    let externalSent = false
    let providerReference: string | null = null

    if (policy.action === 'HUMAN_REVIEW_REQUIRED') {
      jobStatus = 'human_review'
      externalSent = false // ZERO external transmissions for complaints/risks
    } else if (policy.action === 'AUTONOMOUS_ALLOWED') {
      // Allowed low-risk autonomous response
      jobStatus = 'sent'
      externalSent = true
      providerReference = `sim-receipt-${Date.now()}`
    } else {
      jobStatus = 'waiting_for_approval'
      externalSent = false
    }

    // 4. Save to channel_response_jobs
    const now = new Date().toISOString()
    const { data: job, error: jobError } = await (this.client as any)
      .from('channel_response_jobs')
      .upsert({
        workspace_id: workspaceId,
        channel_connection_id: channelConnectionId,
        inbound_event_id: inboundEventId,
        response_kind: responseKind,
        external_target_id: externalTargetId,
        draft_text: draftText,
        draft_fingerprint: draftFingerprint,
        status: jobStatus,
        idempotency_key: idempotencyKey,
        provider_reference: providerReference,
        updated_at: now,
      }, { onConflict: 'workspace_id,idempotency_key' })
      .select()
      .single()

    if (jobError || !job) {
      throw new Error(`[RESPONSE_JOB_PERSISTENCE_FAILED] ${jobError?.message || 'Failed to save response job'}`)
    }

    return {
      jobId: job.id,
      action: policy.action,
      status: jobStatus,
      externalSent,
      draftText,
      policyReason: policy.reason,
    }
  }
}
