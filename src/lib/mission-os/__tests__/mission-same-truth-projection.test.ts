import { describe, it, expect } from 'vitest'
import {
  buildOwnerMissionSummary,
  buildAdminMissionTimeline,
  buildCanonicalMissionDTO,
  type MarketingMissionAggregate,
} from '../mission-read-model'

describe('Canonical Mission Read Model & Same-Truth Projections (ANI-1212)', () => {
  const sampleMission: MarketingMissionAggregate = {
    id: 'm-byreum-001',
    workspace_id: '00000000-0000-4000-8000-0000000000a2',
    trace_id: 'tr-byreum-golden-001',
    status: 'PUBLISHED_VERIFIED',
    goal: '평일 오후 잔여 예약 슬롯 해소 및 가을 자연눈썹 신규 고객 유치',
    strategy_summary: '자연스러운 눈썹 결 비포/애프터 스토리텔링 및 1:1 맞춤 상담 안내',
    target_channel: 'instagram',
    target_audience: '인천 청라/송도 거주 직장인 여성',
    content_id: 'cnt-001',
    content_version_id: 'cnt-ver-001',
    approval_id: 'appr-001',
    external_action_request_id: 'req-001',
    external_action_receipt_id: 'rcpt-001',
    customer_id: 'cust-001',
    booking_id: 'bk-001',
    outcome_id: 'out-001',
    next_action_id: 'nxt-001',
    metadata: {
      providerPostId: 'ig_post_123456',
      readbackConfirmedAt: '2026-09-10T02:00:00.000Z',
    },
    created_at: '2026-09-10T01:00:00.000Z',
    updated_at: '2026-09-10T02:05:00.000Z',
  }

  it('1. MUST project Owner summary and Admin timeline with 100% status truth alignment', () => {
    const ownerView = buildOwnerMissionSummary(sampleMission)
    const adminView = buildAdminMissionTimeline(sampleMission)

    // Truth invariant: both projections reflect the same canonical status
    expect(ownerView.canonicalStatus).toBe('PUBLISHED_VERIFIED')
    expect(adminView.canonicalStatus).toBe('PUBLISHED_VERIFIED')

    // Owner UI has human-friendly labels
    expect(ownerView.displayBadgeText).toBe('발행 및 게시 확인 완료')
    expect(ownerView.goal).toBe('평일 오후 잔여 예약 슬롯 해소 및 가을 자연눈썹 신규 고객 유치')

    // Admin timeline includes full audit references
    expect(adminView.traceId).toBe('tr-byreum-golden-001')
    expect(adminView.externalReceiptId).toBe('rcpt-001')
    expect(adminView.providerVerified).toBe(true)
  })

  it.each([
    { external_action_receipt_id: null, metadata: {} },
    { external_action_receipt_id: 'receipt', metadata: {} },
    { external_action_receipt_id: 'receipt', metadata: { readbackConfirmedAt: 'invalid' } },
  ])('does not treat PUBLISHED_VERIFIED alone as provider evidence: %j', (missingEvidence) => {
    const mission: MarketingMissionAggregate = { ...sampleMission, ...missingEvidence }
    expect(buildAdminMissionTimeline(mission).providerVerified).toBe(false)
    expect(buildOwnerMissionSummary(mission).displayBadgeText).not.toContain('완료')
    const dto = buildCanonicalMissionDTO(mission)
    expect(dto.userBadge).not.toContain('완료')
    expect(dto.userCopy).not.toContain('발행 확인 완료')
    expect(dto.canonicalStatus).toBe('PUBLISHED_VERIFIED')
  })

  it('observations and an overridden execution state never substitute for publication readback', () => {
    const dto = buildCanonicalMissionDTO({
      ...sampleMission, external_action_receipt_id: null,
      metadata: { execution_state: 'READY', observation_evidence: { status: 'OBSERVED', observed_value: 2 } },
    })
    expect(dto.userBadge).toBe('외부 게시 확인 필요')
    expect(dto.userCopy).not.toContain('게시 확인 완료')
    expect(dto.userCopy).not.toContain('발행 확인 완료')
    expect(dto.userCopy).toContain('게시')
  })

  it('2. MUST distinguish UNKNOWN/STALE/EMPTY truthfully across both projections', () => {
    const pendingMission: MarketingMissionAggregate = {
      ...sampleMission,
      status: 'EXECUTING',
      external_action_receipt_id: null,
      metadata: {},
    }

    const ownerView = buildOwnerMissionSummary(pendingMission)
    const adminView = buildAdminMissionTimeline(pendingMission)

    expect(ownerView.canonicalStatus).toBe('EXECUTING')
    expect(adminView.canonicalStatus).toBe('EXECUTING')
    expect(adminView.providerVerified).toBe(false)
    expect(ownerView.displayBadgeText).toBe('소희가 발행 진행 중')
  })
})
