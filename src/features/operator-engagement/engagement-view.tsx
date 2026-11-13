'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, RefreshCw, ShieldAlert, ZapOff } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { channelLabel, formatKst } from '@/components/admin-ui/labels'
import type { EngagementKillSwitchResult, OperatorEngagementOverview } from './schemas'

interface EngagementViewProps {
  initialData: OperatorEngagementOverview
}

export function EngagementView({ initialData }: EngagementViewProps) {
  const router = useRouter()
  const data = initialData
  const [isPending, startTransition] = useTransition()

  // 킬스위치 제어판 상태
  const [scope, setScope] = useState<'all' | 'workspace'>('all')
  const [workspaceId, setWorkspaceId] = useState('')
  const [action, setAction] = useState<'downgrade_to_l1' | 'pause'>('downgrade_to_l1')
  const [reason, setReason] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState<EngagementKillSwitchResult | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh()
    })
  }

  const handleExecuteKillSwitch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) {
      alert('긴급 차단 사유를 반드시 입력해 주세요.')
      return
    }
    if (scope === 'workspace' && !workspaceId.trim()) {
      alert('특정 매장 차단 시 매장 ID(UUID)를 입력해 주세요.')
      return
    }

    const actionText = action === 'downgrade_to_l1' ? 'L1(수동 승인 모드) 강제 격하' : '전체 소통함 일시 정지'
    const scopeText = scope === 'all' ? '플랫폼 전체 매장' : `매장 (${workspaceId})`
    const confirmMessage = `[긴급 킬스위치 가동 경고]\n\n대상: ${scopeText}\n조치: ${actionText}\n사유: ${reason}\n\n정말 즉시 실행하시겠습니까?`

    if (!window.confirm(confirmMessage)) {
      return
    }

    setIsExecuting(true)
    setExecutionError(null)
    setExecutionResult(null)

    try {
      const res = await fetch('/api/admin/engagement/killswitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          workspaceId: scope === 'workspace' ? workspaceId.trim() : undefined,
          action,
          reason: reason.trim(),
        }),
      })

      const resJson = await res.json()
      if (!res.ok) {
        throw new Error(resJson.message || resJson.error || '킬스위치 실행 실패')
      }

      setExecutionResult(resJson)
      setReason('')
      // 데이터 즉시 갱신
      startTransition(() => {
        router.refresh()
      })
    } catch (err: any) {
      setExecutionError(err.message || '킬스위치 실행 중 오류가 발생했습니다.')
    } finally {
      setIsExecuting(false)
    }
  }

  const { autonomy, expiringDms, expiringCriticalCount, stats24h, recentAudits } = data

  return (
    <div className="w-full space-y-7">
      <PageHeader
        title="소통함 관제"
        description="인스타그램 DM 24시간 응답 기한 및 댓글 자율성(L1/L2/L3) 모니터링과 긴급 킬스위치를 관리해요."
        actions={
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isPending}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        }
      />

      {/* 상단 메트릭 타일 */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        <MetricTile
          label="만료 임박 DM"
          value={expiringCriticalCount}
          tone={expiringCriticalCount > 0 ? 'bad' : 'good'}
          hint="2시간 이내 만료 및 만료된 미완료 스레드"
        />
        <MetricTile
          label="자율성 L3 (완전자동)"
          value={autonomy.l3Autonomous}
          tone={autonomy.l3Autonomous > 0 ? 'warn' : 'default'}
          hint="자동 응대 활성 매장"
        />
        <MetricTile
          label="자율성 L2 (추천)"
          value={autonomy.l2Assisted}
          hint="초안 생성 후 승인 대기 매장"
        />
        <MetricTile
          label="자율성 L1 (수동)"
          value={autonomy.l1Manual}
          hint="전적인 수동 작성 매장"
        />
        <MetricTile
          label="24h 자동답글 성공률"
          value={stats24h.successRatePercent !== null ? `${stats24h.successRatePercent}%` : null}
          tone={stats24h.failedReplies > 0 ? 'warn' : 'good'}
          hint={`성공 ${stats24h.successfulReplies}건 / 실패 ${stats24h.failedReplies}건`}
        />
      </div>

      {/* 긴급 킬스위치 제어판 */}
      <Card className="border-red-500/50 bg-red-50/30 dark:bg-red-950/10 shadow-xs">
        <CardHeader className="border-b border-red-200/50 pb-4 dark:border-red-900/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-red-600 dark:text-red-400" />
              <CardTitle className="text-base font-bold text-red-950 dark:text-red-200">
                소통함 긴급 킬스위치 (Kill Switch)
              </CardTitle>
            </div>
            <Badge variant="destructive" className="font-semibold">
              긴급 개입
            </Badge>
          </div>
          <CardDescription className="text-xs text-red-800/80 dark:text-red-300/80">
            AI 자동 답글 환각 또는 오작동 발생 시, 전체 매장 또는 특정 매장의 자율성을 L1(수동 승인 모드)으로 일괄 강제 격하하거나 소통함을 일시 중지합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <form onSubmit={handleExecuteKillSwitch} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  적용 범위
                </label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'all' | 'workspace')}
                  className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-purple-600"
                >
                  <option value="all">플랫폼 전체 매장 (All Workspaces)</option>
                  <option value="workspace">특정 매장 (Single Workspace)</option>
                </select>
              </div>

              {scope === 'workspace' && (
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    매장 ID (Workspace UUID)
                  </label>
                  <input
                    type="text"
                    placeholder="예: 00000000-0000-0000-0000-000000000000"
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-purple-600"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  차단 조치 선택
                </label>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value as 'downgrade_to_l1' | 'pause')}
                  className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-purple-600"
                >
                  <option value="downgrade_to_l1">L3 점장형 → L1 수동 승인 격하 (권장)</option>
                  <option value="pause">소통함 자동 답글 전체 일시 정지 (Pause)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                긴급 킬스위치 가동 사유 (감사 로그 필수 기록)
              </label>
              <input
                type="text"
                placeholder="예: 인스타그램 댓글 환각 오발송 신고 접수로 인한 L3 모드 긴급 중단"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-purple-600"
                required
              />
            </div>

            {executionResult && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
                ✅ <strong>킬스위치 실행 완료:</strong> 영향받은 매장{' '}
                {executionResult.affectedWorkspaces}곳, 변경된 정책 {executionResult.updatedPolicies}건
                (시각: {formatKst(executionResult.timestamp)})
              </div>
            )}

            {executionError && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-900 dark:text-red-200">
                ❌ <strong>오류 발생:</strong> {executionError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isExecuting}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"
              >
                <ZapOff className="size-4" />
                {isExecuting ? '킬스위치 가동 중...' : '긴급 킬스위치 발동'}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 24시간 DM 만료 임박 목록 */}
      <Card className="overflow-hidden border border-border/80 p-0 shadow-xs">
        <CardHeader className="border-b bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-purple-600" />
              <CardTitle className="text-sm font-bold">
                인스타그램 DM 24시간 윈도우 관제 (응답 만료 임박 스레드)
              </CardTitle>
            </div>
            <span className="text-xs text-muted-foreground">
              총 {expiringDms.length}건
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {expiringDms.length === 0 ? (
            <EmptyNotice
              title="만료 임박한 DM 스레드가 없어요"
              description="24시간 정책 윈도우 내에 모든 고객 DM이 원활히 관리되고 있습니다."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>긴급도</TableHead>
                    <TableHead>매장명</TableHead>
                    <TableHead>고객 핸들</TableHead>
                    <TableHead>마지막 메시지</TableHead>
                    <TableHead>수신 시각</TableHead>
                    <TableHead>만료 기한</TableHead>
                    <TableHead>잔여 시간</TableHead>
                    <TableHead>상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiringDms.map((dm) => {
                    const isExpired = dm.urgency === 'EXPIRED'
                    const isCritical = dm.urgency === 'CRITICAL'
                    const isWarning = dm.urgency === 'WARNING'

                    let badgeVariant: 'destructive' | 'warning' | 'secondary' | 'outline' = 'outline'
                    let urgencyLabel = '안전'

                    if (isExpired) {
                      badgeVariant = 'secondary'
                      urgencyLabel = '만료됨'
                    } else if (isCritical) {
                      badgeVariant = 'destructive'
                      urgencyLabel = '1시간 미만'
                    } else if (isWarning) {
                      badgeVariant = 'warning'
                      urgencyLabel = '2시간 미만'
                    }

                    return (
                      <TableRow key={dm.id} className="transition-colors hover:bg-muted/30">
                        <TableCell>
                          <Badge variant={badgeVariant} className="text-[11px] font-semibold">
                            {urgencyLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-foreground">
                          {dm.workspaceName}
                        </TableCell>
                        <TableCell className="text-xs text-foreground font-mono">
                          {dm.customerHandle}
                        </TableCell>
                        <TableCell className="max-w-64 truncate text-xs text-foreground">
                          {dm.lastMessageText || '(텍스트 없음)'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatKst(dm.lastMessageAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatKst(dm.expiresAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs font-semibold">
                          {isExpired ? (
                            <span className="text-muted-foreground">만료됨</span>
                          ) : (
                            <span className={isCritical ? 'text-red-600 dark:text-red-400' : isWarning ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                              {Math.floor(dm.remainingMinutes / 60)}시간 {Math.max(0, dm.remainingMinutes % 60)}분 남음
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[11px]">
                            {dm.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 최근 자동 답글 및 소통 감사 기록 */}
      <Card className="overflow-hidden border border-border/80 p-0 shadow-xs">
        <CardHeader className="border-b bg-muted/20 p-4">
          <CardTitle className="text-sm font-bold">
            최근 소통함 감사 로그 (Auto-Reply & Audit)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentAudits.length === 0 ? (
            <EmptyNotice
              title="최근 소통함 감사 기록이 없어요"
              description="자동 답글 또는 정책 변경 기록이 여기에 표시됩니다."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>발생 시각</TableHead>
                    <TableHead>매장명</TableHead>
                    <TableHead>채널</TableHead>
                    <TableHead>행위</TableHead>
                    <TableHead>행위자</TableHead>
                    <TableHead>상세 내용</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentAudits.map((a) => (
                    <TableRow key={a.id} className="transition-colors hover:bg-muted/30">
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatKst(a.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-foreground">
                        {a.workspaceName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[11px] font-semibold">
                          {channelLabel(a.channel)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono font-medium">
                        {a.action}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.actor}
                      </TableCell>
                      <TableCell className="max-w-96 truncate text-xs text-muted-foreground font-mono">
                        {JSON.stringify(a.details)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
