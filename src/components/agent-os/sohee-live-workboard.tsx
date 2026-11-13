'use client'

import React from 'react'
import type { WorkboardSnapshot } from '@/features/agent-os/workboard-types'
import { RuntimeStateBadge } from './runtime-state-badge'
import { MissionStageRail } from './mission-stage-rail'
import { AppliedOwnerRules } from './applied-owner-rules'
import { ProofSummary } from './proof-summary'
import { cn } from '@/lib/utils'
import { Sparkles, Target, ArrowRight, AlertTriangle, ShieldCheck, Clock, ChevronDown } from 'lucide-react'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'

export interface SoheeLiveWorkboardProps {
  snapshot?: WorkboardSnapshot | null
  workspaceId?: string
  className?: string
}

/** 모바일 표현에서는 접힌 한 줄로 시작해 화면 첫머리를 PC용 현황판이 차지하지 않게 한다. 데이터·기능은 같다. */
export function SoheeLiveWorkboard(props: SoheeLiveWorkboardProps) {
  const mobile = useMobileR2Active()
  if (!mobile) return <SoheeLiveWorkboardFull {...props} />
  return (
    <details className="group mb-4 rounded-2xl border border-border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold">
        <span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-primary" aria-hidden="true" />업무 현황 보기</span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-2 pb-2"><SoheeLiveWorkboardFull {...props} className={cn('mb-0 shadow-none', props.className)} /></div>
    </details>
  )
}

function SoheeLiveWorkboardFull({ snapshot, workspaceId, className }: SoheeLiveWorkboardProps) {
  const [fetchedSnapshot, setFetchedSnapshot] = React.useState<WorkboardSnapshot | null>(null)

  React.useEffect(() => {
    if (!snapshot && workspaceId) {
      let isMounted = true
      fetch(`/api/workspaces/${workspaceId}/agent/workboard?_t=${Date.now()}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (isMounted && data?.workspaceId === workspaceId && Array.isArray(data.appliedRules)) {
            setFetchedSnapshot(data)
          }
        })
        .catch(() => null)
      return () => {
        isMounted = false
      }
    }
  }, [snapshot, workspaceId])

  // Default fallback snapshot if not provided (safe initial render)
  const data: WorkboardSnapshot = (snapshot && (!workspaceId || snapshot.workspaceId === workspaceId) ? snapshot : null)
    || (fetchedSnapshot?.workspaceId === workspaceId ? fetchedSnapshot : null) || {
    workspaceId: workspaceId || 'ws-default',
    runtimeState: 'DEGRADED',
    statusReason: '업무 상태를 확인하지 못했어요',
    mission: null,
    appliedRules: [],
    lastProof: null,
    nextAction: null,
    ownerActionRequiredCount: 0,
    freshness: 'UNKNOWN',
    updatedAt: new Date().toISOString(),
  }

  const isPaused = data.runtimeState === 'PAUSED'
  const isBlocked = data.runtimeState === 'BLOCKED'
  const hasExceptions = data.ownerActionRequiredCount > 0

  return (
    <section
      aria-label="소희의 자세한 업무 현황"
      className={cn(
        'w-full rounded-2xl bg-card border border-border p-5 shadow-xs transition-all space-y-4 mb-6',
        isBlocked && 'border-state-danger/40 bg-state-danger-soft',
        className
      )}
    >
      {/* 1. Header Bar: Identity + State Badge + Freshness */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0 shadow-2xs">
            <Sparkles className="w-4.5 h-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-foreground tracking-tight leading-none">
                소희의 자세한 업무 현황
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.statusReason}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {data.datasetMode && (
            <span className={cn(
              "text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border",
              data.datasetMode === 'ACTUAL'
                ? "bg-state-ok-soft text-state-ok border-state-ok/40"
                : "bg-state-warn-soft text-state-warn border-state-warn/40"
            )}>
              {data.datasetMode === 'ACTUAL' ? '실제 운영' : data.datasetMode === 'SHOWCASE_DEMO' ? '체험 모드' : '테스트 화면'}
            </span>
          )}
          <RuntimeStateBadge state={data.runtimeState} freshness={data.freshness} />
        </div>
      </div>

      {/* 2. Exception Alert Banner (if owner action is required) */}
      {hasExceptions && (
        <div className="p-3 rounded-xl bg-state-warn-soft border border-state-warn/40 flex items-center justify-between gap-3 text-xs font-bold text-state-warn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-state-warn shrink-0" />
            <span>사장님의 승인 또는 판단이 필요한 예외가 {data.ownerActionRequiredCount}건 대기 중입니다.</span>
          </div>
          <span className="text-[11px] font-extrabold">
            소희와 대화하며 확인해 주세요
          </span>
        </div>
      )}

      {/* 3. Main Mission & Progress Stage Rail */}
      {data.mission ? (
        <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-black text-primary bg-primary/10 px-2 py-0.5 rounded-md shrink-0">
                진행 중인 업무
              </span>
              <span className="text-sm font-extrabold text-foreground truncate">
                {data.mission.title}
              </span>
            </div>
            {data.mission.businessGoal && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 font-medium">
                <Target className="w-3.5 h-3.5 text-state-ok" />
                <span>목표: {data.mission.businessGoal}</span>
              </div>
            )}
          </div>

          <MissionStageRail
            currentStage={data.mission.stage}
            stageProgress={data.mission.stageProgress}
          />
        </div>
      ) : isPaused ? (
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-border/60 text-center py-5 space-y-1">
          <p className="text-sm font-extrabold text-zinc-700 dark:text-zinc-300">
            소희의 업무가 잠시 멈췄어요.
          </p>
          <p className="text-xs text-muted-foreground">
            소희와 대화하거나 재개 버튼을 눌러 다시 시작할 수 있어요.
          </p>
        </div>
      ) : isBlocked ? (
        <div className="p-4 rounded-xl bg-state-danger-soft border border-state-danger/30 text-center py-5 space-y-1">
          <p className="text-sm font-extrabold text-state-danger">
            안전 규칙에 따라 업무가 멈췄어요.
          </p>
          <p className="text-xs text-state-danger">
            멈춘 이유를 확인하고 소희와 대화해 주세요.
          </p>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-muted/40 border border-border/60 text-center py-4 text-xs text-muted-foreground">
          {data.freshness === 'UNKNOWN' ? '진행 중인 업무가 있는지 다시 확인해 주세요.' : '지금 진행 중인 업무가 없어요. 새로운 소식을 준비해 보세요.'}
        </div>
      )}

      {/* 4. Applied Owner Rules (The emotional bridge: "What owner taught Sohee") */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            이번 작업에 반영된 사장님 지침
          </span>
          <span className="text-[10px] text-muted-foreground font-normal">
            나의 소희에서 직접 편집 가능
          </span>
        </div>
        <AppliedOwnerRules rules={data.appliedRules} />
      </div>

      {/* 5. Bottom Proof & Next Action Split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/80">
        <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground block">
            최근 확인된 작업
          </span>
          <ProofSummary proof={data.lastProof} />
        </div>

        <div className="p-3 rounded-xl bg-muted/30 border border-border/60 space-y-1">
          <span className="text-[11px] font-bold text-muted-foreground block">
            다음 예정 업무
          </span>
          {data.nextAction ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <ArrowRight className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="truncate">{data.nextAction.label}</span>
              {data.nextAction.scheduledAt && (
                <span className="text-[11px] font-normal text-muted-foreground shrink-0">
                  ({new Date(data.nextAction.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span>다음 예정 업무의 근거를 아직 확인하지 못했어요</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
