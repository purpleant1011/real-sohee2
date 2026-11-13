export const dynamic = 'force-dynamic'
export const revalidate = 0

import React from 'react'
import Link from 'next/link'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { ArrowRight, Layers } from 'lucide-react'
import { LoadErrorNotice, EmptyNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { channelLabel, missionGoalLabel, missionStatusLabel, formatKst, referenceCode } from '@/components/admin-ui/labels'
import { mapLegacyStatusToDualState } from '@/lib/mission-os/mission-state-machine'
import type { ExecutionState, OutcomeState } from '@/lib/mission-os/mission-types'

function resolveChannelDisplay(channel: string | null | undefined): string {
  if (!channel || channel.toLowerCase() === 'all') return '전체 채널'
  return channelLabel(channel)
}

function executionStateLabel(state: ExecutionState): string {
  switch (state) {
    case 'DRAFT':
      return '초안 작성'
    case 'NEEDS_DECISION':
      return '승인 대기'
    case 'READY':
      return '실행 준비'
    case 'RUNNING':
      return '실행 중'
    case 'WAITING_EXTERNAL':
      return '외부 대기'
    case 'OBSERVING':
      return '성과 관측'
    case 'PAUSING':
      return '일시정지 중'
    case 'PAUSED':
      return '일시 정지'
    case 'STOPPED':
      return '중단됨'
    case 'CLOSED':
      return '작업 종료'
    default:
      return state
  }
}

function outcomeStateLabel(state: OutcomeState): string {
  switch (state) {
    case 'PENDING':
      return '관측 대기/진행'
    case 'ACHIEVED_VERIFIED':
      return '목표 달성 (검증)'
    case 'NOT_ACHIEVED_IN_WINDOW':
      return '기간 내 미달성'
    case 'NOT_OBSERVABLE':
      return '관측 불가'
    case 'WITHDRAWN':
      return '철회됨'
    default:
      return state
  }
}

export default async function AdminMissionsListPage() {
  await requireOperator('publish.read')

  const adminClient = createAdminSupabaseClient()

  // 마케팅 미션 목록 최신순 조회 (RLS 우회를 위해 createAdminSupabaseClient 사용)
  const { data: missions, error } = await (adminClient as any)
    .from('marketing_missions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  const rawList = missions || []
  const missionList = rawList.map((m: any) => {
    const { executionState, outcomeState } = mapLegacyStatusToDualState(m.status, m.metadata)
    return {
      ...m,
      executionState,
      outcomeState,
    }
  })

  // 작업/성과 상태 분리 집계
  const completedCount = error
    ? null
    : missionList.filter((m: { executionState: ExecutionState }) => m.executionState === 'CLOSED').length
  const inProgressCount = error
    ? null
    : missionList.filter(
        (m: { executionState: ExecutionState }) => m.executionState !== 'CLOSED' && m.executionState !== 'STOPPED'
      ).length

  return (
    <div className="w-full space-y-6 max-w-6xl mx-auto p-4 sm:p-6">
      {/* 헤더 */}
      <PageHeader
        title="마케팅 미션 관제"
        description="원장님 자연어 발의부터 실행·관측까지 전체 마케팅 미션 상태를 확인하고 트레이스를 탐색합니다."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <MetricTile
          label="등록된 미션"
          value={error ? null : missionList.length}
          hint={error ? '미션 목록을 불러오지 못했어요' : '최근 50건 기준'}
        />
        <MetricTile
          label="완료된 미션"
          value={completedCount}
          hint={error ? '상태를 확인할 수 없어요' : '작업 종료(CLOSED)'}
          tone="good"
        />
        <MetricTile
          label="진행 중인 미션"
          value={inProgressCount}
          hint={error ? '상태를 확인할 수 없어요' : '실행·관측·승인 등 진행 중'}
          tone="warn"
        />
      </div>

      {error ? (
        <LoadErrorNotice what="마케팅 미션 목록" retryHref="/admin/missions" />
      ) : (
        <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
          <CardHeader className="p-4 md:p-5 bg-muted/20 border-b">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Layers className="size-4 text-primary" /> 마케팅 미션 목록
            </CardTitle>
            <CardDescription className="text-xs">
              각 미션 행의 [트레이스 탐색]을 클릭하여 8단계 관측 타임라인으로 바로 이동할 수 있습니다.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {missionList.length === 0 ? (
              <div className="p-6">
                <EmptyNotice
                  title="등록된 마케팅 미션이 없습니다"
                  description="아직 생성되거나 발의된 마케팅 미션이 없습니다."
                />
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-[120px]">참조번호</TableHead>
                    <TableHead>마케팅 목표</TableHead>
                    <TableHead>채널</TableHead>
                    <TableHead>작업 상태</TableHead>
                    <TableHead>성과 상태</TableHead>
                    <TableHead>현재 상태</TableHead>
                    <TableHead>생성 일시</TableHead>
                    <TableHead className="text-right">트레이스 탐색</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missionList.map((m: any) => {
                    const isLegacyCompleted =
                      m.status === 'COMPLETED' || m.status === 'NEXT_ACTION_READY'
                    return (
                      <TableRow key={m.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-mono text-xs font-bold text-foreground">
                          {referenceCode(m.id)}
                        </TableCell>
                        <TableCell className="text-xs font-medium max-w-md truncate">
                          {missionGoalLabel(m.goal)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {resolveChannelDisplay(m.target_channel)}
                          </Badge>
                        </TableCell>
                        {/* 작업 상태 (execution_state) */}
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              m.executionState === 'CLOSED'
                                ? 'bg-muted/60 text-muted-foreground'
                                : m.executionState === 'RUNNING' ||
                                    m.executionState === 'OBSERVING'
                                  ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
                                  : m.executionState === 'NEEDS_DECISION'
                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                    : m.executionState === 'STOPPED'
                                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                                      : 'text-foreground'
                            }`}
                          >
                            {executionStateLabel(m.executionState)}
                          </Badge>
                        </TableCell>
                        {/* 성과 상태 (outcome_state) */}
                        <TableCell>
                          <Badge
                            variant={
                              m.outcomeState === 'ACHIEVED_VERIFIED'
                                ? 'default'
                                : 'outline'
                            }
                            className={`text-[10px] ${
                              m.outcomeState === 'ACHIEVED_VERIFIED'
                                ? 'bg-state-ok hover:bg-state-ok/90 text-white'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {outcomeStateLabel(m.outcomeState)}
                          </Badge>
                        </TableCell>
                        {/* 레거시 현재 상태 (m.status) */}
                        <TableCell>
                          <Badge
                            variant={isLegacyCompleted ? 'default' : 'outline'}
                            className={`text-[10px] ${
                              isLegacyCompleted
                                ? 'bg-state-ok hover:bg-state-ok/90 text-white'
                                : 'text-foreground'
                            }`}
                          >
                            {missionStatusLabel(m.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {formatKst(m.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                            className="h-8 min-h-8 text-xs font-semibold gap-1"
                          >
                            <Link href={`/admin/missions/${m.id}`}>
                              트레이스 탐색 <ArrowRight className="size-3" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
