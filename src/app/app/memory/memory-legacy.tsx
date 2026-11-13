"use client";

import React, { useState } from "react";
import { BrainCircuit, Trash2, CheckCircle2, Sparkles, Plus } from "lucide-react";
import { SoheeCard } from "@/components/v087/ui/SoheeCard";
import { SoheeButton } from "@/components/v087/ui/SoheeButton";
import { FloatingTabs } from "@/components/v087/ui/FloatingTabs";
import { getMarketingMemoryReadModel } from "@/lib/read-models/memory-read-model";
import { useWorkspaceId } from "@/hooks/use-workspace-context";

export default function MemoryLegacy() {
  const workspaceId = useWorkspaceId();
  const [filterType, setFilterType] = useState<string>("all");
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  const memoryData = getMarketingMemoryReadModel({
    workspaceId,
  });

  const activeItems = memoryData.items
    .filter((m) => !deletedIds.includes(m.id))
    .filter((m) => (filterType === "all" ? true : m.type === filterType));

  const tabs = [
    { id: "all", label: "전체 기억", count: memoryData.items.length },
    { id: "fact", label: "확인된 매장 정보", count: memoryData.items.filter((m) => m.type === "fact").length },
    { id: "inference", label: "대화로 파악한 특징", count: memoryData.items.filter((m) => m.type === "inference").length },
  ];

  const handleDelete = (id: string) => {
    setDeletedIds((prev) => [...prev, id]);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[#6D4AFF] text-white shadow-xs">
            <BrainCircuit className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base sm:text-lg font-black text-[#171717] dark:text-white">
              우리 매장 기억 (브랜드 메모리)
            </h2>
            <p className="text-xs text-[#666666] dark:text-zinc-400">
              메뉴 및 가격표, 사장님의 매장 철학과 마케팅 반응을 소희가 기억하고 콘텐츠에 자동 반영합니다.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <FloatingTabs
            tabs={tabs}
            activeId={filterType}
            onChange={setFilterType}
            layoutId="memory-filter-tabs"
          />
          <SoheeButton
            size="sm"
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => {}}
          >
            새 기억 등록
          </SoheeButton>
        </div>
      </div>

      {/* Memory Items Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {activeItems.map((item) => {
          const isFact = item.type === "fact";

          return (
            <SoheeCard
              key={item.id}
              variant="default"
              className="space-y-3.5 hover:border-[#6D4AFF]/40 transition-all flex flex-col justify-between"
            >
              <div className="space-y-2.5">
                {/* Badge Header */}
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                      isFact
                        ? "bg-state-ok-soft text-state-ok border border-state-ok/30"
                        : "bg-[#F1EDFF] text-[#5333E0] dark:bg-[#231C44] dark:text-[#C3B4FF] border border-[#DDD6FE]"
                    }`}
                  >
                    {isFact ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        확인된 정보
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" />
                        학습된 특징
                      </>
                    )}
                  </span>

                  <span className="text-[10px] font-bold text-[#8C8A87]">
                    신뢰도 {Math.round(item.confidence * 100)}%
                  </span>
                </div>

                <strong className="block text-sm font-bold text-[#171717] dark:text-white leading-snug">
                  {item.title}
                </strong>

                <p className="text-xs text-[#555555] dark:text-zinc-300 font-medium leading-relaxed">
                  {item.content}
                </p>
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-[#EAE7E3] dark:border-zinc-800 flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#8C8A87]">
                  출처: {item.source}
                </span>

                <button
                  onClick={() => handleDelete(item.id)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-state-danger hover:bg-state-danger-soft transition-all"
                  title="기억 삭제"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </SoheeCard>
          );
        })}
      </div>
    </div>
  );
}
