import type { SlotOpportunityDecision } from '@/features/opportunity/slot-opportunity'
import type { RevisitPreparation } from '@/features/crm/revisit-preparation'
import type { CtaPreflightResult } from './cta-preflight'
import { reviewProposalPolicy } from './approval'

export type SalesActionKind = 'WORK_PHOTO_SHOWCASE' | 'SERVICE_INTRO' | 'OWNER_REVIEWED_FOLLOWUP' | 'BOUNDED_OFFER' | 'CTA_OR_POST_IMPROVEMENT'

export type SalesActionEvidence = Readonly<{
  workPhotos: { count: number; rightsCleared: boolean; evidenceRef: string } | null
  serviceFact: { serviceId: string; catalogVersion: string; name: string; priceKrw: number; evidenceRef: string; validUntil: string } | null
  revisit: RevisitPreparation | null
  /** Full policy-gate input of the concrete offer; null when the owner has no offer policy/draft. */
  discountGateInput: unknown | null
  cta: CtaPreflightResult | null
  existingPost: { postRef: string; evidenceRef: string } | null
  recentKinds: readonly SalesActionKind[]
}>

export type SalesActionProposal = Readonly<{
  kind: SalesActionKind; why: string; uncertainty: string; nextAction: string
  evidenceRefs: readonly string[]; paid: boolean; expectedCostKrw: number
  ownerWorkload: 'LOW' | 'MEDIUM'; audienceCount: number | null; executionAllowed: false
}>
export type SuppressedAction = Readonly<{ kind: SalesActionKind; reason: 'NO_OPTED_IN_AUDIENCE' | 'POLICY_BLOCKED' | 'RECENTLY_PROPOSED'; ownerMessage: string }>
export type SalesActionResult = Readonly<{
  status: 'PROPOSALS' | 'NEEDS_SLOT_CONFIRMATION' | 'NO_EVIDENCE' | 'REJECTED'
  ownerPrompt: string; proposals: readonly SalesActionProposal[]; suppressed: readonly SuppressedAction[]
}>

const isFuture = (until: string, now: string) => Date.parse(until) > Date.parse(now)

/**
 * Proposes 0..5 evidence-backed actions. A discount is only one candidate and only survives the policy gate.
 * Slot-bound actions require a VERIFIED_SLOT from the ledger freshness gate; nothing here executes.
 */
