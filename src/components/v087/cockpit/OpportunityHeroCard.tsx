"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Zap } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import { SoheeButton } from "../ui/SoheeButton";
import { EvidenceBadge } from "../artifacts/EvidenceBadge";
import type { TodayOpportunityReadModel } from "@/lib/read-models/today-read-model";

interface OpportunityHeroCardProps {
  opportunity: TodayOpportunityReadModel;
}

export function OpportunityHeroCard({ opportunity }: OpportunityHeroCardProps) {
  const router = useRouter();

  return (
    <SoheeCard variant="elevated" className="border-[#DCD3FF]/60 dark:border-[#3D3075]/80 relative overflow-hidden">
      {/* Ambient Radar Glow */}
      <div className="pointer-events-none absolute -top-20 -right-20 w-64 h-64 rounded-full bg-[#6D4AFF]/10 blur-3xl" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        {/* Left: Radar Badge & Opportunity Content */}
        <div className="space-y-3.5 flex-1">
          {/* Radar Category & Score Pill */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#6D4AFF] text-white text-xs font-black shadow-xs">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              오늘의 최고 기회 (Top Opportunity)
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#F1EDFF] text-[#5333E0] dark:bg-[#231C44] dark:text-[#C3B4FF] text-xs font-extrabold border border-[#DCD3FF] dark:border-[#3D3075]">
              <Zap className="w-3 h-3 fill-current" />
              Score {opportunity.score}점
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FEF2F2] text-[#DC2626] dark:bg-state-danger/60 dark:text-state-danger">
              {opportunity.urgency === "high" ? "긴급 조치 권장" : "추천 기회"}
            </span>
            <EvidenceBadge provenance={opportunity.expectedImpact.provenance} />
          </div>

          {/* Title & Why Now */}
          <div>
            <h3 className="text-base sm:text-lg lg:text-xl font-black text-[#171717] dark:text-white tracking-tight">
              {opportunity.title}
            </h3>
            <p className="mt-1.5 text-xs sm:text-sm text-[#444444] dark:text-zinc-300 leading-relaxed font-medium">
              <strong className="text-[#6D4AFF] dark:text-[#8B6BFF] mr-1">왜 지금?</strong>
              {opportunity.whyNow}
            </p>
          </div>

          {/* Signals & Financial Expectations */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#F6F4F0] dark:bg-[#1C1E22] text-[11px] font-bold text-[#555555] dark:text-zinc-300 border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6D4AFF]" />
              출처: {opportunity.source}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-state-ok-soft text-state-ok dark:bg-state-ok/60 dark:text-state-ok text-[11px] font-black">
              {opportunity.expectedImpact.value}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 shrink-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-[#EAE7E3] dark:border-zinc-800">
          <SoheeButton
            size="lg"
            variant="primary"
            icon={<ArrowRight className="w-4 h-4" />}
            onClick={() => router.push(`/app/missions/ms-001`)}
            className="w-full sm:w-auto shadow-md"
          >
            실행안 수립 및 실행
          </SoheeButton>
          <button
            onClick={() => router.push(`/app/opportunities`)}
            className="text-xs font-bold text-[#666666] hover:text-[#171717] dark:text-zinc-400 dark:hover:text-white transition-colors underline underline-offset-4"
          >
            대안 비교 보기
          </button>
        </div>
      </div>
    </SoheeCard>
  );
}
