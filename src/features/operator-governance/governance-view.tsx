'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Shield, AlertTriangle, ArrowRight
} from 'lucide-react'
import { LoadErrorNotice, EmptyNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { formatKst, channelLabel, referenceCode } from '@/components/admin-ui/labels'
import type { OperatorAdminPage, OperatorAdminError } from '@/features/operator-admin/repository'

export interface GovernanceViewProps {
  adminSummary?: {
    data: OperatorAdminPage | null
    error: OperatorAdminError | null
  }
}

interface GovernanceApprovalItem {
  id: string
  title: string
  domain: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  sourceKind: 'CANONICAL' | 'DEMO_FIXTURE'
  proposerActorId: string
  proposerEmail: string
  proposedAt: string
  reason: string
  status: string
  isExecutable: boolean
  correlationId: string
}

interface KillSwitchItem {
  id?: string
  scope: string
  target_id: string
  reason?: string | null
  engaged_by?: string | null
  engaged_at?: string | null
  is_active: boolean
}

function riskLevelLabel(risk: string): { label: string; variant: 'destructive' | 'warning' | 'outline' } {
  switch (risk) {
    case 'CRITICAL':
      return { label: '치명', variant: 'destructive' }
    case 'HIGH':
      return { label: '높음', variant: 'destructive' }
    case 'MEDIUM':
      return { label: '보통', variant: 'warning' }
    case 'LOW':
      return { label: '낮음', variant: 'outline' }
    default:
      return { label: '확인 필요', variant: 'outline' }
  }
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case 'GLOBAL':
      return '전체 발행'
    case 'CHANNEL':
      return '채널별 발행'
    case 'WORKSPACE':
      return '매장별 발행'
    default:
      return '지정 범위'
  }
}

