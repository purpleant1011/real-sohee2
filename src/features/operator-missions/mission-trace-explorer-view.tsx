'use client'

import React from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Bot,
  User,
  Database,
  Share2,
  Users,
  CheckCircle2,
  CircleDashed,
  ArrowLeft,
  ExternalLink,
  Shield,
  Layers,
  Sparkles,
} from 'lucide-react'
import type { MissionTraceView, TraceActorBadge, TraceStageItem } from '@/features/admin/mission-trace-projection'
import type { TenantIdentityBar } from '@/features/admin/customer-360-canonical-service'
import { formatKst, missionGoalLabel, missionStatusLabel, referenceCode } from '@/components/admin-ui/labels'

interface MissionTraceExplorerViewProps {
  trace: MissionTraceView
  identity?: TenantIdentityBar | null
}

export function MissionTraceExplorerView({ trace, identity }: MissionTraceExplorerViewProps) {
  const getActorBadgeConfig = (badge: TraceActorBadge) => {
    switch (badge) {
      case 'USER':
        return {
          label: '원장님(사용자)',
          icon: <User className="size-3.5" />,
          className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
        }
      case 'AGENT':
        return {
          label: '소희(에이전트)',
          icon: <Bot className="size-3.5" />,
          className: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
        }
      case 'DB':
        return {
          label: '데이터베이스(기록)',
          icon: <Database className="size-3.5" />,
          className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
        }
      case 'PROVIDER':
        return {
          label: '외부 연동(채널)',
          icon: <Share2 className="size-3.5" />,
          className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
        }
      case 'CUSTOMER':
        return {
          label: '인바운드 고객',
          icon: <Users className="size-3.5" />,
          className: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
        }
      case 'OPERATOR':
        return {
          label: '운영자',
          icon: <Shield className="size-3.5" />,
          className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
        }
    }
  }

  const observedStagesCount = trace.totalObservedStages ?? trace.stages.filter((s) => s.status === 'OBSERVED').length

  return (
    <div className="w-full space-y-6 max-w-6xl mx-auto p-4 sm:p-6">
      {/* 1. 상단 네비게이션 & 뒤로가기 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" asChild className="h-8 min-h-8 gap-1 text-xs">
            <Link href="/admin/missions">
              <ArrowLeft className="size-3.5" />
              미션 목록으로
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="h-8 min-h-8 gap-1 text-xs">
            <Link href={`/admin/workspaces/${trace.workspaceId}`}>
              고객사 상세
            </Link>
          </Button>
          <Badge variant="outline" className="text-[11px] font-mono">
            참조번호: {referenceCode(trace.traceId)}
          </Badge>
        </div>

        {identity && (
          <div className="flex items-center gap-2">
            <Badge
              variant={identity.badgeLabel === 'PRODUCTION_PRIMARY' ? 'default' : 'outline'}
              className={
                identity.badgeLabel === 'PRODUCTION_PRIMARY'
                  ? 'bg-purple-600 hover:bg-purple-600 text-white font-bold text-xs'
                  : 'text-amber-600 dark:text-amber-400 border-amber-500/40 text-xs'
              }
            >
              {identity.badgeLabel === 'PRODUCTION_PRIMARY' ? '실운영 매장' : '테스트 매장'}
            </Badge>
            <span className="text-xs font-semibold text-foreground">{identity.displayName}</span>
            <span className="text-xs text-muted-foreground font-mono">({identity.ownerEmail})</span>
          </div>
        )}
      </div>

      {/* 2. 미션 헤더 카드 */}
      <Card className="p-6 bg-card/80 border-border/80 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-600/10 text-purple-600 border border-purple-500/20">
                <Layers className="size-5" />
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-foreground">
                마케팅 미션 관측 타임라인
              </h1>
            </div>
            <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 mt-1">
              &ldquo;{missionGoalLabel(trace.goal)}&rdquo;
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="purple" className="text-xs font-bold px-3 py-1">
              상태: {missionStatusLabel(trace.overallStatus)}
            </Badge>
            <Badge variant="outline" className="text-xs font-mono">
              관측: {observedStagesCount} / {trace.stages.length} 단계
            </Badge>
          </div>
        </div>
      </Card>

      {/* 3. 8단계 타임라인 */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Sparkles className="size-4 text-purple-500" /> 8대 관측 단계 타임라인
        </h2>

        <div className="relative border-l-2 border-border/80 ml-4 pl-6 space-y-6">
          {trace.stages.map((stage: TraceStageItem) => {
            const actor = getActorBadgeConfig(stage.actorBadge)
            const isObserved = stage.status === 'OBSERVED'

            return (
              <div key={stage.stageIndex} className="relative group">
                {/* 타임라인 노드 아이콘 */}
                <span
                  className={`absolute -left-[35px] top-1 size-6 rounded-full border-2 flex items-center justify-center text-xs font-bold bg-background transition-colors ${
                    isObserved
                      ? 'border-emerald-500 text-emerald-500 shadow-xs'
                      : 'border-muted text-muted-foreground border-dashed'
                  }`}
                >
                  {isObserved ? <CheckCircle2 className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                </span>

                <Card
                  className={`p-4 transition-all shadow-xs ${
                    isObserved
                      ? 'bg-card/90 border-border hover:border-purple-500/40'
                      : 'bg-muted/10 border-border/40 opacity-70'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-mono font-bold text-muted-foreground">
                        단계 {stage.stageIndex}
                      </span>
                      <h3 className="font-bold text-sm text-foreground">{stage.title}</h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${actor.className}`}
                      >
                        {actor.icon}
                        {actor.label}
                      </span>

                      <Badge
                        variant={isObserved ? 'default' : 'outline'}
                        className={`text-[10px] ${
                          isObserved
                            ? 'bg-emerald-600 hover:bg-emerald-600 text-white'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {isObserved ? '관측됨' : '미관측'}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <span className="font-semibold text-foreground/80">관측 일시: </span>
                      <span className="font-mono">{stage.occurredAt ? formatKst(stage.occurredAt) : '미관측'}</span>
                    </div>

                    {stage.evidenceRef && (
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <span className="font-semibold text-foreground/80 shrink-0">증거 식별: </span>
                        {stage.evidenceRef.startsWith('http') ? (
                          <a
                            href={stage.evidenceRef}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-purple-600 hover:underline flex items-center gap-1 truncate"
                          >
                            확인 링크
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        ) : (
                          <code className="font-mono bg-muted/60 px-1.5 py-0.5 rounded text-[11px] truncate text-foreground">
                            {referenceCode(stage.evidenceRef)}
                          </code>
                        )}
                      </div>
                    )}
                  </div>

                  {stage.details && Object.keys(stage.details).length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-border/50">
                      <span className="text-[11px] font-semibold text-muted-foreground block mb-1">
                        세부 관측 기록:
                      </span>
                      <pre className="text-[11px] font-mono bg-muted/40 p-2 rounded-lg overflow-x-auto text-foreground/90">
                        {JSON.stringify(stage.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </Card>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
