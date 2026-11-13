import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export type BookingSafetyAction = 'PROCEED' | 'CONFLICT' | 'HUMAN_REVIEW'

export interface BookingEvaluationInput {
  workspaceId: string
  slotId: string
  customerId: string
  customerMessage: string
}

export interface BookingSafetyEvaluationResult {
  action: BookingSafetyAction
  requiresHandoff: boolean
  conflictSlotId?: string
  riskReason?: string
}

export class BookingConflictGuard {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Pre-execution safety check for bookings:
   * 1. Detects high-risk customer context (complaints, medical issues, refund disputes) -> routes to HUMAN_REVIEW
   * 2. Detects slot double-booking collisions before initiating transactions -> CONFLICT
   * 3. Approves clean bookings -> PROCEED
   */
  public async evaluateBookingSafety(
    input: BookingEvaluationInput
  ): Promise<BookingSafetyEvaluationResult> {
    const { workspaceId, slotId, customerMessage } = input
    const trimmed = customerMessage.toLowerCase()

    // 1. High-risk keyword check (Human Handoff)
    const riskKeywords = ['부작용', '환불', '고소', '신고', '손해배상', '의료법', '따질', '불친절', '경찰']
    const matchedKeyword = riskKeywords.find(kw => trimmed.includes(kw))

    if (matchedKeyword) {
      return {
        action: 'HUMAN_REVIEW',
        requiresHandoff: true,
        riskReason: `고객 메시지에서 고위험 키워드('${matchedKeyword}')가 감지되어 사장님 직접 확인이 필요합니다.`,
      }
    }

    // 2. Pre-check Database for active confirmed slot conflicts
    const { data: existing, error: selectErr } = await (this.client as any)
      .from('reservations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('slot_id', slotId)
      .eq('status', 'CONFIRMED')
      .maybeSingle()

    if (selectErr) {
      return {
        action: 'HUMAN_REVIEW',
        requiresHandoff: true,
        riskReason: '예약표를 확인하지 못했습니다.',
      }
    }

    if (existing) {
      return {
        action: 'CONFLICT',
        requiresHandoff: false,
        conflictSlotId: slotId,
        riskReason: `슬롯 [${slotId}]은 이미 다른 고객의 예약이 확정되어 있습니다.`,
      }
    }

    return {
      action: 'PROCEED',
      requiresHandoff: false,
    }
  }
}
