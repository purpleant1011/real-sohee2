'use client'

import type { MobileCustomerDto } from './customer-model'
import { MobileCustomersView, type CustomersViewSnapshot } from './customers-view'
import { MobileCustomerDetailView } from './customer-detail-view'

/**
 * M17 고객 화면의 예시 마운트(프로토타입용).
 *
 * 셸 없이 본문만 내보내므로 `/dev/mobile-r2` 레지스트리와 인터랙티브 셸이 같은 화면을
 * 그대로 가져다 쓸 수 있다. 조회·연락·저장 요청은 하지 않는다(fetch 없음).
 * 연락 버튼은 실화면과 같이 수신 동의 판정만 보여주고, 예시 화면에서는 아무 요청도 보내지 않는다.
 */
export function ExampleCustomersScreen() {
  return (
    <div data-example-customers-screen className="space-y-4">
      <p
        data-example-notice
        className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground"
      >
        예시 화면이에요. 실제 가게 고객이 아니라 화면 모양을 보여드리는 내용이고, 연락은 실제로 보내지 않아요.
      </p>
      <MobileCustomersView snapshot={EXAMPLE_SNAPSHOT} readOnlyContacts />
    </div>
  )
}

/**
 * M17 고객 상세의 예시 마운트(프로토타입용).
 *
 * 목록과 같은 예시 고객 스냅샷을 쓰므로, 실제 화면과 같이 수신 동의 철회·미확인 고객은
 * 이름이 가려지고 연락 버튼이 닫힌다. 없는 id 는 '고객을 찾지 못했어요'로 끝난다.
 * 조회·연락·저장 요청은 하지 않는다(fetch 없음).
 */
export function ExampleCustomerDetailScreen({ customerId }: { customerId: string }) {
  return (
    <div data-example-customer-detail className="space-y-4">
      <p
        data-example-notice
        className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground"
      >
        예시 화면이에요. 실제 가게 고객이 아니라 화면 모양을 보여드리는 내용이고, 연락은 실제로 보내지 않아요.
      </p>
      <MobileCustomerDetailView snapshot={EXAMPLE_SNAPSHOT} customerId={customerId} readOnlyContacts />
    </div>
  )
}

const OBSERVED_AT = '2026-10-23T09:00:00.000Z'

/**
 * 예시 고객. 동의 확인·철회·미확인과 다른 가게 고객(목록에서 제외)을 함께 둔다.
 * 철회 고객은 이름이 마스킹되고 연락 버튼이 모두 닫힌다.
 */
const EXAMPLE_CUSTOMERS: MobileCustomerDto[] = [
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
    segment: 'inquiring',
    consent: { status: 'unknown', checkedAt: null, source: null },
    verifiedContacts: [],
    lastAction: null,
    sourceLabel: null,
  },
  {
    id: 'preview-customer-4',
    workspaceId: 'preview-other-workspace',
    displayName: '다른 가게 고객',
    segment: 'revisit',
    consent: { status: 'granted', checkedAt: '2026-10-19T01:00:00.000Z', source: '예약 문의' },
    verifiedContacts: ['phone'],
    lastAction: null,
    sourceLabel: null,
  },
]

const EXAMPLE_SNAPSHOT: CustomersViewSnapshot = {
  loadState: 'ready',
  workspaceId: 'preview-workspace',
  complete: true,
  checkedAt: OBSERVED_AT,
  customers: EXAMPLE_CUSTOMERS,
}
