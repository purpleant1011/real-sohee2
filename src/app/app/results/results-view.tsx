'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  CalendarCheck,
  DollarSign,
  MessageSquare,
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { MasterDetail } from '@/components/layout/master-detail'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import type { WeeklyCeoReportData } from '@/features/reporting/weekly-ceo-report-service'
import { formatObservation } from '@/features/reporting/observation'
import {
  ChartContainer,
  type ChartConfig,
} from '@/components/ui/chart'
import { BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'

export type ResultsMetricKey = 'published' | 'bookings' | 'revenue' | 'inquiries' | 'deposits'

interface ResultsViewProps {
  initialMetricId?: string
}

const CHART_CONFIG = {
  count: {
    label: '확인된 건수',
    color: 'var(--primary)',
  },
} satisfies ChartConfig

export default function ResultsView({ initialMetricId }: ResultsViewProps = {}) {
  const workspaceId = useWorkspaceId()
  const [report, setReport] = useState<WeeklyCeoReportData | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedMetric, setSelectedMetric] = useState<ResultsMetricKey>(() => {
    if (initialMetricId === 'bookings' || initialMetricId === 'revenue' || initialMetricId === 'inquiries' || initialMetricId === 'deposits') {
      return initialMetricId
    }
    return 'published'
  })
  const [showUnobserved, setShowUnobserved] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!workspaceId || workspaceId === 'ws-default') {
        if (active) setLoadState('error')
        return
      }
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/reports/weekly`,
          { cache: 'no-store' }
        )
        if (!response.ok) throw new Error('조회 실패')
        const next: WeeklyCeoReportData = await response.json()
        if (next.workspaceId !== workspaceId || !next.metrics || !next.period) {
          throw new Error('조회 결과 불일치')
        }
        if (active) {
          setReport(next)
          setLoadState('ready')
        }
      } catch {
        if (active) setLoadState('error')
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [workspaceId, revision])

  if (loadState === 'error') {
    return (
      <V088AppShell workspaceId={workspaceId}>
        <div className="max-w-7xl mx-auto p-6 space-y-4">
          <p role="alert" className="text-sm text-destructive">
            주간 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
          </p>
          <button
            type="button"
            onClick={() => setRevision((v) => v + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold hover:bg-muted"
          >
            <RefreshCw className="size-3.5" /> 다시 조회
          </button>
        </div>
      </V088AppShell>
    )
  }

  if (loadState === 'loading' || !report) {
    return (
      <V088AppShell workspaceId={workspaceId}>
        <div className="max-w-7xl mx-auto p-6">
          <p role="status" className="text-sm text-muted-foreground">성과 기록을 확인하고 있어요.</p>
        </div>
      </V088AppShell>
    )
  }

  const metrics = report.metrics

  // 핵심 지표 4개 메타데이터
  const kpis = [
    {
      key: 'published' as const,
      name: '게시 확인',
      observation: metrics.verifiedPublishedPosts,
      subtext: '외부 게시 결과가 확인된 기록',
      unit: '건',
      icon: CheckCircle2,
    },
    {
      key: 'bookings' as const,
      name: '예약 확정',
      observation: metrics.bookingConfirmed,
      subtext: '기간 내 생성된 예약의 현재 상태',
      unit: '건',
      icon: CalendarCheck,
    },
    {
      key: 'revenue' as const,
      name: '확인된 매출',
      observation: metrics.revenue,
      subtext: '예약금·예약 금액으로 추정하지 않아요',
      unit: '원',
      icon: DollarSign,
    },
    {
      key: 'inquiries' as const,
      name: '고객 문의',
      observation: metrics.storedComments,
      subtext: '저장된 댓글 및 고객 문의',
      unit: '건',
      icon: MessageSquare,
    },
  ]

  // 값 없는 지표 목록 (OBSERVED가 아니거나 value가 없는 항목들)
  const unobservedList = [
    { name: '확인된 예약금 수납', obs: metrics.paymentCapturedVerified, reason: '예약 금액과 실제 수납은 달라요' },
    { name: '취소 예약', obs: metrics.bookingCanceled, reason: '취소된 예약 기록' },
    { name: '게시 확인 대기', obs: metrics.publicationPending, reason: '게시 요청과 실제 게시 확인은 달라요' },
    { name: '확인된 방문 완료', obs: metrics.visitCompletedVerified, reason: '예약 완료와 방문 완료는 달라요' },
    { name: '절감 시간', obs: metrics.hoursSaved, reason: '실제 작업 시간 비교 근거가 필요해요' },
    { name: '절감 비용', obs: metrics.costSavedWon, reason: '실제 비용 비교 근거가 필요해요' },
  ].filter((item) => item.obs.state !== 'OBSERVED' || item.obs.value === null)

  // ACTUAL 관측치 기반 차트 데이터
  const chartData = [
    {
      name: '게시 확인',
      count: metrics.verifiedPublishedPosts.state === 'OBSERVED' && metrics.verifiedPublishedPosts.value !== null ? metrics.verifiedPublishedPosts.value : 0,
      observed: metrics.verifiedPublishedPosts.state === 'OBSERVED',
    },
    {
      name: '예약 확정',
      count: metrics.bookingConfirmed.state === 'OBSERVED' && metrics.bookingConfirmed.value !== null ? metrics.bookingConfirmed.value : 0,
      observed: metrics.bookingConfirmed.state === 'OBSERVED',
    },
    {
      name: '고객 문의',
      count: metrics.storedComments.state === 'OBSERVED' && metrics.storedComments.value !== null ? metrics.storedComments.value : 0,
      observed: metrics.storedComments.state === 'OBSERVED',
    },
  ].filter((d) => d.observed)

  // 선택된 지표 상세 패널 정보
  const selectedKpi = kpis.find((k) => k.key === selectedMetric) || kpis[0]
  const currentObs = selectedKpi.observation
  const evidenceCount = currentObs.evidenceIds.length

  const getActionLink = (key: ResultsMetricKey) => {
    switch (key) {
      case 'published':
        return { label: '새 홍보 만들기', href: '/app/content' }
      case 'bookings':
        return { label: '예약 장부 확인하기', href: '/app/customers#reservation-ledger' }
      case 'revenue':
      case 'deposits':
        return { label: '매장 설정 확인하기', href: '/app/settings/business' }
      case 'inquiries':
        return { label: '소통함 열기', href: '/app/engagement' }
    }
  }

  const actionLink = getActionLink(selectedMetric)

  const sanitizedPeriod = report.periodLabel.replace(/\s*\(UTC\)/gi, '').trim()

  return (
    <V088AppShell workspaceId={workspaceId}>
      <main className="max-w-7xl mx-auto space-y-6 pb-16">
        {/* 헤더 */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">마케팅 성과 요약</h1>
            <p className="text-xs text-muted-foreground">
              {sanitizedPeriod} (한국 기준) · 사업장에 저장된 실제 기록만 보여드려요
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRevision((v) => v + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className="size-3.5" /> 새로고침
          </button>
        </header>

        {/* 상단 핵심 지표 4개 카드 한 줄 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi) => {
            const isSelected = selectedMetric === kpi.key
            const isObserved = kpi.observation.state === 'OBSERVED' && kpi.observation.value !== null
            const displayValue = isObserved
              ? `${kpi.observation.value?.toLocaleString()}${kpi.unit}`
              : '아직 확인할 수 없어요'

            return (
              <div
                key={kpi.key}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => setSelectedMetric(kpi.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedMetric(kpi.key)
                  }
                }}
                className={`p-5 rounded-3xl border transition-all cursor-pointer space-y-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isSelected
                    ? 'bg-primary/10 border-primary ring-2 ring-primary/20 shadow-xs'
                    : 'bg-card border-border hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-bold text-foreground">{kpi.name}</span>
                  <kpi.icon className="w-4 h-4 text-primary" />
                </div>
                <div className={isObserved ? 'text-2xl font-black text-foreground font-mono' : 'text-base font-bold text-muted-foreground whitespace-nowrap'}>
                  {displayValue}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-1">
                  {kpi.subtext}
                </p>
              </div>
            )
          })}
        </div>

        {/* MasterDetail (왼쪽: 요약 및 추이 차트, 오른쪽: 드릴다운 상세 패널) */}
        <MasterDetail
          listLabel="성과 요약"
          detailLabel="지표 상세"
          hasSelection={Boolean(selectedMetric)}
          emptyDetail="지표 카드를 누르면 상세 근거와 기록을 볼 수 있어요."
          list={
            <div className="space-y-4">
              {/* 기간별 추이 차트 (관측된 실제 데이터 기반) */}
              <div className="rounded-3xl border border-border bg-card p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <TrendingUp className="size-4 text-primary" />
                    <span>핵심 성과 지표 비교</span>
                  </h3>
                  <span className="text-xs text-muted-foreground font-mono whitespace-nowrap shrink-0">실제 확인된 기록</span>
                </div>

                {chartData.length > 0 ? (
                  <div className="h-56 w-full pt-2">
                    <ChartContainer config={CHART_CONFIG} className="h-full w-full">
                      <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <XAxis
                          dataKey="name"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'currentColor', fontSize: 12 }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'currentColor', fontSize: 12 }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const item = payload[0]
                            return (
                              <div className="rounded-xl border border-border bg-card p-2 text-xs shadow-md">
                                <span className="font-semibold text-foreground">{item.payload.name}: </span>
                                <span className="font-mono text-primary font-bold">{item.value}건</span>
                              </div>
                            )
                          }}
                        />
                        <Bar
                          isAnimationActive={false}
                          dataKey="count"
                          fill="var(--primary)"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={48}
                        />
                      </BarChart>
                    </ChartContainer>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                    이번 주 확인된 기록이 집계되면 차트로 보여드려요.
                  </div>
                )}
              </div>

              {/* 값 없는 지표 한 줄 안내 + 접기/펼치기 */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-2xs">
                <button
                  type="button"
                  aria-expanded={showUnobserved}
                  onClick={() => setShowUnobserved(!showUnobserved)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground">
                      아직 확인할 수 없는 지표 ({unobservedList.length}개)
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>{showUnobserved ? '접기' : '펼쳐보기'}</span>
                    {showUnobserved ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </div>
                </button>

                {showUnobserved && (
                  <div className="p-4 pt-0 border-t border-border/50 divide-y divide-border/40 text-xs">
                    {unobservedList.map((item, idx) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-medium text-foreground block">{item.name}</span>
                          <span className="text-[11px] text-muted-foreground">{item.reason}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                          {formatObservation(item.obs)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          }
          detail={
            <div className="space-y-5 rounded-3xl border border-border bg-card p-6 shadow-xs">
              {/* 상세 헤더 */}
              <div className="pb-4 border-b border-border space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                    <selectedKpi.icon className="size-5 text-primary" />
                    <span>{selectedKpi.name} 상세</span>
                  </h3>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    currentObs.state === 'OBSERVED'
                      ? 'bg-state-ok-soft text-state-ok border border-state-ok/30'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {currentObs.state === 'OBSERVED' ? '기록 확인됨' : '연동 준비 중'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{selectedKpi.subtext}</p>
              </div>

              {/* 관측 수치 카드 */}
              <div className="p-4 rounded-2xl bg-muted/20 border border-border space-y-1">
                <span className="text-xs text-muted-foreground font-medium">확인된 수치</span>
                <div className="text-3xl font-black font-mono text-foreground">
                  {currentObs.state === 'OBSERVED' && currentObs.value !== null
                    ? `${currentObs.value.toLocaleString()}${selectedKpi.unit}`
                    : '아직 확인할 수 없어요'}
                </div>
                {evidenceCount > 0 && (
                  <span className="text-[11px] text-primary font-bold block pt-1">
                    확인된 근거 기록 {evidenceCount}건
                  </span>
                )}
              </div>

              {/* 최근 근거 기록 목록 */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                  <Clock className="size-3.5 text-primary" />
                  <span>최근 근거 기록</span>
                </h4>
                {evidenceCount === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 rounded-xl bg-muted/30 border border-border/50 text-center">
                    이 기간에 확인된 근거 기록이 없어요.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {currentObs.evidenceIds.map((id, index) => (
                      <li
                        key={id}
                        className="p-3 rounded-xl bg-muted/30 border border-border/50 flex items-center justify-between text-xs"
                      >
                        <span className="font-medium text-foreground">
                          {selectedKpi.name} 기록 #{index + 1}
                        </span>
                        {selectedKpi.key === 'bookings' ? (
                          <Link
                            href={`/app/customers#reservation-${encodeURIComponent(id)}`}
                            className="text-primary hover:underline flex items-center gap-1 text-[11px] font-bold"
                          >
                            <span>장부 보기</span>
                            <ArrowUpRight className="size-3" />
                          </Link>
                        ) : (
                          <span className="text-[11px] text-muted-foreground font-mono">기록 확인 완료</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 근거 링크 & 단일 실행 버튼 */}
              <div className="pt-2 border-t border-border space-y-2.5">
                <Link
                  href={`/app/results/${selectedKpi.key}/evidence`}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-border bg-background hover:bg-muted text-xs font-semibold text-foreground transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                    성과 근거 기록 보기
                  </span>
                  <ArrowUpRight className="size-3.5 text-muted-foreground" />
                </Link>

                {actionLink && (
                  <Link
                    href={actionLink.href}
                    className="w-full inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs"
                  >
                    {actionLink.label}
                  </Link>
                )}
              </div>
            </div>
          }
        />
      </main>
    </V088AppShell>
  )
}
