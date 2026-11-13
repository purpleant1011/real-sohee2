'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { MissionConsole } from '@/components/v088/work/mission-console'
import { CampaignExperimentView } from '@/components/v088/work/campaign-experiment-view'
import { RunningTasksView, WaitingTasksView, CompletedTasksView } from '@/components/v088/work/work-tab-views'
import {
  Sparkles,
  Clock,
  CheckCircle2,
  Sliders,
  Target,
  Zap,
  Activity,
  ChevronDown,
  AlertCircle,
  ArrowUp,
  Calendar
} from 'lucide-react'
import { SoheeLiveWorkboard } from '@/components/agent-os/sohee-live-workboard'
import { toast } from 'sonner'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { useSoheeAutonomy } from '@/hooks/use-sohee-autonomy'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { EmployeeInbox } from '@/components/v088/same-truth/EmployeeInbox'
import type { WorkspaceCanonicalReadModel } from '@/features/canonical-read-model/types'

interface WorkSubTabItem {
  id: 'pipeline' | 'campaigns' | 'running' | 'waiting' | 'completed'
  label: string
  icon: React.ElementType
}

const WORK_SUB_TABS: WorkSubTabItem[] = [
  { id: 'pipeline', label: '주간 프로모션 파이프라인', icon: Zap },
  { id: 'campaigns', label: '캠페인 & A/B 실험실', icon: Target },
  { id: 'running', label: '백그라운드 태스크', icon: Activity },
  { id: 'waiting', label: '발행/예약 대기열', icon: Clock },
  { id: 'completed', label: '완료된 업무 기록', icon: CheckCircle2 }
]

interface CommandCenterClientProps {
  workspaceId?: string
}

