"use client";

import React from "react";
import { Target, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import { EvidenceBadge } from "../artifacts/EvidenceBadge";
import type { TodayGoalReadModel } from "@/lib/read-models/today-read-model";

interface GoalProgressCardProps {
  goal: TodayGoalReadModel;
}

export function GoalProgressCard({ goal }: GoalProgressCardProps) {
  const percentage = Math.min(
    100,
    Math.round((goal.currentValue / Math.max(1, goal.targetValue)) * 100)
  );

  return (
    <SoheeCard variant="hero" className="border-[#E5DEFF] dark:border-[#3D3075]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        {/* Left: Goal Title & Subtext */}
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#6D4AFF] text-white shadow-sm">
              <Target className="w-4 h-4" />
            </span>
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#6D4AFF] dark:text-[#8B6BFF]">
                최우선 매장 목표 ({goal.period === "weekly" ? "주간" : "월간"})
              </span>
              <h2 className="text-lg sm:text-xl font-black text-[#171717] dark:text-white tracking-tight">
                {goal.title}
              </h2>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-[#666666] dark:text-zinc-300 max-w-xl leading-relaxed">
            출처: {goal.sourceDescription} (달성률 {goal.achievementRate}%)
          </p>
        </div>

        {/* Right: Metrics Bento */}
        <div className="flex items-center gap-4 sm:gap-6 shrink-0 bg-white/80 dark:bg-[#1C1E22]/80 p-3.5 sm:p-4 rounded-2xl border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] shadow-xs">
          <div className="text-right">
            <div className="flex items-baseline justify-end gap-1 font-black text-2xl sm:text-3xl text-[#171717] dark:text-white tabular-nums tracking-tight">
              <span className="text-[#6D4AFF] dark:text-[#8B6BFF]">{goal.currentValue}</span>
              <span className="text-[#8C8A87] text-lg font-bold">/</span>
              <span>{goal.targetValue}</span>
              <span className="text-xs font-bold text-[#666666] dark:text-zinc-400 ml-0.5">{goal.unit}</span>
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#10B981]">
                <ArrowUpRight className="w-3 h-3" />
                {percentage}% 달성
              </span>
              <EvidenceBadge provenance={goal.provenance} />
            </div>
          </div>
        </div>
      </div>

      {/* Fluid Progress Bar */}
      <div className="mt-5 space-y-1.5">
        <div className="h-2.5 w-full bg-[#EAE7E3] dark:bg-zinc-800 rounded-full overflow-hidden p-0.5 shadow-inner">
          <div
            className="h-full bg-gradient-to-r from-[#6D4AFF] to-[#8B6BFF] rounded-full transition-all duration-700 ease-out shadow-[0_0_12px_rgba(109,74,255,0.5)]"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#8C8A87]">
          <span>실시간 지표 정합성 보장</span>
          <span className="flex items-center gap-1 text-[#10B981] font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            목표 달성 순항 중
          </span>
        </div>
      </div>
    </SoheeCard>
  );
}
