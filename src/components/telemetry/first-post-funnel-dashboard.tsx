'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Sparkles,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import type {
  FunnelMetricsResult,
  FailureTaxonomyResult,
} from '@/features/telemetry/first-post-funnel-telemetry'

export function FirstPostFunnelDashboard() {
  const [metrics, setMetrics] = useState<FunnelMetricsResult | null>(null)
  const [failures, setFailures] = useState<FailureTaxonomyResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch('/api/telemetry/funnel/metrics')
      if (!res.ok) {
        throw new Error('텔레메트리 지표를 불러오지 못했습니다.')
      }
      const data = await res.json()
      setMetrics(data.funnelMetrics)
      setFailures(data.failureTaxonomy)
    } catch (err: any) {
      setError(err.message || '지표 조회 실패')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function initialLoad() {
      try {
        setIsLoading(true)
        setError(null)
        const res = await fetch('/api/telemetry/funnel/metrics')
        if (!res.ok) {
          throw new Error('텔레메트리 지표를 불러오지 못했습니다.')
        }
        const data = await res.json()
        if (isMounted) {
          setMetrics(data.funnelMetrics)
          setFailures(data.failureTaxonomy)
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || '지표 조회 실패')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    initialLoad()

    return () => {
      isMounted = false
    }
  }, [])

  function formatSeconds(sec: number): string {
    if (sec < 60) return `${sec}초`
    const min = Math.floor(sec / 60)
    const remainSec = sec % 60
    return `${min}분 ${remainSec}초`
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-6 rounded-3xl bg-gradient-to-br from-zinc-900 via-indigo-950/40 to-zinc-900 border border-zinc-800 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-bold border border-indigo-500/20">
            <Sparkles className="w-3.5 h-3.5" />
            <span>North Star Telemetry · V0.91 R2</span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Time to First Verified Post 퍼널 관측소
          </h2>
          <p className="text-xs text-zinc-400">
            가맹점 온보딩 시작부터 첫 검증 게시물 발행까지의 실시간 전환율과 소요 시간을 계측합니다.
          </p>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={isLoading}
          className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>새로고침</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-xs font-semibold">총 시작 여정</span>
              <TrendingUp className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-white">{metrics.totalJourneys}건</div>
            <div className="text-[11px] text-zinc-500">온보딩 진입 세션 수</div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-xs font-semibold">첫 게시물 완료율</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400">
              {metrics.overallConversionRatePct.toFixed(1)}%
            </div>
            <div className="text-[11px] text-zinc-500">
              완료 {metrics.completedJourneys}건 / 시작 {metrics.totalJourneys}건
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-xs font-semibold">Time to First Post (평균)</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {metrics.timeToFirstVerifiedPostSec.totalCompletedCount > 0
                ? formatSeconds(metrics.timeToFirstVerifiedPostSec.avgSeconds)
                : '-'}
            </div>
            <div className="text-[11px] text-zinc-500">
              중앙값 {metrics.timeToFirstVerifiedPostSec.totalCompletedCount > 0 ? formatSeconds(metrics.timeToFirstVerifiedPostSec.medianSeconds) : '-'}
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="text-xs font-semibold">P90 소요 시간</span>
              <ShieldCheck className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-black text-purple-300">
              {metrics.timeToFirstVerifiedPostSec.totalCompletedCount > 0
                ? formatSeconds(metrics.timeToFirstVerifiedPostSec.p90Seconds)
                : '-'}
            </div>
            <div className="text-[11px] text-zinc-500">상위 90% 이내 완주 시간</div>
          </div>
        </div>
      )}

      {/* 16-Step Funnel Progress Bar List */}
      {metrics && (
        <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">16단계 퍼널 전환 및 단계별 이탈 분석</h3>
            <span className="text-xs text-zinc-400">전체 {metrics.steps.length}개 단계</span>
          </div>

          <div className="space-y-3">
            {metrics.steps.map((st) => (
              <div key={st.step} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-[10px] font-bold">
                      {st.stepIndex + 1}
                    </span>
                    <span className="font-medium text-zinc-200">{st.step}</span>
                  </div>
                  <div className="flex items-center gap-3 text-zinc-400">
                    <span>도달 {st.reachCount}건</span>
                    <span className="font-bold text-white">{st.conversionFromStartPct.toFixed(1)}%</span>
                    {st.dropOffFromPrevPct > 0 && (
                      <span className="text-rose-400 font-medium">이탈 {st.dropOffFromPrevPct.toFixed(1)}%</span>
                    )}
                  </div>
                </div>

                {/* Progress track */}
                <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${Math.max(2, st.conversionFromStartPct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failure Taxonomy Breakdown */}
      {failures && failures.totalFailures > 0 && (
        <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">
              주요 실패 원인 분류 ({failures.totalFailures}건 발생)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {failures.breakdown.map((item) => (
              <div key={item.category} className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-zinc-300">{item.category}</span>
                  <span className="text-amber-400 font-bold">{item.percentage}%</span>
                </div>
                <div className="text-[11px] text-zinc-500">{item.count}회 발생</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
