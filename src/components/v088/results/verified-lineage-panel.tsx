'use client';

import React from 'react';
import { 
  VerifiedRevenueEvent, 
  AttributionComparisonReport, 
  ZeroSemanticState 
} from '@/types/attribution-revenue';
import { AttributionRevenueService } from '@/lib/attribution/attribution-revenue-service';
import { 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  ArrowRight, 
  Sparkles, 
  Coins, 
  Receipt, 
  Layers, 
  Info,
  ShieldCheck,
  TrendingUp
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerifiedLineagePanelProps {
  workspaceId: string;
  isTestAccount?: boolean;
}

export function VerifiedLineagePanel({ workspaceId, isTestAccount }: VerifiedLineagePanelProps) {
  // Canonical sample verified revenue events
  const sampleEvents: VerifiedRevenueEvent[] = React.useMemo(() => {
    if (!isTestAccount) return [];
    return [
      {
        revenueEventId: 'rev_ev_001',
        workspaceId,
        bookingId: 'bk_minji_01',
        customerId: 'cust_minji',
        amountKrw: 120000,
        paidAt: '2026-09-06T16:00:00.000Z',
        paymentMethod: 'CARD',
        attributedCampaignId: 'cmp_spring_eyebrow',
        attributedContentId: 'cnt_reels_lookbook',
        attributedConversationId: 'conv_dm_minji',
        confidenceScore: 0.96,
        verificationState: 'VERIFIED',
        evidenceId: 'ev_proof_rev_001',
      },
      {
        revenueEventId: 'rev_ev_002',
        workspaceId,
        bookingId: 'bk_suyeon_02',
        customerId: 'cust_suyeon',
        amountKrw: 90000,
        paidAt: '2026-09-05T14:30:00.000Z',
        paymentMethod: 'CARD',
        attributedContentId: 'cnt_naver_column',
        attributedConversationId: 'conv_talk_suyeon',
        confidenceScore: 0.92,
        verificationState: 'VERIFIED',
        evidenceId: 'ev_proof_rev_002',
      },
    ];
  }, [workspaceId, isTestAccount]);

  const report = React.useMemo(() => {
    return AttributionRevenueService.generateComparisonReport({
      workspaceId,
      period: '최근 7일',
      verifiedEvents: sampleEvents,
      totalAdSpendKrw: isTestAccount ? 24000 : 0,
      connectionStates: {
        organicConnected: true,
        adsConnected: Boolean(isTestAccount),
        crmConnected: true,
        organicLastSync: new Date().toISOString(),
        adsLastSync: isTestAccount ? new Date().toISOString() : null,
        crmLastSync: new Date().toISOString(),
      },
    });
  }, [workspaceId, sampleEvents, isTestAccount]);

  const renderZeroSemanticBadge = (state: ZeroSemanticState) => {
    switch (state) {
      case 'VERIFIED_ACTIVE':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok border border-state-ok/40">정본 수집 중</span>;
      case 'AWAITING_INITIAL_INGESTION':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-state-wait-soft text-state-wait dark:bg-state-wait dark:text-state-wait border border-state-wait/40">초기 데이터 수집 대기</span>;
      case 'MISSING_SOURCE':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-300">채널 미연동</span>;
      case 'STALE':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-state-warn-soft text-state-warn dark:bg-state-warn dark:text-state-warn border border-state-warn/40">동기화 지연</span>;
    }
  };

  return (
    <div className="rounded-3xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800 shadow-xs p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50">
                실측 검증 매출 계보 & 정본 기여도 (Verified Revenue Lineage)
              </h2>
              {report.verifiedEvents.length > 0 ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok font-bold border border-state-ok/40">
                  검증 완료
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 font-bold border border-zinc-300 dark:border-zinc-700">
                  집계 대기
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              조회수나 클릭 등 단순 보조 지표와 분리하여, 실제 계좌에 입금 완료된 검증 매출만을 단일 정본으로 산출합니다.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-500">실측 확정 매출:</span>
          <span className="text-base font-extrabold font-mono text-primary">
            ₩{report.totalActualRevenueKrw.toLocaleString()}
          </span>
        </div>
      </div>

      {/* 1. Zero-Semantics Channel Status Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">유기적 콘텐츠 데이터</span>
          {renderZeroSemanticBadge(report.zeroSemantics.organicContent)}
        </div>
        <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">외부 유료 광고비 데이터</span>
          {renderZeroSemanticBadge(report.zeroSemantics.paidAds)}
        </div>
        <div className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">예약 및 고객 매출 데이터</span>
          {renderZeroSemanticBadge(report.zeroSemantics.crmBookings)}
        </div>
      </div>

      {/* 2. Verified Events Lineage Chain List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-bold text-zinc-500">
          <span>검증된 상업적 매출 이벤트 계보 (Lineage Chains)</span>
          <span className="font-mono text-zinc-400">{sampleEvents.length}건 완료</span>
        </div>

        {sampleEvents.length === 0 ? (
          <div className="p-6 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/60 dark:border-zinc-800 text-center text-xs text-zinc-500 space-y-1">
            <p className="font-bold">아직 실측 완료된 정본 매출 이벤트가 없습니다.</p>
            <p className="text-[11px] text-zinc-400">
              고객 화면에서 확정 예약 및 방문 결제가 발생하면 자동으로 Lineage Chain이 생성됩니다.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sampleEvents.map((ev) => (
              <div
                key={ev.revenueEventId}
                className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-zinc-800 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="font-bold text-primary">{ev.revenueEventId}</span>
                    <span className="text-zinc-400">•</span>
                    <span className="text-zinc-600 dark:text-zinc-300">신뢰도 {(ev.confidenceScore * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-sm text-zinc-950 dark:text-zinc-50">
                      ₩{ev.amountKrw.toLocaleString()} ({ev.paymentMethod})
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-state-ok-soft text-state-ok dark:bg-state-ok dark:text-state-ok text-[10px] font-bold">
                      ✓ 검증 완료
                    </span>
                  </div>
                </div>

                {/* Lineage Chain Flow */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {ev.attributedCampaignId && (
                    <>
                      <div className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                        캠페인: <span className="font-mono font-semibold">{ev.attributedCampaignId}</span>
                      </div>
                      <ArrowRight className="w-3 h-3 text-zinc-400" />
                    </>
                  )}
                  {ev.attributedContentId && (
                    <>
                      <div className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                        콘텐츠: <span className="font-mono font-semibold">{ev.attributedContentId}</span>
                      </div>
                      <ArrowRight className="w-3 h-3 text-zinc-400" />
                    </>
                  )}
                  {ev.attributedConversationId && (
                    <>
                      <div className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                        대화: <span className="font-mono font-semibold">{ev.attributedConversationId}</span>
                      </div>
                      <ArrowRight className="w-3 h-3 text-zinc-400" />
                    </>
                  )}
                  <div className="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                    예약: <span className="font-mono font-semibold">{ev.bookingId}</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-zinc-400" />
                  <div className="px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/30 text-foreground dark:text-primary font-bold">
                    증거 ID: <span className="font-mono">{ev.evidenceId}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Attribution Models Disambiguation Box */}
      <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
          <Info className="w-4 h-4 text-primary" />
          <span>기여도 모델 시뮬레이션 안내 (추정 모델 결과와 실제 매출 구분)</span>
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          대시보드 상단에서 선택 가능한 <strong>최초 터치 / 최종 터치 / 선형 기여</strong> 모델은 마케팅 채널 간의 상대적 효율을 비교하기 위한 <strong>통계적 추정 모델</strong>입니다. 실제 회계상 현금 유입액은 검증된 매출 이벤트(₩{report.totalActualRevenueKrw.toLocaleString()})에 의해서만 결정됩니다.
        </p>
      </div>
    </div>
  );
}