export async function buildSalesActionProposals(input: { workspaceId: string; now: string; slot: SlotOpportunityDecision; evidence: SalesActionEvidence }): Promise<SalesActionResult> {
  const { workspaceId, now, slot, evidence: ev } = input
  const empty = (status: SalesActionResult['status'], ownerPrompt: string, proposals: SalesActionProposal[] = [], suppressed: SuppressedAction[] = []): SalesActionResult =>
    Object.freeze({ status, ownerPrompt, proposals: Object.freeze(proposals), suppressed: Object.freeze(suppressed) })
  if (slot.workspaceId !== workspaceId) return empty('REJECTED', '다른 가게의 자료라 제안하지 않았어요.')
  const opp = slot.state === 'VERIFIED_SLOT' && isFuture(slot.opportunity.expiresAt, now) ? slot.opportunity : null
  const slotBound = opp !== null && opp.workspaceId === workspaceId
  const proposals: SalesActionProposal[] = []
  const suppressed: SuppressedAction[] = []
  const recent = new Set(ev.recentKinds)
  const add = (p: SalesActionProposal) => {
    if (recent.has(p.kind)) suppressed.push({ kind: p.kind, reason: 'RECENTLY_PROPOSED', ownerMessage: '최근에 같은 제안을 드려서 이번에는 건너뛰었어요.' })
    else proposals.push(Object.freeze(p))
  }
  const base = { executionAllowed: false as const, audienceCount: null }

  if (ev.workPhotos && ev.workPhotos.count > 0 && ev.workPhotos.rightsCleared) {
    add({ ...base, kind: 'WORK_PHOTO_SHOWCASE', paid: false, expectedCostKrw: 0, ownerWorkload: 'LOW', evidenceRefs: [ev.workPhotos.evidenceRef],
      why: `사용 허락이 확인된 작업 사진 ${ev.workPhotos.count}장이 있어요. 문의가 없어도 결과물을 보여줄 수 있어요.`,
      uncertainty: '반응이나 문의로 이어질지는 알 수 없어요.', nextAction: '사진을 고르고 소개 문구를 확인해 주세요.' })
  }
  if (slotBound && ev.serviceFact && ev.serviceFact.serviceId === opp.serviceId && ev.serviceFact.catalogVersion === opp.catalogVersion && isFuture(ev.serviceFact.validUntil, now)) {
    add({ ...base, kind: 'SERVICE_INTRO', paid: false, expectedCostKrw: 0, ownerWorkload: 'LOW', evidenceRefs: [ev.serviceFact.evidenceRef, ...opp.evidenceIds],
      why: `장부에서 확인한 빈시간에 ${ev.serviceFact.name}을(를) 안내할 수 있어요. 가격은 확인된 ${ev.serviceFact.priceKrw.toLocaleString('ko-KR')}원 그대로예요.`,
      uncertainty: '빈시간은 실행 전에 다시 확인해야 해요. 예약으로 이어진다는 보장은 없어요.', nextAction: '안내 문구와 시간을 확인해 주세요.' })
  }
  if (slotBound && ev.revisit) {
    const eligible = ev.revisit.status === 'PREPARED' ? ev.revisit.candidates.filter(c => c.kind === 'OWNER_REVIEW_REVISIT').length : 0
    if (eligible > 0) {
      add({ ...base, kind: 'OWNER_REVIEWED_FOLLOWUP', paid: false, expectedCostKrw: 0, ownerWorkload: 'MEDIUM', audienceCount: eligible,
        evidenceRefs: [...new Set(ev.revisit.candidates.filter(c => c.kind === 'OWNER_REVIEW_REVISIT').flatMap(c => c.sourceRefs))],
        why: `수신 동의와 방문 기록이 확인된 고객 ${eligible}명에게 보낼 안내를 준비할 수 있어요.`,
        uncertainty: '동의가 확인된 고객만 대상이고, 응답 여부는 알 수 없어요.', nextAction: '대상과 문구를 직접 확인한 뒤 승인해 주세요. 자동으로 보내지 않아요.' })
    } else {
      suppressed.push({ kind: 'OWNER_REVIEWED_FOLLOWUP', reason: 'NO_OPTED_IN_AUDIENCE', ownerMessage: '연락해도 되는 고객이 확인되지 않아 고객 안내는 만들지 않았어요. 공개 게시를 권해요.' })
    }
  }
  if (slotBound && ev.discountGateInput) {
    const review = reviewProposalPolicy(ev.discountGateInput, now)
    if (review.status === 'BLOCKED') {
      suppressed.push({ kind: 'BOUNDED_OFFER', reason: 'POLICY_BLOCKED', ownerMessage: `${review.ownerMessage} ${review.alternative}`.trim() })
    } else {
      const p = (ev.discountGateInput as { proposal: { quotedCostKrw: number }; facts: { evidenceRef: string }; policy: { evidenceRef: string } })
      add({ ...base, kind: 'BOUNDED_OFFER', paid: p.proposal.quotedCostKrw > 0, expectedCostKrw: p.proposal.quotedCostKrw, ownerWorkload: 'MEDIUM',
        evidenceRefs: [p.policy.evidenceRef, p.facts.evidenceRef],
        why: '정해 두신 최저 가격·할인 한도 안에서 만든 제안이에요. 선택 사항이에요.',
        uncertainty: '할인이 예약을 늘릴지는 알 수 없어요. 할인 비용이 생길 수 있어요.', nextAction: '가격·횟수·비용을 확인하고 승인해 주세요.' })
    }
  }
  if (ev.cta && ev.cta.status !== 'OK' && ev.cta.warnings.length > 0) {
    add({ ...base, kind: 'CTA_OR_POST_IMPROVEMENT', paid: false, expectedCostKrw: 0, ownerWorkload: 'LOW', evidenceRefs: [ev.existingPost?.evidenceRef ?? `cta:${ev.cta.warnings[0].code}`],
      why: ev.cta.warnings[0].message, uncertainty: '링크를 고치면 문의가 늘어난다고 말할 수는 없어요.', nextAction: '문의·예약 링크를 확인하고 필요하면 고쳐 주세요.' })
  } else if (ev.existingPost) {
    add({ ...base, kind: 'CTA_OR_POST_IMPROVEMENT', paid: false, expectedCostKrw: 0, ownerWorkload: 'LOW', evidenceRefs: [ev.existingPost.evidenceRef],
      why: '이미 올린 게시물을 다듬어 다시 보여줄 수 있어요.', uncertainty: '반응 변화는 알 수 없어요.', nextAction: '다듬을 부분을 골라 주세요.' })
  }

  // Unpaid and low-workload first; an offer can never lead the list.
  proposals.sort((a, b) => Number(a.paid) - Number(b.paid) || Number(a.kind === 'BOUNDED_OFFER') - Number(b.kind === 'BOUNDED_OFFER') ||
    Number(a.ownerWorkload === 'MEDIUM') - Number(b.ownerWorkload === 'MEDIUM') || a.kind.localeCompare(b.kind))
  if (!slotBound && slot.state !== 'VERIFIED_SLOT') {
    return empty('NEEDS_SLOT_CONFIRMATION', slot.message, proposals, suppressed)
  }
  if (proposals.length === 0) return empty('NO_EVIDENCE', '지금은 근거가 확인된 제안이 없어요. 자료가 쌓이면 다시 알려드릴게요.', [], suppressed)
  return empty('PROPOSALS', '확인된 자료로 만든 제안이에요. 모두 사장님 승인 전에는 실행되지 않아요.', proposals, suppressed)
}
