'use client'

import { useState } from 'react'
import { LiveRegion } from '@/components/mobile-ui'
import type { LedgerEntryDto } from './ledger-model'
import { MobileLedgerView, type LedgerViewSnapshot } from './ledger-view'

/**
 * M15 예약표 화면의 예시 마운트(프로토타입용).
 *
 * 셸 없이 본문만 내보내므로 `/dev/mobile-r2` 레지스트리와 인터랙티브 셸이 같은 화면을
 * 그대로 가져다 쓸 수 있다. 조회·변경 요청은 하지 않는다(fetch 없음).
 * '새로 확인'은 다시 조회하지 않고 그 사실만 알린다.
 */
export function ExampleLedgerScreen() {
  const [notice, setNotice] = useState('')

  return (
    <div data-example-ledger-screen className="space-y-4">
      <p
        data-example-notice
        className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground"
      >
        예시 화면이에요. 실제 가게 예약이 아니라 화면 모양을 보여드리는 내용이고, 예약을 바꾸지 않아요.
      </p>
      {notice ? (
        <LiveRegion
          message={notice}
          visible
          className="rounded-xl bg-state-quiet-soft px-3 py-2 text-sm text-state-quiet"
        />
      ) : null}
      <MobileLedgerView
        snapshot={EXAMPLE_SNAPSHOT}
        onRefresh={() => setNotice('예시 화면이라 다시 조회하지 않아요. 실제 예약표는 앱에서 확인해 주세요.')}
      />
    </div>
  )
}

/** 예시 기준 시각. 확인 시각을 같게 두어 오래된 정보로 판정되지 않게 한다. */
const OBSERVED_AT = '2026-10-23T09:00:00.000Z'

/**
 * 예시 예약. 확정·확정 대기·시술 끝 상태와, 같은 시간에 겹친 예약·다른 화면과 상태가 다른 예약을 함께 둔다.
 * 시각은 UTC 기준이며 화면은 Asia/Seoul 로 그린다(05:00Z = 14:00 KST).
 */
const EXAMPLE_ENTRIES: LedgerEntryDto[] = [
  {
    id: 'preview-ledger-1',
    workspaceId: 'preview-workspace',
    customerName: '김예시',
    serviceLabel: '속눈썹펌',
    startsAt: '2026-10-23T05:00:00.000Z',
    endsAt: '2026-10-23T06:00:00.000Z',
    status: 'confirmed',
    source: 'owner_confirmed',
    ledgerVerifiedAt: OBSERVED_AT,
    otherSurfaceStatus: 'confirmed',
  },
  {
    id: 'preview-ledger-2',
    workspaceId: 'preview-workspace',
    customerName: '이예시',
    serviceLabel: '스킨케어',
    startsAt: '2026-10-23T05:30:00.000Z',
    endsAt: '2026-10-23T06:30:00.000Z',
    status: 'pending_confirmation',
    source: 'customer_accepted',
    ledgerVerifiedAt: null,
    otherSurfaceStatus: null,
  },
  {
    id: 'preview-ledger-3',
    workspaceId: 'preview-workspace',
    customerName: '박예시',
    serviceLabel: '네일 케어',
    startsAt: '2026-10-23T07:00:00.000Z',
    endsAt: '2026-10-23T08:00:00.000Z',
    status: 'completed',
    source: 'ledger_event',
    ledgerVerifiedAt: OBSERVED_AT,
    otherSurfaceStatus: 'pending_confirmation',
  },
  {
    id: 'preview-ledger-4',
    workspaceId: 'preview-other-workspace',
    customerName: '다른 가게 고객',
    serviceLabel: '커트',
    startsAt: '2026-10-23T05:00:00.000Z',
    endsAt: '2026-10-23T06:00:00.000Z',
    status: 'confirmed',
    source: 'owner_confirmed',
    ledgerVerifiedAt: OBSERVED_AT,
    otherSurfaceStatus: 'confirmed',
  },
]

const EXAMPLE_SNAPSHOT: LedgerViewSnapshot = {
  loadState: 'ready',
  workspaceId: 'preview-workspace',
  timeZone: 'Asia/Seoul',
  now: OBSERVED_AT,
  complete: true,
  checkedAt: OBSERVED_AT,
  entries: EXAMPLE_ENTRIES,
}
