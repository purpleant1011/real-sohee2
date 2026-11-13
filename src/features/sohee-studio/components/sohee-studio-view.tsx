'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { MessageSquare, Sparkles } from 'lucide-react'
import { SoheeConversationConsole } from './sohee-conversation-console'
import { SoheeBrainDashboard, type BrainTab } from './sohee-brain-dashboard'
import { Button } from '@/components/ui/button'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import type { CuriosityItem, KnowledgeView, StudioOverviewData } from '../types'
import type { SoheeTab } from '@/features/sohee-menu/legacy-tab-map'

interface SoheeStudioViewProps {
  workspaceId: string
  onGoToLegacyTab?: (tab: SoheeTab) => void
}

export function SoheeStudioView({ workspaceId, onGoToLegacyTab }: SoheeStudioViewProps) {
  const [overview, setOverview] = useState<StudioOverviewData | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [activeBrainTab, setActiveBrainTab] = useState<BrainTab>('knowledge')
  const [selectedCuriosity, setSelectedCuriosity] = useState<CuriosityItem | null>(null)
  const [selectedKnowledge, setSelectedKnowledge] = useState<KnowledgeView | null>(null)
  const [goalRequestToken, setGoalRequestToken] = useState(0)
  // 모바일 표현(m.example.com·휴대폰)은 화면 폭이 아니라 표현 모드로 한 패널씩 보여 준다.
  const mobile = useMobileR2Active()
  const [mobileActivePane, setMobileActivePane] = useState<'console' | 'brain'>('console')

  const fetchOverview = useCallback(async () => {
    setOverviewError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-studio/overview`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json().catch(() => ({}))
      if (json.success && json.data) {
        setOverview(json.data)
      } else {
        throw new Error(json.message || '두뇌 현황 조회 실패')
      }
    } catch (err: any) {
      console.error('Failed to fetch studio overview:', err)
      setOverviewError('두뇌 현황 데이터를 불러오지 못했습니다.')
    }
  }, [workspaceId])

  useEffect(() => {
    void fetchOverview()
  }, [fetchOverview, refreshTrigger])

  const handleRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1)
  }, [])

  const handleAnswerQuestion = useCallback((q: CuriosityItem) => {
    setSelectedCuriosity(q)
    setSelectedKnowledge(null)
    setMobileActivePane('console')
  }, [])

  const handleSelectKnowledgeForCorrection = useCallback((fact: KnowledgeView) => {
    setSelectedKnowledge(fact)
    setSelectedCuriosity(null)
    setMobileActivePane('console')
  }, [])

  const handleTellGoal = useCallback(() => {
    setSelectedCuriosity(null)
    setSelectedKnowledge(null)
    setGoalRequestToken((prev) => prev + 1)
    setMobileActivePane('console')
  }, [])

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => {
          setActiveBrainTab('journal')
          setMobileActivePane('brain')
        }}>지시·학습 일지</Button>
      </div>
      {/* 모바일 전용 뷰 전환 스위처 */}
      <div className={`${mobile ? 'flex' : 'flex lg:hidden'} bg-muted/60 p-1 rounded-xl`}>
        <button
          type="button"
          onClick={() => setMobileActivePane('console')}
          className={`flex-1 min-h-11 py-1.5 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
            mobileActivePane === 'console'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground'
          }`}
        >
          <MessageSquare className="size-3.5" />
          <span>소희와 대화</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileActivePane('brain')}
          className={`flex-1 min-h-11 py-1.5 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
            mobileActivePane === 'brain'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground'
          }`}
        >
          <Sparkles className="size-3.5 text-purple-600" />
          <span>소희의 두뇌</span>
        </button>
      </div>

      {/* 데스크톱 2-Pane 그리드 (좌: 대화 콘솔 60%, 우: 두뇌 관제 40%) */}
      <div className={mobile ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[580px] lg:min-h-[680px] items-stretch'}>
        {/* 좌측: 소희 대화 콘솔 */}
        <div
          className={mobile
            ? `h-[calc(100dvh-14rem)] min-h-[420px] ${mobileActivePane === 'console' ? 'block' : 'hidden'}`
            : `lg:col-span-7 xl:col-span-7 h-[calc(100dvh-200px)] min-h-[500px] lg:h-[680px] ${mobileActivePane === 'console' ? 'block' : 'hidden lg:block'}`}
        >
          <SoheeConversationConsole
            workspaceId={workspaceId}
            onFactOrGoalConfirmed={handleRefresh}
            selectedCuriosityForAnswer={selectedCuriosity}
            selectedKnowledgeForCorrection={selectedKnowledge}
            goalRequestToken={goalRequestToken}
            onClearSelectedCuriosity={() => setSelectedCuriosity(null)}
            onClearSelectedCorrection={() => setSelectedKnowledge(null)}
          />
        </div>

        {/* 우측: 소희의 두뇌 대시보드 */}
        <div
          className={mobile
            ? `h-[calc(100dvh-14rem)] min-h-[420px] ${mobileActivePane === 'brain' ? 'block' : 'hidden'}`
            : `lg:col-span-5 xl:col-span-5 h-[calc(100dvh-200px)] min-h-[500px] lg:h-[680px] ${mobileActivePane === 'brain' ? 'block' : 'hidden lg:block'}`}
        >
          <SoheeBrainDashboard
            workspaceId={workspaceId}
            overview={overview}
            activeTab={activeBrainTab}
            onTabChange={setActiveBrainTab}
            onAnswerQuestion={handleAnswerQuestion}
            onTellGoal={handleTellGoal}
            onSelectKnowledgeForCorrection={handleSelectKnowledgeForCorrection}
            onGoToLegacyTab={onGoToLegacyTab}
            refreshTrigger={refreshTrigger}
            overviewError={overviewError}
            onRetryOverview={() => void fetchOverview()}
          />
        </div>
      </div>
    </div>
  )
}
