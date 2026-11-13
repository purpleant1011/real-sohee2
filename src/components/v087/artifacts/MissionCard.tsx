"use client";

import React from "react";
import { Rocket, CheckCircle2, Clock, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import { SoheeButton } from "../ui/SoheeButton";
import type { TodayMissionReadModel } from "@/lib/read-models/today-read-model";

export interface MissionCardProps {
  mission: TodayMissionReadModel;
  onViewDetail?: (id: string) => void;
  className?: string;
}

export function MissionCard({
  mission,
  onViewDetail,
  className = "",
}: MissionCardProps) {
  const getStatusBadge = () => {
    switch (mission.status) {
      case "in_progress":
        return {
          label: "소희 실행 중",
          icon: Loader2,
          iconClass: "animate-spin text-[#6D4AFF]",
          bg: "bg-[#F1EDFF] text-[#5333E0] border-[#DDD6FE] dark:bg-[#231C44] dark:text-[#C3B4FF]",
        };
      case "completed":
        return {
          label: "실행 완료",
          icon: CheckCircle2,
          iconClass: "text-[#10B981]",
          bg: "bg-state-ok-soft text-state-ok border-state-ok/30 dark:bg-state-ok/60 dark:text-state-ok",
        };
      case "planning":
        return {
          label: "계획 수립 중",
          icon: Clock,
          iconClass: "text-state-warn",
          bg: "bg-state-warn-soft text-state-warn border-state-warn/30 dark:bg-state-warn/60 dark:text-state-warn",
        };
      default:
        return {
          label: "일시 정지",
          icon: AlertCircle,
          iconClass: "text-zinc-500",
          bg: "bg-zinc-100 text-zinc-700 border-zinc-200",
        };
    }
  };

  const status = getStatusBadge();
  const StatusIcon = status.icon;
  const progressPercent = Math.round((mission.completedStepCount / mission.stepCount) * 100);

  return (
    <SoheeCard
      variant="elevated"
      className={`space-y-4 hover:border-[#6D4AFF]/40 transition-all ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#6D4AFF] text-white shadow-xs">
            <Rocket className="w-4 h-4" />
          </span>
          <span className="text-xs font-black text-[#171717] dark:text-white">마케팅 실행안</span>
        </div>

        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${status.bg}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${status.iconClass}`} />
          {status.label}
        </span>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-base font-black text-[#171717] dark:text-white leading-snug">{mission.title}</h3>
        <p className="text-xs text-[#555555] dark:text-zinc-300 font-medium">{mission.objective}</p>
      </div>

      {/* Progress Bar & Current Step */}
      <div className="p-3.5 rounded-xl bg-[#FAF9F7] dark:bg-zinc-900/70 border border-[#EAE7E3] dark:border-zinc-800 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-[#666666] dark:text-zinc-400">
            실행 단계 ({mission.completedStepCount}/{mission.stepCount})
          </span>
          <span className="font-extrabold text-[#6D4AFF] dark:text-[#8B6BFF] tabular-nums">{progressPercent}% 완료</span>
        </div>

        {/* Bar */}
        <div className="w-full h-2 rounded-full bg-[#EAE7E3] dark:bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#6D4AFF] to-[#8B6BFF] transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="pt-1 flex items-center gap-1.5 text-xs text-[#333333] dark:text-zinc-200">
          <strong className="text-[#6D4AFF] dark:text-[#8B6BFF]">현재 단계:</strong>
          <span className="truncate">{mission.currentStepDescription}</span>
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <SoheeButton
          size="sm"
          variant="secondary"
          icon={<ArrowRight className="w-4 h-4" />}
          onClick={() => onViewDetail?.(mission.id)}
        >
          실행안 세부 타임라인 보기
        </SoheeButton>
      </div>
    </SoheeCard>
  );
}
