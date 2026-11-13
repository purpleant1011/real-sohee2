'use client'

import { useState } from 'react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { useMobileHome } from '@/features/mobile-decision/use-mobile-home'
import { useSoheeAutonomy } from '@/hooks/use-sohee-autonomy'
import { BusyModeSwitch } from '@/components/home-today/busy-mode-switch'
import { SafetyControlMenu } from '@/features/home/today-card'
import { HomeDisplayDensityToggle, type HomeDisplayDensity } from '@/components/home-today/home-display-density'
import { useLegacyHomeData } from '@/components/home-today/use-legacy-home-data'
import { TodayHeroSection, LegacyHomeSections } from '@/components/home-today/legacy-home-sections'
import { PcDecisionList } from './pc-decision-list'
import { PcActivityList } from './pc-activity-list'
import { PcWeeklyResults } from './pc-weekly-results'
import { PcRightDock } from './pc-right-dock'

export interface PcTodayHomeProps {
  workspaceId: string
  initialDensity?: HomeDisplayDensity
}

function formatPcTodayDate(timeZone?: string | null, generatedAt?: string | null): string {
  try {
    const date = generatedAt ? new Date(generatedAt) : new Date()
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: timeZone ?? 'Asia/Seoul',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(date)
  } catch {
    return '오늘'
  }
}

export function PcTodayHome({ workspaceId, initialDensity = 'compact' }: PcTodayHomeProps) {
  const [density, setDensity] = useState<HomeDisplayDensity>(initialDensity)
  const { view, loading, error, refresh: refreshMobileHome } = useMobileHome(workspaceId)
  const { isPaused, actualMode, isLoading: autonomyLoading, toggleAutonomy } = useSoheeAutonomy(workspaceId)
  const legacyData = useLegacyHomeData(workspaceId, { isPaused })

  const autonomyUnknown = !['RUNNING', 'PAUSED', 'OFF', 'BLOCKED'].includes(actualMode)
  const todayDateString = legacyData.todayDateString || formatPcTodayDate(view?.timeZone, view?.generatedAt)

  const businessName = (legacyData.businessName || view?.businessName || '').trim()
  const greeting = businessName
    ? `${businessName} 사장님, 오늘도 소희가 함께해요`
    : '사장님, 오늘도 소희가 함께해요'

  return (
    <V088AppShell
      workspaceId={workspaceId}
      agentStatus={{
        state: autonomyUnknown ? 'stale' : actualMode === 'BLOCKED' ? 'blocked' : isPaused ? 'paused' : 'running',
      }}
    >
      <div className="mx-auto max-w-[1440px] space-y-6 pb-28 md:pb-36">
        {/* 상단 브리핑 헤더 */}
        <header className="space-y-2">
          <div className="text-xs font-semibold text-primary tracking-wide">
            {todayDateString}{businessName ? ` · ${businessName}` : ''}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl break-keep">
                {greeting}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 break-keep">
                소희가 챙겨두었어요. 필요한 결정만 확인하세요.
              </p>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center flex-wrap shrink-0">
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
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
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

        {/* 1. 홈 최상단 "오늘 할 일 1개" 영웅 카드 (3열 위 전체 폭) */}
        <TodayHeroSection data={legacyData} density={density} />

        {/* 3열 관제 화면 그리드 (1024px 이상: 3열 5:4:3, 소형: 1열) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* 1열 (왼쪽 큰 열): 지금 확인할 일 + 소희가 한 일 */}
          <div className="lg:col-span-5 space-y-6">
            <PcDecisionList
              decisions={view?.decisions ?? { state: loading ? 'loading' : error ? 'error' : 'ready', data: null, observedAt: null, validUntil: null }}
              onRefresh={refreshMobileHome}
            />
            <PcActivityList
              activity={view?.activity ?? { state: loading ? 'loading' : error ? 'error' : 'ready', data: null, observedAt: null, validUntil: null }}
              onRefresh={refreshMobileHome}
            />
          </div>

          {/* 2열 (가운데 열): 이번 주 성과 요약 카드 */}
          <div className="lg:col-span-4">
            <PcWeeklyResults
              results={view?.results ?? { state: loading ? 'loading' : error ? 'error' : 'ready', data: null, observedAt: null, validUntil: null }}
              onRefresh={refreshMobileHome}
            />
          </div>

          {/* 3열 (오른쪽 열): 일 맡기기 + 사진 CTA + 바로가기 */}
          <div className="lg:col-span-3">
            <PcRightDock workspaceId={workspaceId} />
          </div>
        </div>

        {/* 3열 아래: 상세 업무 영역 (빠른 승인 센터, 보관함 현황, 최근 게시물, 로드맵, 고급 현황판) */}
        <section aria-label="상세 업무" className="space-y-6 pt-8 border-t border-border/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                상세 업무 관리
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                빠른 승인 센터, 보관함 현황 및 소희 업무 로드맵을 심층적으로 관리해요.
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-muted text-muted-foreground self-start sm:self-auto border border-border/60">
              심층 관리 영역
            </span>
          </div>

          <LegacyHomeSections
            workspaceId={workspaceId}
            data={legacyData}
            density={density}
            includeTodayHero={false}
            includeWeeklyTruthSummary={false}
            includeMagicPhotoDropzone={false}
          />
        </section>
      </div>
    </V088AppShell>
  )
}
