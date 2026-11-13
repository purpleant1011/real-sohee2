'use client'

import { useState } from 'react'
import { LiveRegion } from '@/components/mobile-ui'
import type { MobileHomeDto } from '@/features/mobile-decision/contracts'
import { ready, unknown } from '@/features/mobile-decision/contracts'
import { MobileHomeView } from '@/features/mobile-decision/mobile-home-view'
import type { AutonomyServerState } from './autonomy-state'
import { FirstActionCard } from './first-action-card'
import type { AutonomyController } from './use-autonomy'

/**
 * M09 오늘 탭의 예시 마운트(프로토타입용).
 *
 * 셸 없이 본문만 내보내므로 `/dev/mobile-r2` 레지스트리와 인터랙티브 셸이 같은 화면을
 * 그대로 가져다 쓸 수 있다. 조회·쓰기·발송 요청은 하지 않는다(fetch 없음).
 * 자율근무 제어도 서버 readback 대신 정적 제어기를 주입해 조회를 보내지 않는다.
 *
 * 건수·지표 숫자는 그리지 않는다. 와이어프레임의 "2건/1건"은 자리 표시용 가상 값이고,
 * 예시 숫자를 실제 업무 건수·성과처럼 보이게 하지 않기 위해서다. 결정 건수는 `total: null`,
 * 확인된 결과는 조회 전 상태(`unknown`)로 두고, 숫자 예시는 성과 화면 예시(M20)에서
 * '예시' 표시와 함께 확인한다.
 */
export function ExampleTodayScreen() {
  const [notice, setNotice] = useState('')
  // 예시 화면이므로 조회도 화면 이동도 하지 않는다. 누른 결과만 그대로 알린다.
  const explain = (message: string) => () => setNotice(message)

  return (
    <div data-example-today-screen className="space-y-4">
      <p
        data-example-notice
        role="status"
        className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground"
      >
        예시 화면이에요. 실제 가게 기록이 아니라 화면 모양을 보여드리는 내용이고, 실제 기록이 확인되면 진짜 값으로 바뀝니다.
      </p>
      {notice ? (
        <LiveRegion
          message={notice}
          visible
          className="rounded-xl bg-state-quiet-soft px-3 py-2 text-sm text-state-quiet"
        />
      ) : null}
      <FirstActionCard
        view={EXAMPLE_HOME}
        onRefresh={explain('예시 화면이라 다시 조회하지 않아요.')}
        onDelegate={explain('예시 화면이라 소식 맡기기 화면으로 넘어가지 않아요.')}
      />
      <MobileHomeView
        view={EXAMPLE_HOME}
        onRefresh={explain('예시 화면이라 다시 조회하지 않아요.')}
        onDelegate={explain('예시 화면이라 소식 맡기기 화면으로 넘어가지 않아요.')}
        autonomy={EXAMPLE_AUTONOMY}
      />
    </div>
  )
}

const OBSERVED_AT = '2026-10-23T09:00:00.000Z'

/** 화면 모양을 보여주기 위한 예시 값. 실제 업무 기록이 아니다. */
export const EXAMPLE_HOME: MobileHomeDto = {
  workspaceId: 'preview-workspace',
  businessName: '예시 가게',
  timeZone: 'Asia/Seoul',
  generatedAt: OBSERVED_AT,
  agent: ready(
    { label: '예약 문의 답장 초안을 준비했어요', detailHref: '/app/sohee?tab=work&section=autonomy' },
    OBSERVED_AT,
  ),
  decisions: ready(
    {
      items: [
        {
          id: 'preview-today-approval-1',
          kind: 'post_publish',
          title: '게시 전 최종 확인이 필요해요',
          targetLabel: '인스타그램 · 예시 게시물',
          createdAt: '2026-10-23T07:30:00.000Z',
          expiresAt: null,
        },
        {
          id: 'preview-today-approval-2',
          kind: 'dm_reply',
          title: '고객 문의 답장을 확인해 주세요',
          targetLabel: '예약 문의 · 예시 고객',
          createdAt: '2026-10-23T08:00:00.000Z',
          expiresAt: null,
        },
      ],
      // 예시 건수는 실제 확인 건수처럼 읽히지 않도록 그리지 않는다.
      total: null,
      complete: true,
    },
    OBSERVED_AT,
  ),
  activity: ready(
    [
      { id: 'preview-today-activity-1', title: '인스타그램 게시물 · 가을 시술 안내', statusLabel: '검토 중', observedAt: '2026-10-23T07:20:00.000Z', evidenceRef: null },
      { id: 'preview-today-activity-2', title: '예약 문의 답장 초안 정리', statusLabel: '초안', observedAt: '2026-10-23T08:10:00.000Z', evidenceRef: null },
      { id: 'preview-today-activity-3', title: '주간 게시물 · 예약 안내 문구', statusLabel: '게시 확인', observedAt: '2026-10-21T05:00:00.000Z', evidenceRef: null },
    ],
    OBSERVED_AT,
  ),
  // 근거가 확인된 기록이 없으므로 조회 전 상태로 둔다. 예시 숫자를 실제 성과로 그리지 않는다.
  results: unknown(),
}

/** 자율근무 서버 readback 을 흉내 낸 정적 상태. useAutonomy 처럼 조회하지 않는다. */
const EXAMPLE_AUTONOMY_STATE: AutonomyServerState = {
  desiredMode: 'RUNNING',
  actualMode: 'RUNNING',
  // 진행 건수도 예시 숫자이므로 0 으로 두고 건수를 그리지 않는다.
  activeActionRunCount: 0,
  killSwitchActive: false,
  version: 1,
  observedAt: OBSERVED_AT,
}

const EXAMPLE_AUTONOMY: AutonomyController = {
  state: EXAMPLE_AUTONOMY_STATE,
  load: 'ready',
  errorMessage: '',
  conflict: false,
  refresh: () => {},
  setPaused: async () => ({
    ok: false,
    kind: 'failed',
    message: '예시 화면이라 자율근무를 바꾸지 않아요. 실제 변경은 앱에서 해 주세요.',
  }),
}