export function GovernanceView({ adminSummary }: GovernanceViewProps) {
  const [activeTab, setActiveTab] = useState<'two_man' | 'kill_switches' | 'admins'>('two_man')
  const [twoManQueue, setTwoManQueue] = useState<GovernanceApprovalItem[]>([])
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(true)
  const [approvalError, setApprovalError] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [stepUpToken, setStepUpToken] = useState<string>('')

  const [killSwitches, setKillSwitches] = useState<KillSwitchItem[]>([])
  const [isLoadingSwitches, setIsLoadingSwitches] = useState(true)
  const [killSwitchesError, setKillSwitchesError] = useState(false)

  const loadApprovals = useCallback(async () => {
    setIsLoadingApprovals(true)
    setApprovalError(false)
    try {
      const res = await fetch('/api/admin/governance/approvals')
      if (res.ok) {
        const data = await res.json()
        setTwoManQueue(data.approvals || [])
      } else {
        setApprovalError(true)
      }
    } catch {
      setApprovalError(true)
    } finally {
      setIsLoadingApprovals(false)
    }
  }, [])

  const loadSwitches = useCallback(async () => {
    setIsLoadingSwitches(true)
    setKillSwitchesError(false)
    try {
      const res = await fetch('/api/admin/system/kill-switches')
      if (res.ok) {
        const data = await res.json()
        setKillSwitches(data.switches || [])
      } else {
        setKillSwitchesError(true)
      }
    } catch {
      setKillSwitchesError(true)
    } finally {
      setIsLoadingSwitches(false)
    }
  }, [])

  useEffect(() => {
    loadApprovals()
    loadSwitches()
  }, [loadApprovals, loadSwitches])

  const handleApprovalAction = async (requestId: string, action: 'APPROVE' | 'REJECT') => {
    const token = stepUpToken.trim()
    if (!token) {
      setActionFeedback('추가 인증 토큰을 입력해야 승인하거나 반려할 수 있습니다.')
      return
    }

    try {
      setActionFeedback(null)
      const res = await fetch('/api/admin/governance/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          action,
          reason: action === 'APPROVE' ? '운영자 보안 설정 2인 교차 승인' : '운영자 보안 설정 2인 반려',
          stepUpToken: token,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionFeedback(`[오류 ${res.status}] ${data.error || '승인 처리 실패'}`)
        return
      }
      setActionFeedback(data.message || '승인 상태가 갱신되었습니다.')
      await loadApprovals()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류'
      setActionFeedback(`네트워크 오류: ${message}`)
    }
  }

  const activeKillSwitchCount = killSwitches.filter((s) => s.is_active).length

  return (
    <div className="w-full space-y-7 transition-all max-w-6xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <PageHeader
        title="보안 설정"
        description="운영자 계정 현황, 고위험 작업 교차 승인, 긴급 차단(킬스위치) 상태를 점검합니다."
        actions={
          <Button asChild size="sm" className="min-h-9 gap-1.5 font-semibold">
            <Link href="/admin/interventions">
              긴급 개입 열기 <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />

      {/* Top Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <MetricTile
          label="2인 승인 대기"
          value={approvalError ? null : isLoadingApprovals ? null : twoManQueue.length}
          hint={approvalError ? '대기 목록을 불러오지 못했어요' : '교차 승인 대기 중인 고위험 작업'}
          tone={twoManQueue.length > 0 ? 'warn' : 'default'}
        />

        <MetricTile
          label="운영 관리자 계정"
          value={adminSummary?.error ? null : (adminSummary?.data?.items?.length ?? null)}
          hint={adminSummary?.error ? '관리자 목록을 불러오지 못했어요' : '등록된 운영 관리자 수'}
          href="/admin/admins"
        />

        <MetricTile
          label="활성 킬스위치"
          value={killSwitchesError ? null : isLoadingSwitches ? null : activeKillSwitchCount}
          hint={killSwitchesError ? '상태를 불러오지 못했어요' : '현재 가동 중인 긴급 차단'}
          tone={activeKillSwitchCount > 0 ? 'bad' : 'good'}
          href="/admin/interventions"
        />
      </div>

      {actionFeedback && (
        <div role="status" className="p-3 bg-muted/60 border border-border rounded-lg text-xs text-foreground flex items-center justify-between">
          <span>{actionFeedback}</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs min-h-7" onClick={() => setActionFeedback(null)}>
            닫기
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as typeof activeTab)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 max-w-md bg-muted/40 p-1">
          <TabsTrigger value="two_man" className="text-xs font-semibold">2인 승인 큐</TabsTrigger>
          <TabsTrigger value="kill_switches" className="text-xs font-semibold">킬스위치 현황</TabsTrigger>
          <TabsTrigger value="admins" className="text-xs font-semibold">관리자 계정 요약</TabsTrigger>
        </TabsList>

        {/* Tab 1: 2-Man Approval */}
        <TabsContent value="two_man" className="space-y-4">
          <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
            <CardHeader className="p-4 bg-muted/20 border-b">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" /> 고위험 작업 교차 승인 대기 목록
              </CardTitle>
              <CardDescription className="text-xs">
                긴급 킬스위치, 권한 변경 등 시스템 영향도가 큰 액션은 제2관리자의 교차 승인이 필요합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {approvalError ? (
                <div className="p-4">
                  <LoadErrorNotice what="승인 대기 목록" retryHref="/admin/governance" />
                </div>
              ) : (
                <>
                  <div className="p-4 border-b bg-muted/10 space-y-1">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                      <label htmlFor="stepup-token-input" className="text-xs font-semibold text-foreground shrink-0">
                        추가 인증 토큰:
                      </label>
                      <Input
                        id="stepup-token-input"
                        value={stepUpToken}
                        onChange={(e) => setStepUpToken(e.target.value)}
                        placeholder="추가 인증 토큰을 입력하세요"
                        className="h-9 max-w-sm text-xs bg-background"
                      />
                      {!stepUpToken.trim() && (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          추가 인증 토큰을 입력해야 승인하거나 반려할 수 있습니다.
                        </span>
                      )}
                    </div>
                  </div>

                  {isLoadingApprovals ? (
                    <div className="p-12 text-center text-xs text-muted-foreground">
                      승인 대기 목록을 불러오는 중입니다...
                    </div>
                  ) : twoManQueue.length === 0 ? (
                    <div className="p-6">
                      <EmptyNotice
                        title="교차 승인 대기 중인 고위험 작업이 없습니다"
                        description="현재 대기 중인 긴급 개입 또는 권한 변경 승인 요청이 없습니다."
                      />
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="w-[110px]">참조번호</TableHead>
                          <TableHead>요청 내용</TableHead>
                          <TableHead>위험 등급</TableHead>
                          <TableHead>제안자</TableHead>
                          <TableHead>제안 사유</TableHead>
                          <TableHead>제안 일시</TableHead>
                          <TableHead className="text-right">승인/반려</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {twoManQueue.map((req) => {
                          const risk = riskLevelLabel(req.riskLevel)
                          const hasToken = stepUpToken.trim().length > 0
                          return (
                            <TableRow key={req.id} className="hover:bg-muted/30 transition-colors">
                              <TableCell className="font-mono text-xs font-bold text-foreground">
                                {referenceCode(req.id)}
                              </TableCell>
                              <TableCell className="font-semibold text-xs text-foreground">{req.title}</TableCell>
                              <TableCell>
                                <Badge variant={risk.variant} className="text-[10px] font-semibold">
                                  {risk.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{req.proposerEmail || req.proposerActorId || '미지정'}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{req.reason || '-'}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{formatKst(req.proposedAt)}</TableCell>
                              <TableCell className="text-right space-x-1.5 whitespace-nowrap">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!hasToken}
                                  title={!hasToken ? '추가 인증 토큰이 필요합니다' : undefined}
                                  className="h-8 min-h-8 text-xs px-2.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 disabled:opacity-50"
                                  onClick={() => handleApprovalAction(req.id, 'REJECT')}
                                >
                                  반려
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={!hasToken}
                                  title={!hasToken ? '추가 인증 토큰이 필요합니다' : undefined}
                                  className="h-8 min-h-8 text-xs px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
                                  onClick={() => handleApprovalAction(req.id, 'APPROVE')}
                                >
                                  승인
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Real Kill Switches (Read-Only) */}
        <TabsContent value="kill_switches" className="space-y-4">
          <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
            <CardHeader className="p-4 bg-muted/20 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Shield className="size-4 text-purple-600" /> 긴급 킬스위치 가동 현황
                </CardTitle>
                <CardDescription className="text-xs">
                  전체 또는 채널별 발행 차단 스위치 상태를 확인합니다. 변경 작업은 긴급 개입 화면에서 사유를 기록하고 진행합니다.
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline" className="min-h-9 gap-1.5 self-start sm:self-auto text-xs font-semibold">
                <Link href="/admin/interventions">
                  긴급 개입 열기 <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {killSwitchesError ? (
                <div className="p-4">
                  <LoadErrorNotice what="킬스위치 상태" retryHref="/admin/governance" />
                </div>
              ) : isLoadingSwitches ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  킬스위치 상태를 불러오는 중입니다...
                </div>
              ) : killSwitches.length === 0 ? (
                <div className="p-6">
                  <EmptyNotice
                    title="가동 중인 킬스위치가 없습니다"
                    description="모든 채널 및 발행 작업이 정상 운영 중입니다. 긴급 중단이 필요한 경우 상단의 '긴급 개입 열기'를 이용하세요."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>적용 범위</TableHead>
                      <TableHead>대상 식별</TableHead>
                      <TableHead>스위치 상태</TableHead>
                      <TableHead>사유</TableHead>
                      <TableHead>설정자</TableHead>
                      <TableHead className="text-right">설정 일시</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {killSwitches.map((item, idx) => {
                      const targetDisplay = item.scope === 'CHANNEL'
                        ? channelLabel(item.target_id)
                        : item.scope === 'WORKSPACE'
                        ? `매장 (${referenceCode(item.target_id)})`
                        : '전체 시스템'
                      return (
                        <TableRow key={item.id || `${item.scope}-${item.target_id}-${idx}`} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="font-semibold text-xs text-foreground">
                            {scopeLabel(item.scope)}
                          </TableCell>
                          <TableCell className="text-xs text-foreground">
                            {targetDisplay}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={item.is_active ? 'destructive' : 'outline'}
                              className="text-[10px] font-semibold"
                            >
                              {item.is_active ? '차단 작동 중' : '비활성'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                            {item.reason || '-'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.engaged_by ? referenceCode(item.engaged_by) : '-'}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground font-mono">
                            {formatKst(item.engaged_at)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Admins Summary */}
        <TabsContent value="admins" className="space-y-4">
          <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
            <CardHeader className="p-4 bg-muted/20 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Shield className="size-4 text-purple-600" /> 운영 관리자 계정 요약
                </CardTitle>
                <CardDescription className="text-xs">
                  실제 등록된 운영 관리자 현황입니다. 계정 상세 관리 및 권한 조정은 관리자 계정 화면에서 진행합니다.
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline" className="min-h-9 gap-1.5 self-start sm:self-auto text-xs font-semibold">
                <Link href="/admin/admins">
                  관리자 계정 관리 <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {adminSummary?.error ? (
                <div className="p-4">
                  <LoadErrorNotice what="관리자 계정 목록" retryHref="/admin/governance" />
                </div>
              ) : !adminSummary?.data?.items?.length ? (
                <div className="p-6">
                  <EmptyNotice
                    title="등록된 운영 관리자가 없습니다"
                    description="관리자 계정 관리 화면에서 신규 관리자 권한을 부여할 수 있습니다."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>관리자 이메일</TableHead>
                      <TableHead>부여된 역할</TableHead>
                      <TableHead>계정 상태</TableHead>
                      <TableHead>추가 인증</TableHead>
                      <TableHead className="text-right">최근 수정</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adminSummary.data.items.map((a) => (
                      <TableRow key={a.userId} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-mono text-xs text-foreground">
                          {a.email || '미확인'}
                        </TableCell>
                        <TableCell className="text-xs text-foreground">
                          {a.roleDisplayNames.length > 0 ? a.roleDisplayNames.join(', ') : '기본 관리자'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={a.status === 'active' ? 'default' : 'outline'}
                            className="text-[10px] font-semibold"
                          >
                            {a.status === 'active' ? '운영 중' : a.status === 'invited' ? '초대됨' : '비활성'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={a.mfaEnrolled ? 'secondary' : 'outline'}
                            className="text-[10px] font-semibold"
                          >
                            {a.mfaEnrolled ? '등록 완료' : '미등록'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground font-mono">
                          {formatKst(a.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
