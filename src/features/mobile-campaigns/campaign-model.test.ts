import { describe, expect, it } from 'vitest'
import type { MobileCustomerDto } from '@/features/mobile-customers/customer-model'
import type { CreditLedger } from '@/features/mobile-settings/credit-model'
import {
  approveProposal,
  buildAudience,
  campaignReadiness,
  conversionDisplay,
  openSlots,
  type CampaignProposal,
  type ChannelPublishState,
  type EmptySlot,
} from './campaign-model'

const customer = (o: Partial<MobileCustomerDto> = {}): MobileCustomerDto => ({
  id: 'c1', workspaceId: 'w1', displayName: '김민지', segment: 'revisit',
  consent: { status: 'granted', checkedAt: '2026-10-20T00:00:00Z', source: '예약 시 동의' },
  verifiedContacts: ['message'], lastAction: null, sourceLabel: null, ...o,
})

const slot = (o: Partial<EmptySlot> = {}): EmptySlot => ({
  id: 's1', workspaceId: 'w1', serviceLabel: '속눈썹 연장', startsAt: '2026-10-23T06:00:00Z',
  availability: 'confirmed_open', observedAt: '2026-10-22T09:50:00Z', sourceLabel: '예약표', ...o,
})

const proposal = (o: Partial<CampaignProposal> = {}): CampaignProposal => ({
  id: 'p1', workspaceId: 'w1', kind: 'empty_slot_rescue', slotId: 's1',
  message: '내일 3시 자리가 비었어요', audienceIds: ['c1'], estimatedConversions: 2,
  sentTo: [], approvedAt: null, dispatchIdempotencyKey: 'dispatch-p1', ...o,
})

const channel = (o: Partial<ChannelPublishState> = {}): ChannelPublishState => ({
  channelLabel: '인스타그램', publishable: true, reason: null, next: null, ...o,
})

const ledger = (o: Partial<CreditLedger> = {}): CreditLedger => ({
  available: 100, reserved: 0, consumed: 10, refunded: 0, observedAt: '2026-10-22T09:00:00Z', ...o,
})

const readiness = (o: Partial<Parameters<typeof campaignReadiness>[0]> = {}) =>
  campaignReadiness({
    proposal: proposal(), slot: slot(), customers: [customer()], channel: channel(),
    ledger: ledger(), estimate: 5, ownerApproved: true, ...o,
  })

describe('빈 슬롯 소거', () => {
  it('품절·불명 슬롯은 제안 대상에서 제거', () => {
    const slots = [slot(), slot({ id: 's2', availability: 'sold_out' }), slot({ id: 's3', availability: 'unknown' })]
    expect(openSlots(slots, '2026-10-22T10:00:00Z').map(s => s.id)).toEqual(['s1'])
  })
  it('오래된 관측은 빈자리라고 주장하지 않는다', () => {
    expect(openSlots([slot({ observedAt: '2026-10-22T08:00:00Z' })], '2026-10-22T10:00:00Z')).toEqual([])
  })
})

describe('대상 고객', () => {
  it('동의 철회·타 매장·이미 발송 고객 제외', () => {
    const customers = [
      customer(),
      customer({ id: 'c2', consent: { status: 'withdrawn', checkedAt: null, source: null } }),
      customer({ id: 'c3', workspaceId: 'w2' }),
      customer({ id: 'c4' }),
    ]
    const result = buildAudience(customers, 'w1', ['c1', 'c2', 'c3', 'c4', 'c4'], ['c4'])
    expect(result.eligible.map(c => c.id)).toEqual(['c1'])
    expect(result.excluded.map(e => e.customerId)).toEqual(['c2', 'c3', 'c4'])
  })
})

describe('발송 준비 상태', () => {
  it('동의한 고객이 없으면 발송 CTA 비활성', () => {
    const r = readiness({ customers: [customer({ consent: { status: 'withdrawn', checkedAt: null, source: null } })] })
    expect(r.allowed).toBe(false)
    expect(r.blockers.map(b => b.code)).toContain('empty_audience')
  })

  it('빈자리가 소진됐으면 발송 불가', () => {
    const r = readiness({ slot: slot({ availability: 'sold_out' }) })
    expect(r.allowed).toBe(false)
    expect(r.blockers.find(b => b.code === 'slot_unavailable')?.message).toBe('이미 찬 자리예요')
  })

  it('채널 게시 불가면 이유와 다음 행동을 준다', () => {
    const r = readiness({ channel: channel({ publishable: false, reason: '게시 권한 심사가 끝나지 않았어요', next: '채널 다시 확인' }) })
    expect(r.allowed).toBe(false)
    const blocker = r.blockers.find(b => b.code === 'channel_not_ready')
    expect(blocker?.message).toBe('게시 권한 심사가 끝나지 않았어요')
    expect(blocker?.next).toBe('채널 다시 확인')
  })

  it('크레딧 잔액 미확인은 발송 차단', () => {
    const r = readiness({ ledger: ledger({ available: null }) })
    expect(r.allowed).toBe(false)
    expect(r.blockers.map(b => b.code)).toContain('credit_blocked')
  })

  it('사장님 승인 전에는 발송 불가', () => {
    expect(readiness({ ownerApproved: false }).blockers.map(b => b.code)).toContain('owner_approval_required')
    expect(readiness({ proposal: proposal({ dispatchIdempotencyKey: null }) }).blockers.map(b => b.code)).toContain('missing_idempotency')
  })

  it('모든 확인이 끝나야 승인 상태로 올라간다', () => {
    expect(approveProposal(readiness({ ownerApproved: false }), '2026-10-22T10:00:00Z').ok).toBe(false)
    expect(approveProposal(readiness(), '2026-10-22T10:00:00Z')).toEqual({ ok: true, approvedAt: '2026-10-22T10:00:00Z' })
  })
})

describe('전환 표시', () => {
  it('미확인 예측을 실적으로 표시하지 않는다', () => {
    const predicted = conversionDisplay(3, null, null)
    expect(predicted.label).toBe('예상 예약 3건')
    expect(predicted.isEstimate).toBe(true)
  })
  it('실측은 출처가 있을 때만 실적으로 표시', () => {
    expect(conversionDisplay(3, 2, null).isEstimate).toBe(true)
    expect(conversionDisplay(3, 2, '예약표 10-22').label).toBe('예약 2건')
  })
})
