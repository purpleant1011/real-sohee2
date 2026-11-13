"use client";

import React from "react";
import { ArrowRight, Zap, Clock } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import { SoheeButton } from "../ui/SoheeButton";
import { EvidenceBadge } from "./EvidenceBadge";
import type { TodayOpportunityReadModel } from "@/lib/read-models/today-read-model";

export interface OpportunityCardProps {
  opportunity: TodayOpportunityReadModel;
  onPlanMission?: (id: string) => void;
  className?: string;
}

export function OpportunityCard({
  opportunity,
  onPlanMission,
  className = "",
}: OpportunityCardProps) {
  const getUrgencyBadge = () => {
    switch (opportunity.urgency) {
      case "high":
        return { label: "긴급 기회", bg: "bg-state-danger-soft text-state-danger border-state-danger/30 dark:bg-state-danger/60 dark:text-state-danger" };
      case "medium":
        return { label: "주목 기회", bg: "bg-state-warn-soft text-state-warn border-state-warn/30 dark:bg-state-warn/60 dark:text-state-warn" };
      default:
        return { label: "상시 기회", bg: "bg-state-wait-soft text-state-wait border-state-wait/30 dark:bg-state-wait/60 dark:text-state-wait" };
    }
  };

  const urgency = getUrgencyBadge();

  return (
    <SoheeCard
      variant="elevated"
      className={`space-y-4 hover:border-[#6D4AFF]/40 transition-all ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#6D4AFF] text-white text-xs font-black shadow-xs">
            <Zap className="w-3 h-3 fill-current" />
            기회 점수 {opportunity.score}점
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${urgency.bg}`}>
            {urgency.label}
          </span>
          <EvidenceBadge provenance={opportunity.expectedImpact.provenance} />
        </div>

        <span className="text-[10px] font-bold text-[#8C8A87]">
          출처: {opportunity.source}
        </span>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-base sm:text-lg font-black text-[#171717] dark:text-white leading-snug">
          {opportunity.title}
        </h3>
        <p className="text-xs sm:text-sm text-[#555555] dark:text-zinc-300 font-medium">
          <strong className="text-[#6D4AFF] dark:text-[#8B6BFF] mr-1">왜 지금일까요?</strong>
          {opportunity.whyNow}
        </p>
      </div>

      <div className="p-3.5 rounded-xl bg-[#FAF9F7] dark:bg-zinc-900/70 border border-[#EAE7E3] dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="block text-[10px] font-bold text-[#8C8A87]">예상되는 비즈니스 결과</span>
          <strong className="text-sm font-black text-[#10B981]">{opportunity.expectedImpact.value}</strong>
        </div>

        <span className="text-[11px] font-extrabold text-[#6D4AFF] dark:text-[#8B6BFF]">
          AI 예측 신뢰도 {Math.round(opportunity.confidence * 100)}%
        </span>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#8C8A87]">
          <Clock className="w-3 h-3" />
          유효 기한: {opportunity.expiresAt}
        </span>

        <SoheeButton
          size="sm"
          variant="primary"
          icon={<ArrowRight className="w-4 h-4" />}
          onClick={() => onPlanMission?.(opportunity.id)}
        >
          실행안 수립하기
        </SoheeButton>
      </div>
    </SoheeCard>
  );
}
