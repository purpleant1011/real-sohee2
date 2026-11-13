"use client";

import React from "react";
import { Target, TrendingUp } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import { EvidenceBadge } from "./EvidenceBadge";
import type { TodayGoalReadModel } from "@/lib/read-models/today-read-model";

export interface GoalCardProps {
  goal: TodayGoalReadModel;
  className?: string;
}

export function GoalCard({ goal, className = "" }: GoalCardProps) {
  const rate = Math.min(Math.round(goal.achievementRate), 100);

  return (
    <SoheeCard
      variant="elevated"
      className={`space-y-4 bg-gradient-to-br from-white via-white to-[#F1EDFF]/30 dark:from-[#141517] dark:via-[#141517] dark:to-[#231C44]/20 border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#6D4AFF] text-white shadow-xs">
            <Target className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-sm font-black text-[#171717] dark:text-white">
              {goal.period === "weekly" ? "이번 주 마케팅 목표" : "이번 달 마케팅 목표"}
            </h3>
            <span className="text-[10px] text-[#8C8A87]">{goal.sourceDescription}</span>
          </div>
        </div>

        <EvidenceBadge provenance="target" />
      </div>

      {/* Target vs Current Metric */}
      <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900/80 border border-[#EAE7E3] dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="block text-xs font-bold text-[#666666] dark:text-zinc-400">{goal.title}</span>
          <div className="flex items-baseline gap-2">
            <strong className="text-2xl sm:text-3xl font-black text-[#171717] dark:text-white tabular-nums tracking-tight">
              {goal.currentValue.toLocaleString()}
            </strong>
            <span className="text-sm font-bold text-[#8C8A87]">
              / {goal.targetValue.toLocaleString()} {goal.unit}
            </span>
          </div>
        </div>

        {/* Circular / Big Percent Indicator */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block text-[10px] font-bold text-[#8C8A87]">달성률</span>
            <strong className="text-xl font-black text-[#6D4AFF] dark:text-[#8B6BFF] tabular-nums">
              {rate}%
            </strong>
          </div>
          <div className="w-12 h-12 rounded-full border-4 border-[#F1EDFF] dark:border-zinc-800 relative flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full border-4 border-[#6D4AFF] dark:border-[#8B6BFF]"
              style={{
                clipPath: `polygon(50% 50%, -50% -50%, ${rate}% -50%, ${rate}% 150%, -50% 150%)`,
              }}
            />
            <TrendingUp className="w-4 h-4 text-[#6D4AFF] dark:text-[#8B6BFF]" />
          </div>
        </div>
      </div>
    </SoheeCard>
  );
}