export function CommandCenterClient({ workspaceId: propWorkspaceId }: CommandCenterClientProps = {}) {
  const context = useOptionalWorkspaceContext()
  const workspaceId = (propWorkspaceId && propWorkspaceId !== 'ws-default')
    ? propWorkspaceId
    : (context?.workspaceId || '')
  const { isPaused } = useSoheeAutonomy()
  const [activeWorkTab, setActiveWorkTab] = useState<WorkSubTabItem['id']>('pipeline')
  const [businessName, setBusinessName] = useState('매장')
  const [readModel, setReadModel] = useState<WorkspaceCanonicalReadModel | null>(null)
  const [isLoadingReadModel, setIsLoadingReadModel] = useState(true)
  const [showAdvancedWorkbench, setShowAdvancedWorkbench] = useState(false)
  const [heroPrompt, setHeroPrompt] = useState('')
  const runExternalWrite = useExternalWriteGuard()

  /**
   * 승인·거절은 외부로 나가는 쓰기다. 오프라인에서는 시작하지 않고(fail-closed),
   * 같은 업무를 처리하는 동안 다시 눌러도 한 번만 나간다 — ANI-1778 가드가 앞단에서 막는다.
   * 승인과 거절이 같은 키를 쓰므로 한 업무에 대한 두 조작이 동시에 나가지 않는다.
   */
  const runChannelAction = async (action: 'approve' | 'reject', jobId: string) => {
    const outcome = await runExternalWrite('publish', `channel-job:${jobId}`, async () => {
      await fetch(`/api/channels/actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
    })
    if (!outcome.ran) toast.error(outcome.decision.message)
  }

  // 🌟 Fetch Canonical Read Model for Same-Truth State
  useEffect(() => {
    if (!workspaceId || workspaceId === 'ws-default') return
    let isMounted = true

    fetch(`/api/workspaces/${workspaceId}/canonical-read-model`)
      .then((res) => res.json())
      .then((json) => {
        if (isMounted && json.success && json.data) {
          setReadModel(json.data)
          if (json.data.businessName?.value) {
            setBusinessName(json.data.businessName.value)
          }
        }
      })
      .catch((err) => {
        console.warn('[CommandCenterClient] Read model fetch warning:', err)
      })
      .finally(() => {
        if (isMounted) setIsLoadingReadModel(false)
      })

    return () => {
      isMounted = false
    }
  }, [workspaceId])

  const renderWorkSubView = () => {
    switch (activeWorkTab) {
      case 'pipeline':
        return <MissionConsole isTestAccount={false} />
      case 'campaigns':
        return <CampaignExperimentView isTestAccount={false} />
      case 'running':
        return <RunningTasksView isTestAccount={false} />
      case 'waiting':
        return <WaitingTasksView isTestAccount={false} />
      case 'completed':
        return <CompletedTasksView isTestAccount={false} />
      default:
        return <MissionConsole isTestAccount={false} />
    }
  }

  const inboxItems = readModel?.inbox || []
  const pendingApprovalsCount = inboxItems.filter(i => i.status === 'approval_required').length
  const recentActionsCount = readModel?.recentActionsCount || 0
  const connectedChannels = readModel?.channels?.filter(c => c.isAuthorized) || []
  const customerInquiriesCount = readModel?.inbox?.filter(i => i.category === 'dm' || i.category === 'comment').length || 0

  const [isSubmittingHero, setIsSubmittingHero] = useState(false)
  const [heroStatusMessage, setHeroStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null)

  const handleHeroSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!heroPrompt.trim() || isSubmittingHero) return

    setIsSubmittingHero(true)
    setHeroStatusMessage(null)

    try {
      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'HOME_COMMAND_BAR',
          intent: heroPrompt.trim(),
          channelTargets: ['instagram', 'threads'],
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.success) {
        setHeroStatusMessage({ text: '새 마케팅 지시가 접수되었습니다! 소희가 작업을 준비합니다.' })
        setHeroPrompt('')
      } else if (res.status === 403 || data.error?.code === 'SOHEE_NOT_READY') {
        setHeroStatusMessage({
          text: data.error?.message || '온보딩이 완료되지 않아 작업을 생성할 수 없습니다. 온보딩을 먼저 완료해 주세요.',
          isError: true,
        })
      } else {
        setHeroStatusMessage({
          text: data.error?.message || data.error || '지시 전달 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
          isError: true,
        })
      }
    } catch (err: any) {
      setHeroStatusMessage({
        text: err.message || '네트워크 오류가 발생했습니다.',
        isError: true,
      })
    } finally {
      setIsSubmittingHero(false)
    }
  }

  return (
    <V088AppShell
      workspaceId={workspaceId}
      agentStatus={{
        state: isPaused ? 'paused' : 'running',
        focusMissionTitle: `${businessName} 맞춤형 자율 마케팅 실행 준비 완료`,
        pendingDecisionsCount: pendingApprovalsCount
      }}
    >
      <div className="space-y-6 max-w-5xl mx-auto font-sans pb-12">
        {/* 🌟 1. 소희 상태 & 사장님 아침 인사 영역 (Human-First Status Banner) */}
        <section
          aria-label="소희 업무 브리핑"
          className="p-6 md:p-7 rounded-3xl bg-card border border-border shadow-xs space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-md">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-black text-foreground tracking-tight">
                  좋은 하루예요, {businessName} 사장님!
                </h1>
                <p className="text-sm font-medium text-primary mt-0.5">
                  {isPaused
                    ? '소희가 잠시 쉬고 있어요. 다시 일을 시키려면 대화창이나 아래에 지시를 입력해 주세요.'
                    : '소희가 오늘 매장 인스타그램·스레드 홍보와 고객 응대를 준비하고 있어요.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                isPaused
                  ? 'bg-muted text-muted-foreground border-border'
                  : 'bg-accent text-accent-foreground border-border'
              }`}>
                <span className={`w-2 h-2 rounded-full ${isPaused ? 'bg-muted-foreground' : 'bg-primary animate-pulse'}`} />
                {isPaused ? '휴식 중' : '정상 근무 중'}
              </span>
            </div>
          </div>

          {/* 소희의 다음 행동 한 줄 브리핑 */}
          <div className="p-3.5 rounded-2xl bg-muted/60 border border-border flex items-center gap-3 text-xs md:text-sm text-foreground">
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <span className="font-semibold">
              오늘의 다음 계획: 이번 주말 예약 유치를 위한 1:1 맞춤형 피드 1건을 기획 중이에요.
            </span>
          </div>
        </section>

        {/* 🌟 2. 사장님 중심 3대 핵심 요약 카드 (Today's 3 Pillars) */}
        <section aria-label="핵심 상태 3개 축" className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 카드 1: 지금 확인할 것 */}
          <div className={`p-5 rounded-3xl border transition-all ${
            pendingApprovalsCount > 0
              ? 'bg-card border-primary shadow-xs ring-1 ring-primary/20'
              : 'bg-card border-border'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-muted-foreground">지금 확인할 일</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
                pendingApprovalsCount > 0
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {pendingApprovalsCount}건
              </span>
            </div>
            <h3 className="text-lg font-black text-foreground">
              {pendingApprovalsCount > 0 ? '사장님 확인 필요' : '모두 확인 완료'}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {pendingApprovalsCount > 0
                ? '소희가 작성한 새 글 원고를 검토하고 승인해 주세요.'
                : '기다리고 있는 결정 사항이 없어요. 편안한 하루 보내세요!'}
            </p>
          </div>

          {/* 카드 2: 오늘 소희가 한 일 (readModel 기반 동적 도출) */}
          <div className="p-5 rounded-3xl bg-card border border-border shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-muted-foreground">오늘 소희가 한 일</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-black bg-muted text-foreground">
                {recentActionsCount > 0 ? `${recentActionsCount}건 완료` : '기록 대기'}
              </span>
            </div>
            <h3 className="text-lg font-black text-foreground">
              {recentActionsCount > 0 ? '마케팅 액션 및 채널 모니터링' : '아직 완료된 업무가 없습니다'}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {recentActionsCount > 0
                ? '소희가 매장 지침에 맞춰 최근 완료한 작업이 기록되었습니다.'
                : '소희에게 새로운 작업을 지시하거나 루틴이 가동되면 이곳에 완료 내역이 표시됩니다.'}
            </p>
          </div>

          {/* 카드 3: 이번 주 결과 (readModel 기반 관측값) */}
          <div className="p-5 rounded-3xl bg-card border border-border shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-muted-foreground">이번 주 결과</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-black bg-muted text-foreground">
                {connectedChannels.length > 0 ? `${connectedChannels.length}개 채널 연동` : '미연동'}
              </span>
            </div>
            <h3 className="text-lg font-black text-foreground">
              {connectedChannels.length === 0
                ? '관측된 결과 없음'
                : customerInquiriesCount > 0
                ? `문의 ${customerInquiriesCount}건 관측`
                : '채널 모니터링 중'}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {connectedChannels.length === 0
                ? '소셜 채널을 연결하고 콘텐츠를 게시하면 실제 유입 결과가 집계됩니다.'
                : customerInquiriesCount > 0
                ? '소희가 유입된 고객 문의를 실시간으로 확인하고 있어요.'
                : '연결된 채널을 통해 새로운 반응과 문의를 기다리고 있습니다.'}
            </p>
          </div>
        </section>

        {/* 🌟 3. 가장 강력한 CTA: "소희에게 부탁하기" Hero Input */}
        <section aria-label="소희에게 부탁하기" className="p-6 rounded-3xl bg-card border border-border shadow-md space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-base font-black text-foreground">
              소희에게 부탁하기
            </h2>
          </div>

          <form onSubmit={handleHeroSubmit} className="relative flex items-center">
            <input
              type="text"
              value={heroPrompt}
              onChange={(e) => setHeroPrompt(e.target.value)}
              placeholder="예: '이번 주말 예약 유치 인스타 글 써줘', '글 조금 더 친근하게 바꿔줘'..."
              className="w-full px-5 py-4 pr-14 rounded-2xl bg-muted/50 border border-border text-sm md:text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-12"
            />
            <button
              type="submit"
              disabled={!heroPrompt.trim() || isSubmittingHero}
              className="absolute right-2 p-3 rounded-xl bg-primary hover:opacity-90 disabled:bg-muted text-primary-foreground disabled:text-muted-foreground transition-all cursor-pointer disabled:cursor-not-allowed shadow-xs"
              aria-label="보내기"
            >
              <ArrowUp className={`w-5 h-5 ${isSubmittingHero ? 'animate-spin' : ''}`} />
            </button>
          </form>

          {heroStatusMessage && (
            <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border animate-in fade-in ${
              heroStatusMessage.isError
                ? 'bg-destructive/10 text-destructive border-destructive/20'
                : 'bg-muted text-foreground border-border'
            }`}>
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{heroStatusMessage.text}</span>
            </div>
          )}

          {/* 추천 제안 칩 */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-bold text-muted-foreground">추천 부탁:</span>
            {[
              '이번 주말 예약 유치 글 작성해줘',
              '자연스럽고 따뜻한 톤으로 인스타 글 써줘',
              '우리 매장 이번 주 성과 요약해줘'
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setHeroPrompt(chip)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-muted text-foreground border border-border hover:bg-card transition-colors cursor-pointer"
              >
                {chip}
              </button>
            ))}
          </div>
        </section>

        {/* 🌟 4. 승인 대기 수신함 (Inbox Items, 있을 때만 적극 강조) */}
        {pendingApprovalsCount > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">
                사장님 확인이 필요한 항목 ({pendingApprovalsCount}건)
              </h3>
            </div>
            <EmployeeInbox
              items={inboxItems}
              onApprove={(id) => { void runChannelAction('approve', id) }}
              onReject={(id) => { void runChannelAction('reject', id) }}
            />
          </div>
        )}

        {/* 🌟 5. 단계적 공개: 전문 워크벤치 & 상세 기록 (Progressive Disclosure) */}
        <section aria-label="전문 워크벤치" className="pt-4 border-t border-border">
          <button
            type="button"
            onClick={() => setShowAdvancedWorkbench(!showAdvancedWorkbench)}
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-muted/40 border border-border hover:bg-muted text-foreground transition-all cursor-pointer min-h-12"
          >
            <div className="flex items-center gap-3">
              <Sliders className="w-5 h-5 text-primary" />
              <div className="text-left">
                <span className="text-sm font-bold block">
                  전문 워크벤치 & 실행 파이프라인 상세 보기
                </span>
                <span className="text-xs text-muted-foreground">
                  자율 근무 현황판, 캠페인 실험실, 백그라운드 태스크 및 발행 대기열
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
              <span>{showAdvancedWorkbench ? '접기' : '펼치기'}</span>
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showAdvancedWorkbench ? 'rotate-180' : ''}`} />
            </div>
          </button>

          {showAdvancedWorkbench && (
            <div className="mt-6 space-y-6 animate-in fade-in duration-300">
              {/* Sohee Live Workboard (전문 현황판) */}
              <SoheeLiveWorkboard workspaceId={workspaceId} />

              {/* 5개 세부 탭 워크벤치 */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl bg-muted border border-border shadow-2xs">
                    {WORK_SUB_TABS.map((tab) => {
                      const Icon = tab.icon
                      const isActive = activeWorkTab === tab.id
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveWorkTab(tab.id)}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-primary text-primary-foreground shadow-md'
                              : 'text-muted-foreground hover:text-foreground hover:bg-card'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{tab.label}</span>
                        </button>
                      )
                    })}
                  </div>

                  <Link
                    href="/app/sohee?tab=routines"
                    className="px-3.5 py-1.5 rounded-xl bg-card border border-border text-xs font-bold text-primary hover:bg-muted transition-all flex items-center gap-1.5 shadow-2xs"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>업무 루틴 세부 셋업</span>
                  </Link>
                </div>

                <div className="animate-in fade-in duration-200">
                  {renderWorkSubView()}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </V088AppShell>
  )
}
