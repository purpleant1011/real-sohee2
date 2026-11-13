"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Rocket, ArrowRight } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import type { TodayMissionReadModel } from "@/lib/read-models/today-read-model";

interface ActiveMissionTimelineProps {
  mission: TodayMissionReadModel | null;
}

export function ActiveMissionTimeline({ mission }: ActiveMissionTimelineProps) {
  const router = useRouter();

  if (!mission) {
    return (
      <SoheeCard variant="default">
        <div className="flex items-center justify-between pb-3 border-b border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2">
            <Rocket className="w-4 h-4 text-[#6D4AFF]" />
            <h3 className="text-sm font-extrabold text-[#171717] dark:text-white">
              소희가 진행 중인 실행안
            </h3>
          </div>
        </div>
        <div className="py-8 text-center text-xs font-semibold text-[#8C8A87]">
          현재 실행 중인 마케팅 실행안이 없습니다. 기회함에서 새 실행안을 시작해 보세요.
        </div>
      </SoheeCard>
    );
  }

  return (
    <SoheeCard variant="default" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-[#F1EDFF] text-[#6D4AFF] dark:bg-[#231C44] dark:text-[#C3B4FF]">
            <Rocket className="w-3.5 h-3.5" />
          </span>
          <div>
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#8C8A87]">
              ACTIVE MISSION ({mission.completedStepCount}/{mission.stepCount} 단계)
            </span>
            <h3 className="text-sm font-black text-[#171717] dark:text-white">
              {mission.title}
            </h3>
          </div>
        </div>
        <button
          onClick={() => router.push(`/app/missions/${mission.id}`)}
          className="text-xs font-bold text-[#6D4AFF] hover:text-[#5A35EB] dark:text-[#8B6BFF] flex items-center gap-1"
        >
          <span>상세</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Step Info */}
      <div className="p-3.5 rounded-xl bg-[#FAF9F7] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] space-y-2">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#6D4AFF] text-white text-[10px] font-black">
            {mission.completedStepCount + 1}
          </span>
          <strong className="text-xs font-bold text-[#171717] dark:text-white">
            현재 진행: {mission.currentStepDescription}
          </strong>
        </div>
        <p className="text-[11px] text-[#666666] dark:text-zinc-400">
          최상위 목표: {mission.objective}
        </p>
      </div>
    </SoheeCard>
  );
}
