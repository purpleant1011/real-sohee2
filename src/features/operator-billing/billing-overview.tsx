'use client'

import React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { TruthBadge } from '@/components/common/truth-envelope'
import { formatRelativeKst, paymentStateLabel, planLabel, referenceCode } from '@/components/admin-ui/labels'

export interface BillingOverviewProps {
  overview?: any
  data?: any
  error?: string | null
  formalWorkspaceIds?: ReadonlySet<string>
  applicantCount?: number | null
}

export function BillingOverview({ overview, data, formalWorkspaceIds, applicantCount: propApplicantCount }: BillingOverviewProps) {
  const rawData = overview || data
  const rawItems = rawData?.items || []
  const summary = rawData?.summary

  const isShowcase = (item: any) => item.workspace_id === 'ws-demo-byreum' || item.workspace_name?.includes('쇼케이스')
  const isFormalSource = (rawData?.applicantCount !== undefined && rawData?.applicantCount !== null) || (propApplicantCount !== undefined && propApplicantCount !== null)

  const isFormal = (item: any): boolean => {
    if (isFormalSource) return true
    if (formalWorkspaceIds) return formalWorkspaceIds.has(item.workspace_id)
    if (typeof item.is_formal === 'boolean') return item.is_formal
    if (typeof item.isFormal === 'boolean') return item.isFormal
    if (item.member_status === 'FORMAL') return true
    if (item.member_status === 'APPLICANT') return false
    const plan = (item.entitlement?.plan_code || '').toLowerCase()
    const isPaidPlan = plan !== '' && plan !== 'starter' && plan !== 'free_taste'
    const isPaidPayment = item.payment?.latest_state === 'provider_succeeded' || item.payment?.latest_state === 'activation_succeeded'
    return Boolean(isPaidPlan || isPaidPayment)
  }

  // Isolate showcase tenants and unverified applicant signups from official business metrics
  const productionItems = rawItems.filter((item: any) => !isShowcase(item) && isFormal(item))

  const applicantCount = rawData?.applicantCount ?? propApplicantCount ?? null
  const applicantExcludeText = typeof applicantCount === 'number'
    ? `정회원 기준 · 가입자(미인증) ${applicantCount.toLocaleString('ko-KR')}곳은 제외`
    : '정회원 기준 · 가입자(미인증)는 제외'

  const isPaidPlanCode = (code?: string | null) => {
    if (!code) return false
    const c = code.toLowerCase()
    return c !== 'starter' && c !== 'free_taste'
  }
  const freeTasteCount = productionItems.filter((i: any) => !isPaidPlanCode(i.entitlement?.plan_code)).length
  const paidCount = productionItems.filter((i: any) => isPaidPlanCode(i.entitlement?.plan_code)).length

  const dataStatusLabel = summary?.state === 'fresh'
    ? '최신'
    : summary?.state === 'stale'
    ? '지연'
    : summary?.state === 'empty'
    ? '자료 없음'
    : '확인 필요'

  return (
    <div className="space-y-6">
      {/* 4대 정산/결제 지표 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
        <Card className="p-4 bg-card/80 border-border/80">
          <span className="text-muted-foreground">실제 사업자 고객사</span>
          <div className="text-2xl font-black font-mono text-foreground mt-1">
            {productionItems.length}개사
          </div>
          <span className="text-[10px] text-muted-foreground">{applicantExcludeText}</span>
        </Card>

        <Card className="p-4 bg-card/80 border-border/80">
          <span className="text-muted-foreground">무료 체험</span>
          <div className="text-2xl font-black font-mono text-purple-600 dark:text-purple-400 mt-1">
            {freeTasteCount}개사
          </div>
          <span className="text-[10px] text-muted-foreground">초기 체험 크레딧 지원</span>
        </Card>

        <Card className="p-4 bg-card/80 border-border/80">
          <span className="text-muted-foreground">유료 상용 구독 (결제 완료)</span>
          <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
            {paidCount}개사
          </div>
          <span className="text-[10px] text-muted-foreground">정기 결제 구독 고객사</span>
        </Card>

        <Card className="p-4 bg-card/80 border-border/80">
          <span className="text-muted-foreground">원장 대사 데이터 상태</span>
          <div className="text-2xl font-black font-mono text-foreground mt-1">
            {dataStatusLabel}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {summary?.sourceTimestamp ? `기준: ${formatRelativeKst(summary.sourceTimestamp)}` : '실시간 조회'}
          </span>
        </Card>
      </div>

      <Card className="ant-pro-table p-0 overflow-hidden shadow-xs border border-border/80 bg-card">
        <CardHeader className="p-4 bg-muted/20 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold text-foreground">
            고객사 결제·구독 상태
          </CardTitle>
          <span className="text-xs text-muted-foreground font-mono">
            총 {rawItems.length}개사 등록
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>고객사</TableHead>
                <TableHead>요금제</TableHead>
                <TableHead>가용 크레딧</TableHead>
                <TableHead>결제 상태</TableHead>
                <TableHead className="text-right">확인 상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rawItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-xs">
                    표시할 결제 및 크레딧 자료가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                rawItems.map((item: any) => {
                  const planCode = item.entitlement?.plan_code || 'free_taste'
                  const isPaid = planCode.toLowerCase() !== 'starter' && planCode.toLowerCase() !== 'free_taste'
                  const displayPlan = planLabel(item.entitlement?.plan_code || 'free_taste')
                  const paymentStatusText = item.payment?.latest_state
                    ? paymentStateLabel(item.payment.latest_state)
                    : (isPaid ? '결제 완료' : '무료 체험')
                  const refCode = referenceCode(item.workspace_id)
                  const customerName = item.workspace_name || (refCode !== '-' ? `고객사 (${refCode})` : '고객사')

                  return (
                    <TableRow key={item.workspace_id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs font-semibold text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{customerName}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">참조번호 {refCode}</div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            isPaid
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                              : 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30'
                          }`}
                        >
                          {displayPlan}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-foreground">
                        {(item.balance?.available ?? 0).toLocaleString()} 크레딧
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium ${isPaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                          {paymentStatusText}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <TruthBadge factKind="CALCULATED" status="LIVE" />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default BillingOverview
