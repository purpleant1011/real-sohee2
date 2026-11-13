"use client";

import React, { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ManagerCockpitBriefing } from "@/components/v087/cockpit/ManagerCockpitBriefing";
import { getRevenueCommandReadModel } from "@/lib/read-models/revenue-command-read-model";
import { Sparkles, ArrowRight, ShieldCheck, Clock, CheckCircle2 } from "lucide-react";
import { EvidenceBadge } from "@/components/v087/artifacts/EvidenceBadge";

function useSafeSearchParams() {
  if (typeof window !== "undefined") {
    try {
      return new URLSearchParams(window.location.search);
    } catch {
      return null;
    }
  }
  return null;
}

interface V087TodayCockpitProps {
  workspaceId: string;
}

export function V087TodayCockpit({ workspaceId }: V087TodayCockpitProps) {
  const router = useRouter();
  const searchParams = useSafeSearchParams();
  const isDemo = searchParams ? searchParams.get("demo") === "1" : false;
  const [, startTransition] = useTransition();

  const [data, setData] = useState(() => getRevenueCommandReadModel(workspaceId, isDemo));

  const refreshData = () => {
    startTransition(() => {
      setData(getRevenueCommandReadModel(workspaceId, isDemo));
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Permanent Demo Warning Banner (Isolated from production) */}
      {isDemo && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 dark:bg-amber-950/40 border border-amber-500/30 text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>DEMO MODE — 실제 고객 및 매출 데이터가 아닙니다 (외부 SNS 쓰기 작업이 안전하게 차단됨)</span>
          </div>
          <button
            onClick={() => router.push("/app")}
            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black"
          >
            실제 운영 모드로 전환
          </button>
        </div>
      )}

      {/* 1. 소희 자율 에이전트 마케팅 총괄 브리핑 & Server Kill Switch */}
      <ManagerCockpitBriefing
        workspaceId={workspaceId}
        data={data}
        onRefresh={refreshData}
        onNavigateToAutomation={() => router.push("/app/automation")}
        onNavigateToInbox={() => router.push("/app/inbox")}
      />

      {/* 2. Top Revenue Opportunities (Spotlight Bento) */}
      {data.topOpportunities.length > 0 && (
        <div className="p-6 rounded-3xl bg-white dark:bg-[#130E20] border border-[#E9D5FF] dark:border-[#581C87]/40 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-lg font-black text-[#1F1437] dark:text-[#F3EEFF] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#9333EA]" />
                지금 행동하면 매출로 연결될 기회 (Top Opportunities)
              </h2>
              <p className="text-xs text-[#7E6E9B] dark:text-[#A78BFA]">
                실제 예약 캘린더와 인바운드 대화를 스캔하여 소희가 발견한 즉시 전환 기회입니다.
              </p>
            </div>
            <EvidenceBadge provenance="calculated" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.topOpportunities.map((opp) => (
              <div
                key={opp.id}
                className="p-5 rounded-2xl bg-[#FAF5FF] dark:bg-[#1A1229] border border-[#E9D5FF]/80 dark:border-[#3B1963] flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-md bg-[#9333EA] text-white text-[10px] font-black">
                      {opp.urgency} 긴급
                    </span>
                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                      예상 가치: {(opp.valueBand.min / 10000).toLocaleString()}~{(opp.valueBand.max / 10000).toLocaleString()}만원
                    </span>
                  </div>
                  <h3 className="text-sm font-black text-[#1F1437] dark:text-[#F3EEFF]">
                    {opp.title}
                  </h3>
                  <p className="text-xs text-[#7E6E9B] dark:text-[#A78BFA] leading-relaxed">
                    {opp.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-[#E9D5FF]/60 dark:border-[#3B1963] flex items-center justify-between">
                  <div className="text-[11px] text-[#7E6E9B] dark:text-[#A78BFA]">
                    신뢰도: <strong>{opp.confidenceBand}</strong> ({opp.confidenceRationale})
                  </div>
                  <button
                    onClick={() => router.push("/app/automation")}
                    className="px-3.5 py-1.5 rounded-xl bg-[#9333EA] hover:bg-[#7E22CE] text-white text-xs font-bold shadow-xs flex items-center gap-1 cursor-pointer"
                  >
                    소희 실행 위임
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Revenue Pipeline & Sohee Next 24h Queue (2-Column) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* A. Revenue Pipeline */}
        <div className="p-6 rounded-3xl bg-white dark:bg-[#130E20] border border-[#E9D5FF] dark:border-[#581C87]/40 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-[#1F1437] dark:text-[#F3EEFF] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              예약·매출 전환 파이프라인
            </h3>
            <EvidenceBadge provenance="measured" />
          </div>

          <div className="space-y-2.5">
            {data.pipeline.map((item, idx) => (
              <div key={idx} className="p-3 rounded-2xl bg-[#FAF5FF] dark:bg-[#1A1229] border border-[#E9D5FF]/60 dark:border-[#3B1963] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#9333EA]/10 text-[#9333EA] dark:text-[#D8B4FE] text-xs font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-bold text-[#1F1437] dark:text-[#F3EEFF]">{item.label}</span>
                </div>
                <div className="text-xs font-black text-[#1F1437] dark:text-[#F3EEFF] tabular-nums">
                  {item.count}건
                  <span className="text-[11px] font-medium text-[#7E6E9B] ml-2">
                    ({(item.valueAmount / 10000).toLocaleString()}만원)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* B. Next 24 Hours with Stop Conditions */}
        <div className="p-6 rounded-3xl bg-white dark:bg-[#130E20] border border-[#E9D5FF] dark:border-[#581C87]/40 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-[#1F1437] dark:text-[#F3EEFF] flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#9333EA]" />
              다음 24시간 예정 (자동 중단 조건 포함)
            </h3>
            <EvidenceBadge provenance="measured" />
          </div>

          <div className="space-y-2.5">
            {data.next24HoursQueue.map((queue, idx) => (
              <div key={idx} className="p-3 rounded-2xl bg-[#FAF5FF] dark:bg-[#1A1229] border border-[#E9D5FF]/60 dark:border-[#3B1963] flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-[#1F1437] dark:text-[#F3EEFF] flex items-center gap-2">
                    <span className="text-[#9333EA] dark:text-[#D8B4FE] tabular-nums">{queue.time}</span>
                    <span>[{queue.channel}] {queue.action}</span>
                  </div>
                  <div className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                    🛑 중단 조건: {queue.stopCondition}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#9333EA]/10 text-[#9333EA] dark:text-[#D8B4FE] text-[10px] font-bold">
                  대기 중
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Outcome Evidence (Verified Links) */}
      <div className="p-6 rounded-3xl bg-white dark:bg-[#130E20] border border-[#E9D5FF] dark:border-[#581C87]/40 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h3 className="text-base font-black text-[#1F1437] dark:text-[#F3EEFF] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              최근 확인된 실제 성과
            </h3>
            <p className="text-xs text-[#7E6E9B] dark:text-[#A78BFA]">
              외부 소셜 채널 및 예약 시스템에 실제 게시/확정된 내역만 표시됩니다.
            </p>
          </div>
          <EvidenceBadge provenance="measured" />
        </div>

        <div className="space-y-2.5">
          {data.verifiedOutcomes.map((item, idx) => (
            <div key={idx} className="p-4 rounded-2xl bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1F1437] dark:text-[#F3EEFF]">
                  <span className="text-[#9333EA] dark:text-[#D8B4FE] tabular-nums">{item.time}</span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-black">
                    {item.channel}
                  </span>
                  <span>{item.title}</span>
                </div>
                <div className="text-xs text-[#7E6E9B] dark:text-[#A78BFA] font-medium">
                  {item.result}
                </div>
              </div>

              <a
                href={item.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#1A1229] border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-50 shrink-0 shadow-2xs"
              >
                결과 영구링크 확인 ➔
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
