"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { FloatingTabs } from "@/components/v087/ui/FloatingTabs";
import { OpportunityCard } from "@/components/v087/artifacts/OpportunityCard";
import { getOpportunitiesReadModel } from "@/lib/read-models/opportunity-read-model";
import { useWorkspaceId } from "@/hooks/use-workspace-context";
import type { TodayOpportunityReadModel } from "@/lib/read-models/today-read-model";

export default function OpportunitiesPage() {
  const workspaceId = useWorkspaceId();
  const router = useRouter();
  const [selectedFilter, setSelectedFilter] = useState<string>("all");

  const oppData = getOpportunitiesReadModel({
    workspaceId,
    filter: selectedFilter,
  });

  const categoryTabs = [
    { id: "all", label: "전체 기회", count: oppData.counts.all },
    { id: "empty_slot", label: "빈 슬롯 채우기", count: oppData.counts.empty_slot },
    { id: "review", label: "리뷰 감사/반응", count: oppData.counts.review },
    { id: "content", label: "콘텐츠 발행", count: oppData.counts.content },
  ];

  const handlePlanMission = (id: string) => {
    router.push(`/app/missions?fromOpp=${id}`);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner & Stats Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-br from-[#6D4AFF] to-[#8B6BFF] text-white shadow-[0_2px_8px_rgba(109,74,255,0.3)]">
            <Sparkles className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base sm:text-lg font-black text-[#171717] dark:text-white tracking-tight">
              기회함 (소희가 발견한 것)
            </h2>
            <p className="text-xs text-[#666666] dark:text-zinc-400">
              예약 캘린더, 고객 문의, 리뷰 신호에서 포착한 매출 기회 목록입니다. 확인된 근거가 있는 항목만 보여드려요.
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <FloatingTabs
          tabs={categoryTabs}
          activeId={selectedFilter}
          onChange={setSelectedFilter}
          layoutId="opp-category-tabs"
        />
      </div>

      {/* Opportunity List Cards */}
      <div className="space-y-4">
        {oppData.items.length === 0 && (
          <p className="rounded-2xl border border-[#EAE7E3] bg-white p-5 text-sm text-[#666666] dark:border-[rgba(255,255,255,0.08)] dark:bg-[#141517] dark:text-zinc-400">
            {oppData.insufficientSampleWarning ?? "아직 측정된 기회가 없어요."}
          </p>
        )}
        {oppData.items.map((opp) => {
          const mappedOpp: TodayOpportunityReadModel = {
            id: opp.id,
            title: opp.title,
            type: "empty_slot",
            urgency: opp.urgency === "high" ? "high" : opp.urgency === "medium" ? "medium" : "low",
            score: opp.score,
            whyNow: opp.whyNow,
            expectedImpact: {
              value: opp.expectedImpact.value,
              provenance: opp.expectedImpact.provenance,
              sourceDescription: opp.expectedImpact.sourceDescription || "기회 분석 모델",
            },
            confidence: opp.confidence,
            source: opp.evidence[0]?.source ?? "출처 확인 전",
            expiresAt: opp.expiresAt,
          };

          return (
            <OpportunityCard
              key={opp.id}
              opportunity={mappedOpp}
              onPlanMission={handlePlanMission}
            />
          );
        })}
      </div>
    </div>
  );
}
