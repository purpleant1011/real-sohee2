'use client';

import React, { useState, useMemo } from 'react';
import { TrendingUp, ShieldCheck, GitBranch, Sparkles, PieChart } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AttributionModelType } from '@/lib/attribution-learning/attribution/cross-channel-attribution-engine';

import { EmptyEvidenceState } from '@/components/v088/same-truth';
import {
  FUNNEL_DEFINITION,
  UNKNOWN_VALUE,
  buildConversionFunnel,
  confirmedBookingView,
  hasAttributionEvidence,
  receiptCoverageLabel,
  revenueView,
  type ReportTruthSource,
} from './report-truth';

export function AttributionOutcomeConsole({ workspaceId }: { workspaceId: string }) {
  const [selectedModel, setSelectedModel] = useState<AttributionModelType>('POSITION_BASED');
  const [loaded, setLoaded] = useState<{ workspaceId: string; source: ReportTruthSource } | null>(null);

  /**
   * Same authorized source the home, results and customers screens read, so this
   * console cannot disagree with them. A failed or mismatched read leaves the
   * source null and every figure falls back to an honest "아직 확인할 수 없어요" /
   * "연동 대기" instead of a fabricated zero.
   */
  React.useEffect(() => {
    let active = true;
    if (!workspaceId || workspaceId === 'ws-default') return;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/reports/weekly`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((report: ReportTruthSource | null) => {
        if (!active || !report) return;
        if (report.workspaceId && report.workspaceId !== workspaceId) return;
        setLoaded({ workspaceId, source: report });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const source = loaded?.workspaceId === workspaceId ? loaded.source : null;

  const revenue = revenueView(source);
  const bookings = confirmedBookingView(source);
  const coverageLabel = receiptCoverageLabel(source);
  const funnel = buildConversionFunnel(source);
  const attributionReady = hasAttributionEvidence(source);

  const modelDescription = useMemo(() => {
    switch (selectedModel) {
      case 'FIRST_TOUCH':
        return '고객이 우리 매장을 처음 발견하게 만든 최초 유입 채널(인스타그램 릴스 등)에 100% 기여도를 부여합니다.';
      case 'LAST_NON_DIRECT':
        return '방문 결제 직전 최종 결심을 이끌어낸 마지막 상담/검색 채널(네이버 블로그/카카오)에 100% 기여도를 부여합니다.';
      case 'LINEAR':
        return '고객이 거쳐 간 모든 채널 접점에 동일한 비중으로 성과를 균등하게 배분합니다.';
      case 'POSITION_BASED':
        return '최초 발견(40%)과 최종 결제(40%)를 가장 높게 평가하고, 중간 경유지(20%)를 고르게 인정하는 표준 U자형 모델입니다.';
    }
  }, [selectedModel]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16 font-sans">
      {/* 1. 상단 인트로 헤더 */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-zinc-950 via-zinc-900 to-emerald-950 p-6 sm:p-8 shadow-xl text-white">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-72 h-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-emerald-500/25 text-emerald-200 border-emerald-400/40 text-xs px-2.5 py-0.5 font-bold">
                <TrendingUp className="size-3.5 mr-1" />
                CLOSED-LOOP ATTRIBUTION & OUTCOME LEARNING
              </Badge>
              <span className="text-xs text-zinc-400 font-medium">· 인과추론 기여도 엔진 V0.9</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
              성과 기여도 & 폐쇄루프 학습 콘솔
            </h1>
            <p className="text-sm text-zinc-200 max-w-2xl leading-relaxed">
              단순한 클릭·좋아요 지표를 배제하고, 실제 결제 및 예약으로 이어진 11대 정식 이벤트 계보를 추적하여
              어떤 채널과 플러그인이 매출을 만들었는지 수학적으로 증명합니다.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-zinc-900/90 border border-zinc-700/80 rounded-2xl p-4 shadow-lg backdrop-blur shrink-0">
            <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-300">
              <ShieldCheck className="size-6" />
            </div>
            <div>
              <span className="text-xs text-zinc-400 font-semibold">검증 확정 실매출</span>
              <strong className="text-2xl font-black text-white block tabular-nums">
                {revenue.value}
              </strong>
              <span className={`text-[10px] font-bold ${revenue.observed ? 'text-emerald-400' : 'text-zinc-400'}`}>
                {coverageLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 4대 핵심 결과 지표 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-3xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-semibold">
            <span>확정 발생 매출</span>
            <Badge variant="outline" className="text-[10px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 font-bold">
              {revenue.badge}
            </Badge>
          </div>
          <strong className="text-2xl font-black text-zinc-900 dark:text-zinc-100 tabular-nums block">
            {revenue.value}
          </strong>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
            {revenue.note}
          </span>
        </Card>

        <Card className="rounded-3xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-semibold">
            <span>직접 예약 전환</span>
            <Badge variant="outline" className="text-[10px] bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800 font-bold">
              {bookings.badge}
            </Badge>
          </div>
          <strong className="text-2xl font-black text-purple-600 dark:text-purple-400 tabular-nums block">
            {bookings.value}
          </strong>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
            {bookings.note}
          </span>
        </Card>

        <Card className="rounded-3xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-semibold">
            <span>마케팅 어시스트 예약</span>
            <Badge variant="outline" className="text-[10px] bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border-sky-300 dark:border-sky-800 font-bold">
              NO_PROOF
            </Badge>
          </div>
          <strong className="text-2xl font-black text-zinc-900 dark:text-zinc-100 tabular-nums block">
            {UNKNOWN_VALUE}
          </strong>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
            복합 터치포인트 기여 기록 없음
          </span>
        </Card>

        <Card className="rounded-3xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-semibold">
            <span>기여 학습 가중치 갱신</span>
            <Badge variant="outline" className="text-[10px] bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 font-bold">
              PENDING
            </Badge>
          </div>
          <strong className="text-2xl font-black text-zinc-900 dark:text-zinc-100 tabular-nums block">
            데이터 대기
          </strong>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
            학습 데이터 축적 대기
          </span>
        </Card>
      </div>

      {/* 3. 6단계 폐쇄루프 전환선 (Closed-Loop Conversion Pipeline) */}
      <Card className="rounded-3xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <GitBranch className="size-4 text-emerald-500" />
              <span>6단계 폐쇄루프 전환선 (Closed-Loop Conversion Pipeline)</span>
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              도달부터 실제 매출 정산, 그리고 소희 에이전트의 차기 캠페인 가중치 최적화까지 완결되는 루프입니다.
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-3xl leading-relaxed">{FUNNEL_DEFINITION}</p>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700">
            ANI-787 CLOSED-LOOP
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
          {funnel.map((item, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-2xl border text-center space-y-1.5 shadow-2xs ${
                idx === 4
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/60 ring-1 ring-emerald-500/20'
                  : idx === 5
                  ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-300 dark:border-purple-700/60 ring-1 ring-purple-500/20'
                  : 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700/80'
              }`}
            >
              <Badge variant="outline" className="text-[9px] py-0 px-1 font-bold">
                {item.badge}
              </Badge>
              <strong className="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 block">{item.title}</strong>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-tight font-medium">{item.desc}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* 4. 멀티터치 기여도 모델 비교 & 채널별 기여 매출 */}
      <Card className="rounded-3xl border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <PieChart className="size-4 text-purple-500" />
              <span>멀티터치 기여도 모델 대조 (Multi-Touch Attribution)</span>
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-xl leading-relaxed">{modelDescription}</p>
          </div>

          <div className="flex items-center gap-1.5 p-1 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl overflow-x-auto">
            {(
              [
                { id: 'POSITION_BASED', label: 'U자형 (40:20:40)' },
                { id: 'FIRST_TOUCH', label: '최초 접점' },
                { id: 'LAST_NON_DIRECT', label: '최종 유입' },
                { id: 'LINEAR', label: '균등 분배' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedModel(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  selectedModel === m.id
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/*
          Channel-level attribution shares are only shown when the verified
          revenue ledger produced evidence ids. Until then no share, percentage
          or channel amount is rendered at all — a demo fixture must never reach
          a real owner's screen.
        */}
        <EmptyEvidenceState
          title={
            attributionReady
              ? '채널별 기여도는 영수증 근거가 쌓인 뒤 표시됩니다'
              : '기록된 성과 기여도 이벤트가 없습니다 (NO_PROOF)'
          }
          description="실제 외부 채널(Instagram, Threads, Naver Blog)의 콘텐츠 발행 및 예약 결제가 발생하면 UTM과 영수증에 기반하여 채널별 기여도가 자동 산출됩니다."
          actionLabel="채널 연동 확인하기"
          actionHref="/app/channels"
        />
      </Card>

      {/* 5. Next-Best-Action (NBA) 추천 카드 */}
      <Card className="rounded-3xl border border-purple-500/30 bg-gradient-to-br from-zinc-950 via-zinc-900 to-purple-950 p-6 sm:p-8 shadow-xl text-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-purple-500/25 text-purple-200 border-purple-400/40 text-xs px-2.5 py-0.5 font-bold">
                <Sparkles className="size-3.5 mr-1" />
                SOHEE NEXT-BEST-ACTION (NBA)
              </Badge>
              <span className="text-xs text-zinc-400 font-medium">· 폐쇄루프 학습 추천</span>
            </div>
            <h3 className="text-base sm:text-lg font-extrabold text-white">
              소희가 매장의 첫 마케팅 성과 데이터를 분석하고 있습니다.
            </h3>
            <p className="text-xs sm:text-sm text-zinc-200 max-w-2xl leading-relaxed">
              콘텐츠 발행 및 고객 응대가 진행되면, 가장 높은 결제 전환을 기록한 채널과 접점을 분석하여 매출을 극대화할 수 있는 최적의 다음 행동(Next-Best-Action)을 자동 제안합니다.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Badge variant="outline" className="border-white/20 text-zinc-300 text-xs py-2 px-3.5 font-mono">
              데이터 수집 대기 중
            </Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}
