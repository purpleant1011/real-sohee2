'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { useSoheeAutonomy } from '@/hooks/use-sohee-autonomy'
import { SafetyControlMenu } from '@/features/home/today-card'
import { BusyModeSwitch } from './busy-mode-switch'
import { HomeDisplayDensityToggle, type HomeDisplayDensity } from './home-display-density'
import { useLegacyHomeData } from './use-legacy-home-data'
import { LegacyHomeSections } from './legacy-home-sections'

// ANI-1741: 접힌 상태가 기본인 '자세히 보기(고급)' 영역은 펼칠 때만 내려받는다.
// 작업 보드·미션 콘솔 등 무거운 하위 트리를 초기 번들에서 제외한다.
export const AdvancedHome = dynamic(() => import('./advanced-home').then((module) => module.AdvancedHome), {
  loading: () => (
    <p role="status" className="text-sm text-muted-foreground">
      자세한 업무 현황을 준비하고 있어요.
    </p>
  ),
})

export function LegacyTodayHome({
  workspaceId,
  initialDensity = 'compact',
}: {
  workspaceId: string
  initialDensity?: HomeDisplayDensity
}) {
  const { isPaused, actualMode, isLoading: autonomyLoading, toggleAutonomy } = useSoheeAutonomy(workspaceId)
  const autonomyUnknown = !['RUNNING', 'PAUSED', 'OFF', 'BLOCKED'].includes(actualMode)
  const [density, setDensity] = useState<HomeDisplayDensity>(initialDensity)

  const data = useLegacyHomeData(workspaceId, { isPaused })
  const { businessName, greeting, todayDateString } = data

  return (
    <V088AppShell
      workspaceId={workspaceId}
      agentStatus={{
        state: autonomyUnknown ? 'stale' : actualMode === 'BLOCKED' ? 'blocked' : isPaused ? 'paused' : 'running',
      }}
    >
      <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6 pb-16">
        {/* 상단 헤더: 날짜/매장명 eyebrow, 인사말, 서브텍스트, 간략/상세 토글 & 안전 제어 */}
        <header className="space-y-2">
          {/* Eyebrow */}
          <div className="text-[11px] sm:text-xs font-semibold text-primary tracking-wide">
            {todayDateString}{businessName ? ` · ${businessName}` : ''}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {greeting}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                소희가 챙겨두었어요. 필요한 결정만 확인하세요.
              </p>
            </div>

            {/* 표시 밀도 전환(간략/상세) + 긴급 정지 / 시술 집중 모드 */}
            <div className="flex items-center gap-2.5 self-start sm:self-center flex-wrap">
              <HomeDisplayDensityToggle density={density} onChange={setDensity} />
              <BusyModeSwitch />
              {!autonomyUnknown && (
                <SafetyControlMenu
                  isPaused={isPaused}
                  onTogglePause={() => void toggleAutonomy()}
                />
              )}
            </div>
          </div>

          {/* 소희 자율근무 상태 한 줄 */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-medium ${
                isPaused
                  ? 'bg-state-quiet-soft border-state-quiet/30 text-state-quiet'
                  : 'bg-state-ok-soft border-state-ok/30 text-state-ok'
              }`}
            >
              <span
                className={`size-1.5 rounded-full animate-pulse ${
                  isPaused ? 'bg-state-quiet' : 'bg-state-ok'
                }`}
              />
              <span>
                {autonomyLoading
                  ? '소희 업무 상태 확인 중'
                  : autonomyUnknown
                    ? '소희 업무 상태 확인 안 됨'
                    : actualMode === 'BLOCKED'
                      ? '소희 업무 차단됨'
                      : isPaused
                        ? '소희 업무 일시 멈춤'
                        : '소희 자율근무 중'}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              사장님의 규칙 안에서 일하고 있어요
            </span>
          </div>
        </header>

        {/* 기존 본문 섹션 전체 (오늘 할 일 영웅 카드, 주간 기록, 빠른 승인, 사진 도구, 보관함, 최근 게시물, 고급 현황판) */}
        <LegacyHomeSections
          workspaceId={workspaceId}
          data={data}
          density={density}
          includeTodayHero
          includeWeeklyTruthSummary
          includeMagicPhotoDropzone
        />
      </div>
    </V088AppShell>
  )
}
