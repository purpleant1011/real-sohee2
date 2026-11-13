"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, ArrowRight } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import { EvidenceBadge } from "../artifacts/EvidenceBadge";
import type { TodayAttributionSummaryReadModel } from "@/lib/read-models/today-read-model";

interface AttributionFunnelCardProps {
  attribution: TodayAttributionSummaryReadModel;
}

export function AttributionFunnelCard({ attribution }: AttributionFunnelCardProps) {
  const router = useRouter();

  const confirmed = attribution.confirmedRevenue.value;
  const estimated = attribution.estimatedRevenue.value;
  const total = Math.max(1, confirmed + estimated);
  const directRatio = Math.round((confirmed / total) * 100);

  return (
    <SoheeCard variant="default" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-[#ECFDF5] text-[#10B981] dark:bg-state-ok/60 dark:text-state-ok">
            <TrendingUp className="w-3.5 h-3.5" />
          </span>
          <div>
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#8C8A87]">
              ATTRIBUTION LEDGER
            </span>
            <h3 className="text-sm font-black text-[#171717] dark:text-white">
              소희 마케팅 매출 기여도
            </h3>
          </div>
        </div>
        <button
          onClick={() => router.push(`/app/reports`)}
          className="text-xs font-bold text-[#6D4AFF] hover:text-[#5A35EB] dark:text-[#8B6BFF] flex items-center gap-1"
        >
          <span>원장 상세</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* 2-Column Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl bg-[#FAF9F7] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#666666] dark:text-zinc-400">
              확정 기여 매출
            </span>
            <EvidenceBadge provenance={attribution.confirmedRevenue.provenance} />
          </div>
          <div className="text-lg sm:text-xl font-black text-[#171717] dark:text-white tabular-nums">
            {confirmed.toLocaleString()}
            <span className="text-xs font-bold text-[#8C8A87] ml-0.5">원</span>
          </div>
          <span className="block text-[10px] text-[#10B981] font-bold">
            직접 예약 {attribution.directBookings}건 / 보조 {attribution.assistedBookings}건
          </span>
        </div>

        <div className="p-3 rounded-xl bg-[#FAF9F7] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[#666666] dark:text-zinc-400">
              예상 파이프라인
            </span>
            <EvidenceBadge provenance={attribution.estimatedRevenue.provenance} />
          </div>
          <div className="text-lg sm:text-xl font-black text-[#6D4AFF] dark:text-[#8B6BFF] tabular-nums">
            +{estimated.toLocaleString()}
            <span className="text-xs font-bold text-[#8C8A87] ml-0.5">원</span>
          </div>
          <span className="block text-[10px] text-[#8C8A87] font-semibold">
            진행 중 미션 전환 기대치
          </span>
        </div>
      </div>

      {/* Multi-touch Breakdown Bar */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[11px] font-bold">
          <span className="text-[#555555] dark:text-zinc-300">
            확정 기여: {confirmed.toLocaleString()}원 ({directRatio}%)
          </span>
          <span className="text-[#8C8A87]">
            파이프라인: {estimated.toLocaleString()}원
          </span>
        </div>
        <div className="h-2 w-full bg-[#EAE7E3] dark:bg-zinc-800 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-[#6D4AFF]"
            style={{ width: `${directRatio}%` }}
          />
          <div
            className="h-full bg-[#DCD3FF] dark:bg-[#3D3075]"
            style={{ width: `${100 - directRatio}%` }}
          />
        </div>
      </div>
    </SoheeCard>
  );
}
