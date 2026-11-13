'use client'

import { useState } from 'react'
import { LiveRegion } from '@/components/mobile-ui'
import type { MobileCustomerDto } from '@/features/mobile-customers/customer-model'
import type { CreditLedger } from '@/features/mobile-settings/credit-model'
import {
  MobileCampaignsView,
  type CampaignCandidate,
  type CampaignsViewSnapshot,
} from './campaigns-view'

/**
 * M18 제안 화면의 예시 마운트(프로토타입용).
 *
 * 셸 없이 본문만 내보내므로 `/dev/mobile-r2` 레지스트리와 인터랙티브 셸이 같은 화면을
 * 그대로 가져다 쓸 수 있다. 조회·쓰기·발송 요청은 하지 않는다(fetch 없음).
 *
 * 카드의 받을 고객 수·예상 예약 수는 예시 값이므로 `example` 로 '예시' 표시를 붙인다.
 * 실화면(`R2Campaigns`)은 이 prop 을 넘기지 않아 숫자에 표시가 붙지 않는다.
 */
export function ExampleCampaignsScreen() {
  const [notice, setNotice] = useState('')

  return (
    <div data-example-campaigns-screen className="space-y-4">
      <p
        data-example-notice
        className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground"
      >
        예시 화면이에요. 실제 가게 기록이 아니라 화면 모양을 보여드리는 내용이고, 카드의 숫자도 예시 값이에요.
      </p>
      {notice ? (
        <LiveRegion
          message={notice}
          visible
          className="rounded-xl bg-state-quiet-soft px-3 py-2 text-sm text-state-quiet"
        />
      ) : null}
      <MobileCampaignsView
        snapshot={EXAMPLE_SNAPSHOT}
        example
        onApprove={() => {
          // 예시 화면이므로 승인을 저장하지도, 발송 경로를 부르지도 않는다. 그 사실만 알린다.
          setNotice('예시 화면이라 승인 내용을 저장하지 않아요. 실제 승인은 앱에서 해 주세요.')
        }}
      />
    </div>
  )
}

/** 예시 관측 시각. 빈자리는 이 시각 기준 30분 이내 관측만 열린 자리로 인정된다. */
const OBSERVED_AT = '2026-10-23T09:00:00.000Z'

const EXAMPLE_CUSTOMERS: readonly MobileCustomerDto[] = [
  {
    id: 'preview-customer-1',
    workspaceId: 'preview-workspace',
    displayName: '김예시',
    segment: 'upcoming',
    consent: { status: 'granted', checkedAt: '2026-10-20T02:00:00.000Z', source: '예약 문의' },
    verifiedContacts: ['phone', 'message'],
    lastAction: { label: '예약 문의 답장 준비', at: '2026-10-22T06:30:00.000Z' },
    sourceLabel: '예약 문의 채널',
  },
  {
    id: 'preview-customer-2',
    workspaceId: 'preview-workspace',
    displayName: '이예시',
    segment: 'visited',
    consent: { status: 'withdrawn', checkedAt: '2026-10-18T04:00:00.000Z', source: '수신 거부 안내' },
    verifiedContacts: ['phone'],
    lastAction: { label: '방문 완료', at: '2026-10-17T08:00:00.000Z' },
    sourceLabel: null,
  },
  {
    id: 'preview-customer-3',
    workspaceId: 'preview-workspace',
    displayName: '박예시',
    segment: 'revisit',
    consent: { status: 'granted', checkedAt: '2026-10-19T01:00:00.000Z', source: '방문 후 수신 동의' },
    verifiedContacts: ['message'],
    lastAction: { label: '지난 방문', at: '2026-09-28T05:00:00.000Z' },
    sourceLabel: '방문 기록',
  },
]

const EXAMPLE_LEDGER: CreditLedger = {
  available: 1200,
  reserved: 0,
  consumed: 300,
  refunded: 0,
  observedAt: OBSERVED_AT,
}

const EXAMPLE_CANDIDATES: readonly CampaignCandidate[] = [
  {
    // 승인 버튼이 열리는 상태: 빈자리 신선·수신 동의·채널·크레딧·멱등키가 모두 확인됨.
    proposal: {
      id: 'preview-campaign-1',
      workspaceId: 'preview-workspace',
      kind: 'empty_slot_rescue',
      slotId: 'preview-slot-1',
      message: '오늘 오후 3시 예약이 비었어요. 다시 찾아오실 고객에게 알려드릴까요?',
      audienceIds: ['preview-customer-1', 'preview-customer-3'],
      estimatedConversions: 2,
      sentTo: [],
      approvedAt: null,
      dispatchIdempotencyKey: 'preview-idempotency-1',
    },
    slot: {
      id: 'preview-slot-1',
      workspaceId: 'preview-workspace',
      serviceLabel: '시술 후 관리 60분',
      startsAt: '2026-10-23T06:00:00.000Z',
      availability: 'confirmed_open',
      observedAt: '2026-10-23T08:50:00.000Z',
      sourceLabel: '예약표',
    },
    channel: { channelLabel: '인스타그램 DM', publishable: true, reason: null, next: null },
    ledger: EXAMPLE_LEDGER,
    estimate: 20,
    actualConversions: null,
    actualSource: null,
  },
  {
    // 채널이 아직 확인되지 않아 승인 버튼이 닫히는 상태. 막힌 이유를 카드 안에 그대로 보여준다.
    proposal: {
      id: 'preview-campaign-2',
      workspaceId: 'preview-workspace',
      kind: 'revisit',
      slotId: null,
      message: '지난달 방문하신 고객에게 재방문 안내를 보낼까요?',
      audienceIds: ['preview-customer-2', 'preview-customer-3'],
      estimatedConversions: 3,
      sentTo: [],
      approvedAt: null,
      dispatchIdempotencyKey: 'preview-idempotency-2',
    },
    slot: null,
    channel: {
      channelLabel: '문자',
      publishable: false,
      reason: '문자 발신 번호를 아직 확인하지 못했어요',
      next: '채널 설정 확인',
    },
    ledger: EXAMPLE_LEDGER,
    estimate: 15,
    actualConversions: null,
    actualSource: null,
  },
]

const EXAMPLE_SNAPSHOT: CampaignsViewSnapshot = {
  loadState: 'ready',
  candidates: EXAMPLE_CANDIDATES,
  customers: EXAMPLE_CUSTOMERS,
  now: OBSERVED_AT,
  checkedAt: OBSERVED_AT,
}
