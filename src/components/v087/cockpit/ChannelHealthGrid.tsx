"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Radio, ArrowRight } from "lucide-react";
import { SoheeCard } from "../ui/SoheeCard";
import type { ChannelHealth } from "@/lib/read-models/types";

interface ChannelHealthGridProps {
  channels: ChannelHealth[];
}

export function ChannelHealthGrid({ channels }: ChannelHealthGridProps) {
  const router = useRouter();

  return (
    <SoheeCard variant="default" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-[#F1EDFF] text-[#6D4AFF] dark:bg-[#231C44] dark:text-[#C3B4FF]">
            <Radio className="w-3.5 h-3.5" />
          </span>
          <div>
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#8C8A87]">
              CHANNELS
            </span>
            <h3 className="text-sm font-black text-[#171717] dark:text-white">
              7대 마케팅 채널 연결 상태
            </h3>
          </div>
        </div>
        <button
          onClick={() => router.push(`/app/channels`)}
          className="text-xs font-bold text-[#6D4AFF] hover:text-[#5A35EB] dark:text-[#8B6BFF] flex items-center gap-1"
        >
          <span>채널 관리</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Channels Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {channels.map((ch) => {
          const isHealthy = ch.status === "connected";
          const isWarning = ch.status === "needs_reauth" || ch.status === "warning";

          return (
            <div
              key={ch.channelKey}
              className="p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#1C1E22] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.06)] flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isHealthy
                      ? "bg-[#10B981] shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                      : isWarning
                      ? "bg-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                      : "bg-[#EF4444]"
                  }`}
                />
                <div className="min-w-0">
                  <strong className="block text-xs font-bold text-[#171717] dark:text-zinc-100 truncate">
                    {ch.displayName}
                  </strong>
                  <span className="block text-[10px] text-[#8C8A87] truncate">
                    {ch.lastSyncedAt}
                  </span>
                </div>
              </div>

              {isWarning ? (
                <button
                  onClick={() => router.push(`/app/channels`)}
                  className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#FEF7EC] text-[#96600E] hover:bg-[#FDE68A] transition-colors shrink-0"
                >
                  재인증
                </button>
              ) : (
                <span className="text-[10px] font-bold text-[#10B981] shrink-0">
                  정상
                </span>
              )}
            </div>
          );
        })}
      </div>
    </SoheeCard>
  );
}
