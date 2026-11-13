'use client'

import { MobileResultsView, type ResultsViewSnapshot } from './results-view'

/**
 * M20 성과 화면의 예시 마운트(프로토타입용).
 *
 * 셸 없이 본문만 내보내므로 `/dev/mobile-r2` 레지스트리와 인터랙티브 셸이 같은 화면을
 * 그대로 가져다 쓸 수 있다. 조회 요청은 하지 않는다(fetch 없음).
 *
 * 숫자는 데이터셋 `EXAMPLE` 으로만 그린다. 서버 DTO 계약(`DatasetMode`)에는 이 값이
 * 없으므로 실라우트에서는 이 화면이 숫자를 그릴 수 없고, 실라우트가 `EXAMPLE` 지표를
 * 섞어 넣어도 `kpiDisplay` 가 지표 단위로 막는다. 예시 숫자에는 카드마다 '예시' 표시가 붙는다.
 */
export function ExampleResultsScreen() {
  return (
    <div data-example-results-screen>
      <MobileResultsView snapshot={EXAMPLE_RESULTS} />
    </div>
  )
}

const OBSERVED_AT = '2026-10-23T09:00:00.000Z'
const PERIOD = { start: '2026-10-17', end: '2026-10-23', timeZone: 'Asia/Seoul' }

/** 화면 모양을 보여주기 위한 예시 값. 실제 기록이 아니다. */
const EXAMPLE_RESULTS: ResultsViewSnapshot = {
  loadState: 'ready',
  datasetMode: 'EXAMPLE',
  kpis: [
    { id: 'published', value: 4, state: 'ready', datasetMode: 'EXAMPLE', period: PERIOD, evidenceRef: 'example:published', observedAt: OBSERVED_AT },
    { id: 'inquiries', value: 12, state: 'ready', datasetMode: 'EXAMPLE', period: PERIOD, evidenceRef: 'example:inquiries', observedAt: OBSERVED_AT },
    { id: 'bookings', value: 5, state: 'ready', datasetMode: 'EXAMPLE', period: PERIOD, evidenceRef: 'example:bookings', observedAt: OBSERVED_AT },
    { id: 'deposits', value: 3, state: 'ready', datasetMode: 'EXAMPLE', period: PERIOD, evidenceRef: 'example:deposits', observedAt: OBSERVED_AT },
  ],
  estimatedBookedKrw: 240000,
  confirmedPaidKrw: 120000,
  timeSavedBaselineMinutes: 90,
  timeSavedMeasuredMinutes: 20,
  timeSavedMethod: '예시 측정 방법',
  checkedAt: OBSERVED_AT,
}
