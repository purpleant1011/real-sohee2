"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ArrowRight, Clock, Check } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import { SoheeButton } from "../ui/SoheeButton";
import { RiskTierBadge } from "../common/RiskTierBadge";
import type { TodayPendingApprovalReadModel } from "@/lib/read-models/today-read-model";

interface PendingApprovalSurfaceProps {
  approvals: TodayPendingApprovalReadModel[];
}

export function PendingApprovalSurface({ approvals }: PendingApprovalSurfaceProps) {
  const router = useRouter();
  const [approvedIds, setApprovedIds] = useState<string[]>([]);

  const handleApprove = (id: string) => {
    setApprovedIds((prev) => [...prev, id]);
  };

  const pendingList = approvals.filter((app) => !approvedIds.includes(app.id));

  return (
    <SoheeCard variant="default" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-[#FEF7EC] text-[#F59E0B] dark:bg-[#78350F]/40 dark:text-[#FDE68A]">
            <CheckSquare className="w-3.5 h-3.5" />
          </span>
          <div>
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#8C8A87]">
              승인 대기
            </span>
            <h3 className="text-sm font-black text-[#171717] dark:text-white flex items-center gap-1.5">
              <span>사장님이 확인할 것</span>
              <span className="px-1.5 py-0.2 text-[10px] font-black rounded-full bg-[#6D4AFF] text-white">
                {pendingList.length}건
              </span>
            </h3>
          </div>
        </div>
        <button
          onClick={() => router.push(`/app/approvals`)}
          className="text-xs font-bold text-[#6D4AFF] hover:text-[#5A35EB] dark:text-[#8B6BFF] flex items-center gap-1"
        >
          <span>전체 보기</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Approval Document Cards */}
      {pendingList.length === 0 ? (
        <div className="py-8 text-center text-xs font-semibold text-[#8C8A87]">
          모든 결재 항목이 승인되었습니다. 소희가 안전하게 게시 및 발송을 진행합니다.
        </div>
      ) : (
        <div className="space-y-3">
          {pendingList.map((item) => (
            <div
              key={item.id}
              className="p-3.5 rounded-xl bg-[#FAF9F7] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] space-y-2.5 hover:border-[#6D4AFF]/30 transition-all"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <RiskTierBadge tier={item.riskTier} />
                  <strong className="text-xs font-bold text-[#171717] dark:text-zinc-100 truncate">
                    {item.title}
                  </strong>
                </div>
                <span className="text-[10px] font-bold text-[#8C8A87] shrink-0 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {item.deadline}
                </span>
              </div>

              {/* Message / Content Preview Quote */}
              <div className="p-2.5 rounded-lg bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.04)] text-xs text-[#555555] dark:text-zinc-300 italic">
                &ldquo;{item.previewContent}&rdquo;
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] font-bold text-[#10B981]">
                  채널: {item.channel}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => router.push(`/app/approvals`)}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold text-[#666666] hover:bg-[#EAE7E3] dark:hover:bg-zinc-800 transition-colors"
                  >
                    수정 요청
                  </button>
                  <SoheeButton
                    size="sm"
                    variant="primary"
                    icon={<Check className="w-3.5 h-3.5" />}
                    onClick={() => handleApprove(item.id)}
                  >
                    즉시 승인
                  </SoheeButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SoheeCard>
  );
}
