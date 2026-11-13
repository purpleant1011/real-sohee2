import { campaignAudience, type MobileCustomerDto } from '@/features/mobile-customers/customer-model'
import { canSpend, type CreditLedger } from '@/features/mobile-settings/credit-model'

/**
 * M18(ANI-1697) 캠페인·빈자리 구조대 — 제안/승인 계약.
 * 발송은 이 모듈에서 하지 않는다. 빈 슬롯·동의·채널 게시 가능성·크레딧이 모두 확인되고
 * 사장님이 승인해야만 발송 CTA 가 열린다. 예측은 실적으로 표시하지 않는다.
 */

export type SlotAvailability = 'confirmed_open' | 'sold_out' | 'unknown'

export interface EmptySlot {
  id: string
  workspaceId: string
  serviceLabel: string
  startsAt: string
  availability: SlotAvailability
  observedAt: string
  sourceLabel: string | null
}

export type CampaignKind = 'empty_slot_rescue' | 'revisit'

export interface CampaignProposal {
  id: string
  workspaceId: string
  kind: CampaignKind
  /** 빈자리 구조대가 아니면 null. */
  slotId: string | null
  message: string
  audienceIds: string[]
  /** 소희가 계산한 예상 전환. 실적이 아니다. */
  estimatedConversions: number | null
  sentTo: string[]
  approvedAt: string | null
  dispatchIdempotencyKey: string | null
}

export interface ChannelPublishState {
  channelLabel: string
  publishable: boolean
  reason: string | null
  next: string | null
}

const MINUTE = 60_000

/** 품절·불명 슬롯은 자동으로 목록에서 뺀다. 오래된 관측도 빈자리라고 주장하지 않는다. */
export function openSlots(slots: EmptySlot[], now: string, maxAgeMinutes = 30): EmptySlot[] {
  const nowMs = Date.parse(now)
  return slots.filter(slot => {
    if (slot.availability !== 'confirmed_open') return false
    const observed = Date.parse(slot.observedAt)
    if (Number.isNaN(observed) || Number.isNaN(nowMs)) return false
    return nowMs - observed <= maxAgeMinutes * MINUTE
  })
}

export interface AudienceExclusion {
  customerId: string
  reason: string
}

export interface AudienceResult {
  eligible: MobileCustomerDto[]
  excluded: AudienceExclusion[]
}

/** 동의 철회·미확인·타 워크스페이스·이미 받은 고객은 제외한다. 중복 제거. */
export function buildAudience(
  customers: MobileCustomerDto[],
  workspaceId: string,
  audienceIds: string[],
  sentTo: string[],
): AudienceResult {
  const unique = [...new Set(audienceIds)]
  const eligible: MobileCustomerDto[] = []
  const excluded: AudienceExclusion[] = []
  for (const id of unique) {
    const customer = customers.find(c => c.id === id)
    if (!customer) { excluded.push({ customerId: id, reason: '고객 정보를 확인하지 못했어요' }); continue }
    if (customer.workspaceId !== workspaceId) { excluded.push({ customerId: id, reason: '다른 매장 고객이에요' }); continue }
    if (!campaignAudience([customer], workspaceId).length) { excluded.push({ customerId: id, reason: '수신 동의가 확인되지 않아요' }); continue }
    if (sentTo.includes(id)) { excluded.push({ customerId: id, reason: '이 캠페인을 이미 받았어요' }); continue }
    eligible.push(customer)
  }
  return { eligible, excluded }
}

export type CampaignBlockerCode =
  | 'no_slot'
  | 'slot_unavailable'
  | 'empty_audience'
  | 'channel_not_ready'
  | 'credit_blocked'
  | 'owner_approval_required'
  | 'message_empty'
  | 'dispatch_already_sent'
  | 'missing_idempotency'

export interface CampaignBlocker {
  code: CampaignBlockerCode
  message: string
  next: string | null
}

export interface CampaignReadinessInput {
  proposal: CampaignProposal
  slot: EmptySlot | null
  customers: MobileCustomerDto[]
  channel: ChannelPublishState
  ledger: CreditLedger
  estimate: number | null
  ownerApproved: boolean
}

export interface CampaignReadiness {
  allowed: boolean
  audience: AudienceResult
  blockers: CampaignBlocker[]
}

export function campaignReadiness(input: CampaignReadinessInput): CampaignReadiness {
  const { proposal, slot, customers, channel, ledger, estimate, ownerApproved } = input
  const audience = buildAudience(customers, proposal.workspaceId, proposal.audienceIds, proposal.sentTo)
  const blockers: CampaignBlocker[] = []

  if (!proposal.message.trim()) blockers.push({ code: 'message_empty', message: '보낼 문구가 비어 있어요', next: '문구 작성' })

  if (proposal.kind === 'empty_slot_rescue') {
    if (!slot || slot.workspaceId !== proposal.workspaceId) {
      blockers.push({ code: 'no_slot', message: '빈자리 정보를 확인하지 못했어요', next: '예약표 새로고침' })
    } else if (slot.availability !== 'confirmed_open') {
      blockers.push({ code: 'slot_unavailable', message: '이미 찬 자리예요', next: null })
    }
  }

  if (audience.eligible.length === 0) {
    blockers.push({ code: 'empty_audience', message: '지금 연락해도 되는 고객이 없어요', next: '대상 고객 확인' })
  }

  if (!channel.publishable) {
    blockers.push({ code: 'channel_not_ready', message: channel.reason ?? `${channel.channelLabel}로는 아직 보낼 수 없어요`, next: channel.next })
  }

  const spend = canSpend(ledger, estimate)
  if (!spend.allowed) blockers.push({ code: 'credit_blocked', message: spend.message, next: spend.next })

  if (!ownerApproved) blockers.push({ code: 'owner_approval_required', message: '사장님 승인 전에는 발송할 수 없어요', next: '문구 확인하고 승인' })

  if (!proposal.dispatchIdempotencyKey) blockers.push({ code: 'missing_idempotency', message: '발송 준비를 확인하지 못했어요', next: '다시 시도' })

  return { allowed: blockers.length === 0, audience, blockers }
}

/** 승인은 모든 확인이 끝난 뒤에만 상태를 올린다. 화면만 enabled 로 우회하지 않는다. */
export function approveProposal(readiness: CampaignReadiness, at: string): { ok: true; approvedAt: string } | { ok: false; blockers: CampaignBlocker[] } {
  if (!readiness.allowed) return { ok: false, blockers: readiness.blockers }
  return { ok: true, approvedAt: at }
}

export interface ConversionDisplay {
  label: string
  isEstimate: boolean
  detail: string | null
}

/** 예측은 '예상'으로만. 실측이 없으면 실적처럼 쓰지 않는다. */
export function conversionDisplay(estimated: number | null, actual: number | null, actualSource: string | null): ConversionDisplay {
  if (actual !== null && actualSource !== null) {
    return { label: `예약 ${actual}건`, isEstimate: false, detail: `출처 ${actualSource}` }
  }
  if (estimated !== null) {
    return { label: `예상 예약 ${estimated}건`, isEstimate: true, detail: '소희 계산값 · 실적 아님' }
  }
  return { label: '전환 결과 없음', isEstimate: false, detail: null }
}
