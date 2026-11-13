import { createHash } from 'node:crypto'
import type { SalesApprovalResult } from './approval'

type Scope = { workspaceId: string; campaignId: string }
export type CampaignEvent = Scope & { eventId: string } & (
  | { type: 'PROPOSAL_APPROVED'; proposalFingerprint: string; campaignTag: string; approvedAt: string; expectedCostKrw: number }
  | { type: 'POST_PUBLISHED'; channel: string; providerPostId: string; providerReceiptRef: string; publishedAt: string }
  | { type: 'POST_READBACK'; result: 'VERIFIED' | 'MISMATCH' | 'UNKNOWN'; permalink?: string; readAt: string }
  | { type: 'OBSERVATION_WINDOW'; kind: 'INQUIRY' | 'BOOKING'; coverage: 'COMPLETE' | 'PARTIAL' | 'NONE'; from: string; to: string }
  | { type: 'INQUIRY_OBSERVED'; customerRef: string; campaignTag: string; observedAt: string }
  | { type: 'BOOKING_OBSERVED'; bookingId: string; customerRef: string; campaignTag: string; status: 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW'; observedAt: string }
  | { type: 'COST_RECORDED'; amountKrw: number; recordedAt: string }
)
type Count = { state: 'NOT_OBSERVED'; count: null } | { state: 'OBSERVED' | 'PARTIAL'; count: number }
export type CampaignProjection = Readonly<{
  stage: 'NOT_APPROVED' | 'APPROVED_NOT_PUBLISHED' | 'PUBLISHED_UNVERIFIED' | 'PUBLISHED_VERIFIED' | 'RESULT_UNKNOWN'
  integrity: 'OK' | 'CONFLICT'
  campaignTag: string | null
  inquiries: Count
  bookings: Readonly<{ state: 'NOT_OBSERVED' | 'OBSERVED' | 'PARTIAL'; linked: number | null; completed: number | null; pending: number | null; canceled: number | null; noShow: number | null }>
  cost: Readonly<{ expectedKrw: number | null; actualKrw: number | null }>
  excluded: Readonly<{ foreignWorkspace: number; otherCampaign: number; beforePublish: number }>
  ownerLines: readonly string[]
  attribution: 'LINKED_BY_CAMPAIGN_TAG'
  incrementalClaim: false
}>

const ms = Date.parse
const canon = (e: unknown) => JSON.stringify(e, Object.keys(e as object).sort())

/**
 * Idempotent, order-independent projection of campaign events. Links activity to the campaign only by
 * the first-party tag after publication; it never asserts causation or incremental revenue, and a
 * count is "observed" only when an observation window says so (otherwise null, not zero).
 */
export function projectCampaign(rawEvents: readonly CampaignEvent[], scope: Scope & { now: string }): CampaignProjection {
  let foreignWorkspace = 0, otherCampaign = 0, beforePublish = 0
  let conflict = false
  const byId = new Map<string, CampaignEvent>()
  for (const e of rawEvents) {
    if (e.workspaceId !== scope.workspaceId) { foreignWorkspace += 1; continue }
    if (e.campaignId !== scope.campaignId) continue
    const prev = byId.get(e.eventId)
    if (prev) { if (canon(prev) !== canon(e)) conflict = true; continue }
    byId.set(e.eventId, e)
  }
  const events = [...byId.values()]
  const of = <T extends CampaignEvent['type']>(t: T) => events.filter((e): e is Extract<CampaignEvent, { type: T }> => e.type === t)
  const approval = of('PROPOSAL_APPROVED').sort((a, b) => ms(a.approvedAt) - ms(b.approvedAt))[0]
  const published = approval ? of('POST_PUBLISHED').sort((a, b) => ms(a.publishedAt) - ms(b.publishedAt))[0] : undefined
  const readbacks = of('POST_READBACK').sort((a, b) => ms(b.readAt) - ms(a.readAt))
  const coverage = (kind: 'INQUIRY' | 'BOOKING') => {
    const w = of('OBSERVATION_WINDOW').filter(x => x.kind === kind && x.coverage !== 'NONE')
    return w.some(x => x.coverage === 'COMPLETE') ? 'OBSERVED' as const : w.length ? 'PARTIAL' as const : 'NOT_OBSERVED' as const
  }
  const linkable = <E extends { campaignTag: string; observedAt: string }>(list: E[]) => list.filter(e => {
    if (!approval || !published) return false
    if (e.campaignTag !== approval.campaignTag) { otherCampaign += 1; return false }
    if (ms(e.observedAt) < ms(published.publishedAt)) { beforePublish += 1; return false }
    return true
  })
  const uniqueBy = <E,>(list: E[], key: (e: E) => string) => [...new Map(list.map(e => [key(e), e])).values()]
  const inquiryList = uniqueBy(linkable(of('INQUIRY_OBSERVED')), e => e.customerRef)
  const bookingList = uniqueBy(linkable(of('BOOKING_OBSERVED')), e => e.bookingId)
  const bookingByCustomer = uniqueBy(bookingList, e => e.customerRef)
  const inqState = coverage('INQUIRY'), bookState = coverage('BOOKING')
  const inquiries: Count = inqState === 'NOT_OBSERVED' ? { state: 'NOT_OBSERVED', count: null } : { state: inqState, count: inquiryList.length }
  const n = (status: string) => bookingByCustomer.filter(b => b.status === status).length
  const bookings = bookState === 'NOT_OBSERVED'
    ? { state: bookState, linked: null, completed: null, pending: null, canceled: null, noShow: null }
    : { state: bookState, linked: bookingByCustomer.length, completed: n('COMPLETED'), pending: n('CONFIRMED'), canceled: n('CANCELED'), noShow: n('NO_SHOW') }
  const actual = of('COST_RECORDED')
  const cost = { expectedKrw: approval?.expectedCostKrw ?? null, actualKrw: actual.length ? uniqueBy(actual, c => c.eventId).reduce((s, c) => s + c.amountKrw, 0) : null }

  let stage: CampaignProjection['stage'] = !approval ? 'NOT_APPROVED' : !published ? 'APPROVED_NOT_PUBLISHED'
    : readbacks[0]?.result === 'VERIFIED' ? 'PUBLISHED_VERIFIED' : readbacks[0] ? 'RESULT_UNKNOWN' : 'PUBLISHED_UNVERIFIED'
  if (conflict) stage = 'RESULT_UNKNOWN'

  const lines: string[] = []
  if (stage === 'NOT_APPROVED') lines.push('승인된 캠페인이 아직 없어요.')
  else if (stage === 'APPROVED_NOT_PUBLISHED') lines.push('승인되었어요. 아직 게시가 확인되지 않았어요.')
  else if (stage === 'PUBLISHED_UNVERIFIED') lines.push('게시 요청은 접수됐지만 실제 게시는 아직 확인하지 못했어요.')
  else if (stage === 'RESULT_UNKNOWN') lines.push('게시 결과를 확인하지 못했어요. 직접 확인이 필요해요.')
  else lines.push('게시를 확인했어요.')
  if (approval && published && !conflict) {
    lines.push(inquiries.count === null ? '문의는 아직 확인하지 못했어요.' : `캠페인에 연결된 문의 ${inquiries.count}건${inquiries.state === 'PARTIAL' ? ' (일부 기간만 확인)' : ''}`)
    if (bookings.linked === null) lines.push('예약은 아직 확인하지 못했어요.')
    else {
      lines.push(`캠페인에 연결된 예약 ${bookings.linked}건${bookings.state === 'PARTIAL' ? ' (일부 기간만 확인)' : ''}`)
      if (bookings.linked > 0) lines.push(`완료 ${bookings.completed}건 · 예정 ${bookings.pending}건 · 취소 ${bookings.canceled}건 · 방문 안 함 ${bookings.noShow}건`)
    }
    lines.push('이 숫자는 캠페인 링크로 연결된 건수예요. 소희의 효과라고 단정하지 않아요.')
  }
  if (cost.expectedKrw !== null) lines.push(cost.actualKrw === null ? `예상 비용 ${cost.expectedKrw.toLocaleString('ko-KR')}원 · 실제 비용은 아직 기록되지 않았어요.` : `예상 비용 ${cost.expectedKrw.toLocaleString('ko-KR')}원 · 실제 비용 ${cost.actualKrw.toLocaleString('ko-KR')}원`)
  return Object.freeze({ stage, integrity: conflict ? 'CONFLICT' : 'OK', campaignTag: approval?.campaignTag ?? null, inquiries, bookings: Object.freeze(bookings), cost: Object.freeze(cost),
    excluded: Object.freeze({ foreignWorkspace, otherCampaign, beforePublish }), ownerLines: Object.freeze(lines), attribution: 'LINKED_BY_CAMPAIGN_TAG', incrementalClaim: false as const })
}

/** Only a reserved owner approval starts a campaign; every other outcome yields no event. */
export function approvalToCampaignEvent(approval: SalesApprovalResult, ctx: Scope & { campaignTag: string; approvedAt: string; expectedCostKrw: number }): Extract<CampaignEvent, { type: 'PROPOSAL_APPROVED' }> | null {
  if (approval.status !== 'APPROVED_RESERVED' || !approval.proposalFingerprint) return null
  const eventId = createHash('sha256').update(`approved:${ctx.workspaceId}:${ctx.campaignId}:${approval.proposalFingerprint}`).digest('hex')
  return { type: 'PROPOSAL_APPROVED', eventId, workspaceId: ctx.workspaceId, campaignId: ctx.campaignId, proposalFingerprint: approval.proposalFingerprint, campaignTag: ctx.campaignTag, approvedAt: ctx.approvedAt, expectedCostKrw: ctx.expectedCostKrw }
}
