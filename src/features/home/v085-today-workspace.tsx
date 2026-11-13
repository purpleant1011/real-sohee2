'use client'

import React from 'react'
import type { TodayWorkspaceModel } from './today-workspace.types'
import { V085MorningBriefing } from './v085-morning-briefing'
import { V085ApprovalInbox } from './v085-approval-inbox'
import { V085CustomerOpportunities } from './v085-customer-opportunities'
import { V085BookingConversion } from './v085-booking-conversion'
import { V085TodaySchedule } from './v085-today-schedule'
import { V085CommandCenter } from './v085-command-center'
import styles from './v085-today-workspace.module.css'

export type V085TodayWorkspaceProps = Readonly<{
  workspaceId?: string
  initialData?: TodayWorkspaceModel
}>

export function V085TodayWorkspace({
  workspaceId,
  initialData,
}: V085TodayWorkspaceProps) {
  const goalSecured = initialData?.growthFlow ? initialData.growthFlow.bookings + 2 : 3

  return (
    <div
      className={styles.container}
      data-testid="v085-today-workspace"
      data-workspace-id={workspaceId}
    >
      {/* 1. 8월 30일 · 오늘의 브리핑 (최우선 목표 + 소희가 지금 하는 일) */}
      <V085MorningBriefing
        dateStr="8월 30일 · 오늘의 브리핑"
        ownerName="사장님"
        primaryGoalTitle="이번 주 빈 예약 3자리를 채울게요."
        primaryGoalDesc="최근 문의 고객과 반응이 좋았던 인기 콘텐츠를 연결해 예약 전환을 만들고 있어요."
        goalProgress={{
          secured: goalSecured,
          target: 5,
          remainingDays: 2,
        }}
        currentActionText="미예약 문의 4명에게 재접촉 중"
        currentActionMeta="Instagram · 다음 실행 10:30"
      />

      {/* 2. 사장님 확인 필요 (Instagram 피드 v4 + 네이버 플레이스 답글) */}
      <V085ApprovalInbox />

      {/* 3. 오늘의 고객 기회 (Instagram 김하늘 님 + 네이버 플레이스 이지수 님) */}
      <V085CustomerOpportunities />

      {/* 4. 이번 주 예약 전환 (8/10건 실측) & 소희의 운영 메모 */}
      <V085BookingConversion
        currentBookings={8}
        targetBookings={10}
        increaseOverLastWeek={2}
        memos={[
          '우리 매장다운 이야기에 반응이 모이고 있어요.',
          '대표 사장님의 꼼꼼한 상담이 가장 강한 신뢰 요소예요.',
          '“과하지 않고 자연스럽게”라는 문장이 저장 반응을 만들고 있어요.',
        ]}
      />

      {/* 5. 오늘 일정 (소희의 근무표: 09:00, 10:30, 18:00) */}
      <V085TodaySchedule />

      {/* 6. 소희에게 지시하기 (Command Center) */}
      <V085CommandCenter />
    </div>
  )
}
