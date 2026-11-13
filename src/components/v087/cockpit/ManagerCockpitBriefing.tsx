"use client";

import React, { useState } from "react";
import { 
  Sparkles, 
  Play, 
  Pause, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ArrowRight,
  TrendingUp,
  Calendar,
  Layers,
  ChevronRight,
  ShieldCheck
} from "lucide-react";
import { EvidenceBadge } from "@/components/v087/artifacts/EvidenceBadge";
import { RevenueCommandReadModel } from "@/lib/read-models/revenue-command-read-model";

interface ManagerCockpitBriefingProps {
  workspaceId?: string;
  data: RevenueCommandReadModel;
  onRefresh?: () => void;
  onNavigateToAutomation?: () => void;
  onNavigateToInbox?: () => void;
}

export function ManagerCockpitBriefing({
  workspaceId = "ws-default",
  data,
  onRefresh,
  onNavigateToAutomation,
  onNavigateToInbox,
}: ManagerCockpitBriefingProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [decisionResolved, setDecisionResolved] = useState(false);
  const [activeDrillDown, setActiveDrillDown] = useState<string | null>(null);

  const isKillSwitched = data.agentStatus.killSwitchActive;
  const isPaused = data.agentStatus.actualMode === "PAUSED" || data.agentStatus.actualMode === "BLOCKED";

  const handleToggleKillSwitch = async () => {
    setIsUpdating(true);
    try {
      await fetch(`/api/workspaces/${workspaceId}/agent/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_kill_switch",
          killSwitchActive: !isKillSwitched,
          reason: !isKillSwitched ? "사장님 콕핏에서 Kill Switch 활성화" : "사장님 콕핏에서 정상 업무 복구",
        }),
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Kill switch toggle failed", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDecisionAction = async (actionType: "approve_once" | "approve_always_policy" | "handled_manually") => {
    setDecisionResolved(true);
    // In production, records versioned policy mutation in DB
    if (actionType === "handled_manually" && onNavigateToInbox) {
      onNavigateToInbox();
    }
  };

  if (!data.pulse) {
    return (
      <section className="rounded-2xl border p-6" role="status">
        <h1 className="text-xl font-bold">우리 매장 매출 관리 센터</h1>
        <p className="mt-2">{data.briefingText}</p>
        <p className="mt-2 text-sm">미관측 · 예약 원장 연결 후 가용시간과 매출을 확인할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Top Executive Cockpit Header & Server Kill Switch Bar */}
      <div className="p-6 rounded-3xl bg-linear-to-br from-[#FAF5FF] via-white to-[#F3E8FF]/40 dark:from-[#1E122D] dark:via-[#130E20] dark:to-[#0F0A18] border border-[#E9D5FF] dark:border-[#581C87]/40 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#9333EA]/10 dark:bg-[#9333EA]/20 text-[#9333EA] dark:text-[#D8B4FE] border border-[#9333EA]/20">
                <span className={`w-2 h-2 rounded-full ${isKillSwitched || isPaused ? 'bg-state-danger animate-none' : 'bg-state-ok animate-pulse'}`} />
                {isKillSwitched ? 'Kill Switch 발동 (외부 쓰기 전면 차단)' : isPaused ? '소희 업무 일시정지됨' : '소희 정상 자율 근무 중 (09:00 ~ 21:00)'}
              </span>
              <EvidenceBadge provenance="measured" />
            </div>
            <h1 className="text-2xl font-black text-[#1F1437] dark:text-[#F3EEFF] tracking-tight">
              우리 매장 매출 관리 센터
            </h1>
          </div>

          {/* Global Kill Switch Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleKillSwitch}
              disabled={isUpdating}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 transition-all shadow-xs cursor-pointer ${
                isKillSwitched
                  ? 'bg-state-ok hover:bg-state-ok/90 text-white'
                  : 'bg-state-danger-soft hover:bg-state-danger-soft text-state-danger border border-state-danger/30'
              }`}
            >
              {isKillSwitched ? (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  소희 업무 재개하기
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4" />
                  소희 업무 일시정지 (Kill Switch)
                </>
              )}
            </button>
          </div>
        </div>

        {/* 2. 소희의 아침 대화형 브리핑 (Source-backed) */}
        <div className="mt-5 p-4 rounded-2xl bg-white/80 dark:bg-[#1A1229]/80 border border-[#E9D5FF]/60 dark:border-[#581C87]/30 flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-2xl bg-linear-to-br from-[#9333EA] to-[#7E22CE] text-white flex items-center justify-center shrink-0 shadow-xs">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[#3B2762] dark:text-[#E9D5FF] leading-relaxed">
              &ldquo;{data.briefingText}&rdquo;
            </p>
            <div className="flex items-center gap-3 text-xs text-[#7E6E9B] dark:text-[#A78BFA] font-medium pt-0.5">
              <span>운영 플랜: <strong className="text-[#9333EA] dark:text-[#D8B4FE]">균형 운영 V1 (Active)</strong></span>
              <span>·</span>
              <span>다음 무인 실행: <strong>오늘 12:00 (스레드)</strong></span>
              <span>·</span>
              <span>서버 런타임: <strong>{data.agentStatus.workerVersion}</strong></span>
            </div>
          </div>
        </div>

        {/* 3. 10초 룰: Revenue & Booking Pulse 4구 Bento */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* 가동률 */}
          <div 
            onClick={() => setActiveDrillDown(activeDrillDown === 'occupancy' ? null : 'occupancy')}
            className="p-3.5 rounded-2xl bg-white dark:bg-[#160F24] border border-[#F3E8FF] dark:border-[#3B1963] hover:border-[#9333EA]/40 transition-all cursor-pointer select-none"
          >
            <div className="text-xs font-bold text-[#7E6E9B] dark:text-[#A78BFA] flex items-center justify-between">
              <span className="flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-[#9333EA]" /> 이번 주 가동률</span>
              <EvidenceBadge provenance="calculated" showIcon={false} />
            </div>
            <div className="text-xl font-black text-[#1F1437] dark:text-[#F3EEFF] mt-1 tabular-nums">
              {data.pulse.occupancyRate}%
              <span className="text-xs font-medium text-[#7E6E9B] ml-1">({data.pulse.occupancyNumerator}/{data.pulse.occupancyDenominator}타임)</span>
            </div>
          </div>

          {/* 잔여 빈 슬롯 */}
          <div 
            onClick={() => setActiveDrillDown(activeDrillDown === 'slots' ? null : 'slots')}
            className="p-3.5 rounded-2xl bg-white dark:bg-[#160F24] border border-[#F3E8FF] dark:border-[#3B1963] hover:border-state-warn/40 transition-all cursor-pointer select-none"
          >
            <div className="text-xs font-bold text-[#7E6E9B] dark:text-[#A78BFA] flex items-center justify-between">
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-state-warn" /> 잔여 빈 슬롯</span>
              <EvidenceBadge provenance="measured" showIcon={false} />
            </div>
            <div className="text-xl font-black text-state-warn mt-1 tabular-nums">
              {data.pulse.availableSlotsCount}
              <span className="text-xs font-medium text-[#7E6E9B] ml-1">타임 (화/목 집중)</span>
            </div>
          </div>

          {/* 확정 예약금액 */}
          <div 
            onClick={() => setActiveDrillDown(activeDrillDown === 'revenue' ? null : 'revenue')}
            className="p-3.5 rounded-2xl bg-white dark:bg-[#160F24] border border-[#F3E8FF] dark:border-[#3B1963] hover:border-state-ok/40 transition-all cursor-pointer select-none"
          >
            <div className="text-xs font-bold text-[#7E6E9B] dark:text-[#A78BFA] flex items-center justify-between">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-state-ok" /> 확정 예약(P0)</span>
              <EvidenceBadge provenance="calculated" showIcon={false} />
            </div>
            <div className="text-xl font-black text-state-ok mt-1 tabular-nums">
              {(data.pulse.bookedRevenueAmount / 10000).toLocaleString()}만
              <span className="text-xs font-medium text-[#7E6E9B] ml-1">원 ({data.pulse.confirmedBookingsCount}건)</span>
            </div>
          </div>

          {/* 잠재 예약 매출 */}
          <div 
            onClick={() => setActiveDrillDown(activeDrillDown === 'potential' ? null : 'potential')}
            className="p-3.5 rounded-2xl bg-white dark:bg-[#160F24] border border-[#F3E8FF] dark:border-[#3B1963] hover:border-primary/40 transition-all cursor-pointer select-none"
          >
            <div className="text-xs font-bold text-[#7E6E9B] dark:text-[#A78BFA] flex items-center justify-between">
              <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-primary" /> 잠재 가치(기회)</span>
              <EvidenceBadge provenance="estimated" showIcon={false} />
            </div>
            <div className="text-xl font-black text-primary mt-1 tabular-nums">
              {data.pulse.potentialRevenueMin / 10000}~{data.pulse.potentialRevenueMax / 10000}만
              <span className="text-xs font-medium text-[#7E6E9B] ml-1">원</span>
            </div>
          </div>
        </div>

        {/* Drill-down Explainer Drawer if clicked */}
        {activeDrillDown && (
          <div className="mt-3 p-3.5 rounded-2xl bg-[#FAF5FF] dark:bg-[#1A1229] border border-[#E9D5FF] dark:border-[#3B1963] text-xs space-y-1">
            <div className="font-bold text-[#9333EA] dark:text-[#D8B4FE]">
              {activeDrillDown === 'occupancy' && '📊 예약 가동률 산출 근거: 확정 예약 소요시간 / 실제 판매 가능 총 시간 (분모: 24타임)'}
              {activeDrillDown === 'slots' && '⏰ 잔여 빈 슬롯: 네이버 예약 원장 실시간 동기화 (9/1 14:00, 17:00, 9/3 16:00, 19:00)'}
              {activeDrillDown === 'revenue' && '💰 확정 예약금액: Service Catalog 시그니처 발레아쥬(24만) × 18건 확정 정본'}
              {activeDrillDown === 'potential' && '✨ 잠재 가치: 잔여 4타임 × 서비스 단가(12만~24만) 기반의 예측 가치 밴드'}
            </div>
            <div className="text-[11px] text-[#7E6E9B] dark:text-[#A78BFA]">
              실측 시각: {new Date(data.pulse.updatedAt).toLocaleTimeString()} · Source: Naver Reservation SOT · Definition: V0.8.7 Data Spine
            </div>
          </div>
        )}
      </div>

      {/* 4. 사장님 확인 필요 안건 (Standard Human Decision Card - RED Action) */}
      {!decisionResolved && data.decisions.length > 0 && (
        <div className="p-6 rounded-3xl bg-[#FFF1F2] dark:bg-[#4C0519]/30 border-2 border-state-danger/40 shadow-md">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-state-danger text-white text-[11px] font-black tracking-wide">
                  RED ACTION · 사장님 결정 필요
                </span>
                <span className="text-xs font-bold text-state-danger">
                  인스타그램 DM 고객 컴플레인
                </span>
              </div>
              <h2 className="text-lg font-black text-[#881337] dark:text-[#FFE4E6]">
                {data.decisions[0].question}
              </h2>
              <p className="text-sm text-[#9F1239] dark:text-[#FDA4AF] leading-relaxed">
                &ldquo;어제 구매한 상품/이용한 서비스에 문의가 있어요.&rdquo;
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2">
                <div className="p-3 rounded-xl bg-white/80 dark:bg-[#1E0B14]/80 text-xs text-[#881337] dark:text-[#F43F5E] font-medium border border-state-danger/30">
                  💡 <strong>승인 시 (소희 추천):</strong> {data.decisions[0].impactIfApproved}
                </div>
                <div className="p-3 rounded-xl bg-white/80 dark:bg-[#1E0B14]/80 text-xs text-state-danger font-medium border border-state-danger/30">
                  ⚠️ <strong>거절 시:</strong> {data.decisions[0].impactIfRejected}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-state-danger/30 flex flex-wrap items-center justify-end gap-2.5">
            <button
              onClick={() => handleDecisionAction("approve_once")}
              className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#2A0815] text-xs font-bold text-state-danger border border-state-danger/40 hover:bg-state-danger-soft cursor-pointer"
            >
              이번만 무료 리터치로 안내
            </button>
            <button
              onClick={() => handleDecisionAction("approve_always_policy")}
              className="px-3.5 py-2 rounded-xl bg-[#9333EA] hover:bg-[#7E22CE] text-white text-xs font-bold shadow-xs cursor-pointer"
              title="앞으로 7일 내 단순 불만 건은 자동으로 리터치 안내 정책으로 등록합니다"
            >
              앞으로 같은 조건은 자동 (정책화)
            </button>
            <button
              onClick={() => handleDecisionAction("handled_manually")}
              className="px-4 py-2 rounded-xl bg-state-danger hover:bg-state-danger/90 text-white text-xs font-black shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              직접 답변하기 (문의함)
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
