"use client";

import React, { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Zap, CheckCircle2 } from "lucide-react";
import { SoheeCard } from "@/components/v087/ui/SoheeCard";
import { SoheeButton } from "@/components/v087/ui/SoheeButton";
import { ProvenanceBadge } from "@/components/v087/common/ProvenanceBadge";
import { getOpportunitiesReadModel } from "@/lib/read-models/opportunity-read-model";
import { useWorkspaceId } from "@/hooks/use-workspace-context";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function OpportunityDetailPage({ params }: PageProps) {
  const workspaceId = useWorkspaceId();
  const router = useRouter();
  const { id } = use(params);

  const oppList = getOpportunitiesReadModel({
    workspaceId,
    isDemo: true,
  });

  const opp = oppList.items.find((i) => i.id === id) || oppList.items[0];

  if (!opp) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-sm font-bold text-[#8C8A87]">기회 정보를 찾을 수 없습니다.</p>
        <SoheeButton variant="outline" onClick={() => router.push("/app/opportunities")}>
          기회함으로 돌아가기
        </SoheeButton>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header & Back Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/app/opportunities")}
          className="p-2 rounded-xl text-[#8C8A87] hover:text-[#171717] hover:bg-[#F6F4F0] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#6D4AFF]">
            OPPORTUNITY DETAIL & ALTERNATIVES
          </span>
          <h2 className="text-lg sm:text-xl font-black text-[#171717] dark:text-white">
            {opp.title}
          </h2>
        </div>
      </div>

      {/* Main Signal Analysis Bento */}
      <SoheeCard variant="hero" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#6D4AFF] text-white text-xs font-black">
            <Zap className="w-3.5 h-3.5 fill-current" />
            종합 점수 {opp.score}점
          </span>
          <ProvenanceBadge provenance={opp.expectedImpact.provenance} />
        </div>

        <div className="space-y-2">
          <strong className="block text-sm font-black text-[#171717] dark:text-white">
            기회 포착 근거 및 원본 시그널
          </strong>
          <p className="text-xs sm:text-sm text-[#555555] dark:text-zinc-300 leading-relaxed font-medium">
            {opp.whyNow}
          </p>
        </div>

        {/* Signals List */}
        <div className="p-4 rounded-xl bg-white/90 dark:bg-[#141517]/90 border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] space-y-2">
          <span className="text-[11px] font-bold text-[#8C8A87] uppercase tracking-wider block">
            감지된 실측 신호 (Raw Signals)
          </span>
          <ul className="space-y-1.5 text-xs text-[#333333] dark:text-zinc-200 font-semibold">
            {opp.evidence.map((sig) => (
              <li key={sig.id} className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                <span>
                  <strong>[{sig.source}]</strong> {sig.label} — {sig.snippet} ({sig.observedAt})
                </span>
              </li>
            ))}
          </ul>
        </div>
      </SoheeCard>

      {/* Alternative Plans 3-Column Comparison */}
      <div className="space-y-3">
        <h3 className="text-sm font-black text-[#171717] dark:text-white">
          실행 가능한 대안 시나리오 비교
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {opp.alternatives.map((alt, idx) => (
            <SoheeCard
              key={alt.id}
              variant={idx === 0 ? "elevated" : "default"}
              className={`space-y-3 ${idx === 0 ? "border-[#6D4AFF]/50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-[#FAF9F7] text-[#666666] dark:bg-zinc-800 dark:text-zinc-300">
                  대안 {idx + 1}
                </span>
                {idx === 0 && (
                  <span className="text-[10px] font-extrabold text-[#6D4AFF] dark:text-[#8B6BFF]">
                    소희 1순위 추천
                  </span>
                )}
              </div>

              <strong className="block text-sm font-bold text-[#171717] dark:text-white">
                {alt.title}
              </strong>

              <p className="text-xs text-[#666666] dark:text-zinc-400 leading-relaxed">
                {alt.description}
              </p>

              <div className="space-y-1 text-xs text-[#666666] dark:text-zinc-400">
                <div className="flex justify-between">
                  <span>예상 결과:</span>
                  <strong className="text-[#10B981]">{alt.expectedOutcome}</strong>
                </div>
              </div>

              <div className="pt-2">
                <SoheeButton
                  size="sm"
                  variant={idx === 0 ? "primary" : "outline"}
                  onClick={() => router.push(`/app/missions/ms-001`)}
                  className="w-full"
                >
                  이 시나리오로 미션 수립
                </SoheeButton>
              </div>
            </SoheeCard>
          ))}
        </div>
      </div>
    </div>
  );
}
