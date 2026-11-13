'use client'

import React from 'react'
import {
  AlertCircle,
  BookOpen,
  HelpCircle,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useGrowthSnapshot } from '@/features/sohee-menu/use-growth-snapshot'
import { BrainKnowledgeTab } from './brain-knowledge-tab'
import { KnowledgeJournalPanel } from './knowledge-journal-panel'
import { BrainCuriosityTab } from './brain-curiosity-tab'
import { BrainGoalsTab } from './brain-goals-tab'
import { BrainGrowthTab } from './brain-growth-tab'
import type { CuriosityItem, KnowledgeView, StudioOverviewData } from '../types'
import type { SoheeTab } from '@/features/sohee-menu/legacy-tab-map'

export type BrainTab = 'knowledge' | 'curiosity' | 'goals' | 'growth' | 'journal'

interface SoheeBrainDashboardProps {
  workspaceId: string
  overview: StudioOverviewData | null
  activeTab: BrainTab
  onTabChange: (tab: BrainTab) => void
  onAnswerQuestion: (q: CuriosityItem) => void
  onTellGoal: () => void
  onSelectKnowledgeForCorrection: (fact: KnowledgeView) => void
  onGoToLegacyTab?: (tab: SoheeTab) => void
  refreshTrigger: number
  overviewError?: string | null
  onRetryOverview?: () => void
}

export function SoheeBrainDashboard({
  workspaceId,
  overview,
  activeTab,
  onTabChange,
  onAnswerQuestion,
  onTellGoal,
  onSelectKnowledgeForCorrection,
  onGoToLegacyTab,
  refreshTrigger,
  overviewError,
  onRetryOverview,
}: SoheeBrainDashboardProps) {
  const { snapshot, error: growthError } = useGrowthSnapshot(workspaceId)

  // 가짜 기본값(60) 제거: 실제 데이터만 사용하고 없으면 null
  const readiness =
    typeof overview?.educationReadiness === 'number'
      ? overview.educationReadiness
      : typeof snapshot?.completenessPercent === 'number'
        ? snapshot.completenessPercent
        : typeof (snapshot as any)?.level?.percentage === 'number'
          ? (snapshot as any).level.percentage
          : null

  const activeKnowledgeCount = overview?.knowledgeStats?.activeCount
  const curiosityCount = overview?.topQuestions?.length
  const activeGoalCount = overview?.activeGoals?.length

  return (
    <Card className="rounded-[24px] border border-border bg-card/95 shadow-sm p-4 sm:p-5 space-y-4 sm:space-y-5 h-full max-h-[85dvh] lg:max-h-none flex flex-col backdrop-blur-sm overflow-hidden">
      {/* 1. 상단: 소희의 이해 상태 헤더 & 준비도 바 */}
      <div className="space-y-3 pb-3 sm:pb-4 border-b border-border/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-purple-100 dark:bg-purple-950/80 flex items-center justify-center text-purple-600 dark:text-purple-400">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-foreground">소희가 이해한 우리 매장</h3>
              <p className="text-xs text-muted-foreground">매장 지식 이해도 및 사업 목표 현황</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold text-purple-600 dark:text-purple-400">
              교육 준비도 {readiness !== null ? `${readiness}%` : '—'}
            </span>
          </div>
        </div>
        <Progress value={readiness ?? 0} className="h-2 rounded-full" />

        {overviewError && (
          <div className="flex items-center justify-between text-xs text-destructive bg-destructive/10 p-2.5 rounded-xl border border-destructive/20 mt-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>{overviewError}</span>
            </div>
            {onRetryOverview && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRetryOverview}
                className="h-7 text-xs px-2 text-destructive underline hover:bg-destructive/10 min-h-[36px]"
              >
                <RefreshCw className="size-3 mr-1" />
                다시 시도
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 2. 탭 네비게이션 */}
      <Tabs
        value={activeTab}
        onValueChange={(val) =>
          onTabChange(val as BrainTab)
        }
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList aria-label="소희 두뇌 기록" className="flex min-h-11 h-auto w-full justify-start gap-1 overflow-x-auto p-1 bg-muted/60 rounded-xl mb-3 shrink-0">
          <TabsTrigger
            value="knowledge"
            className="text-xs sm:text-sm font-bold flex items-center justify-center gap-1 data-[state=active]:bg-background data-[state=active]:shadow-xs rounded-lg min-h-[36px]"
          >
            <BookOpen className="size-3.5 sm:size-4" />
            <span>지식</span>
            {typeof activeKnowledgeCount === 'number' && activeKnowledgeCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-semibold">
                {activeKnowledgeCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="curiosity"
            className="text-xs sm:text-sm font-bold flex items-center justify-center gap-1 data-[state=active]:bg-background data-[state=active]:shadow-xs rounded-lg min-h-[36px]"
          >
            <HelpCircle className="size-3.5 sm:size-4" />
            <span className="truncate">궁금해요</span>
            {typeof curiosityCount === 'number' && curiosityCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-semibold">
                {curiosityCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="goals"
            className="text-xs sm:text-sm font-bold flex items-center justify-center gap-1 data-[state=active]:bg-background data-[state=active]:shadow-xs rounded-lg min-h-[36px]"
          >
            <Target className="size-3.5 sm:size-4" />
            <span>목표</span>
            {typeof activeGoalCount === 'number' && activeGoalCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-semibold">
                {activeGoalCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="journal" className="min-h-11 shrink-0 rounded-lg">
            <BookOpen aria-hidden="true" />
            <span>일지</span>
          </TabsTrigger>
          <TabsTrigger
            value="growth"
            className="text-xs sm:text-sm font-bold flex items-center justify-center gap-1 data-[state=active]:bg-background data-[state=active]:shadow-xs rounded-lg min-h-[36px]"
          >
            <TrendingUp className="size-3.5 sm:size-4" />
            <span>성장</span>
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="knowledge" className="m-0 mt-1">
            <BrainKnowledgeTab
              workspaceId={workspaceId}
              onSelectKnowledgeForCorrection={onSelectKnowledgeForCorrection}
              onRefreshTrigger={refreshTrigger}
              onGoToLegacyTab={onGoToLegacyTab}
            />
          </TabsContent>

          <TabsContent value="curiosity" className="m-0 mt-1">
            <BrainCuriosityTab
              workspaceId={workspaceId}
              onAnswerQuestion={onAnswerQuestion}
              onRefreshTrigger={refreshTrigger}
            />
          </TabsContent>

          <TabsContent value="goals" className="m-0 mt-1">
            <BrainGoalsTab
              workspaceId={workspaceId}
              onTellGoal={onTellGoal}
              onRefreshTrigger={refreshTrigger}
            />
          </TabsContent>

          <TabsContent value="journal" className="m-0 mt-1">
            <KnowledgeJournalPanel workspaceId={workspaceId} />
          </TabsContent>

          <TabsContent value="growth" className="m-0 mt-1">
            <BrainGrowthTab workspaceId={workspaceId} onGoToLegacyTab={onGoToLegacyTab} />
          </TabsContent>
        </div>
      </Tabs>
    </Card>
  )
}
