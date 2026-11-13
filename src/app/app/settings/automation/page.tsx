"use client";

import React, { useState } from "react";
import { ShieldCheck, AlertOctagon, Sliders, CheckCircle2, Lock } from "lucide-react";
import { SoheeCard } from "@/components/v087/ui/SoheeCard";
import { SoheeButton } from "@/components/v087/ui/SoheeButton";

export default function AutomationSettingsPage() {
  const [approvalPolicy, setApprovalPolicy] = useState<"always" | "medium_high" | "autonomous">("medium_high");
  const [dailyMessageLimit, setDailyMessageLimit] = useState<number>(50);
  const [monthlyBudgetLimit, setMonthlyBudgetLimit] = useState<number>(100000);
  const [isKillSwitchActive, setIsKillSwitchActive] = useState<boolean>(false);
  const [savedToast, setSavedToast] = useState<boolean>(false);

  const handleSave = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  const toggleKillSwitch = () => {
    setIsKillSwitchActive(!isKillSwitchActive);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white dark:bg-[#141517] border border-[#EAE7E3] dark:border-[rgba(255,255,255,0.08)] shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[#6D4AFF] text-white shadow-xs">
            <ShieldCheck className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base sm:text-lg font-black text-[#171717] dark:text-white">
              소희 자동 업무 및 안전 기준 설정
            </h2>
            <p className="text-xs text-[#666666] dark:text-zinc-400">
              소희가 자율적으로 실행할 수 있는 범위와 사장님의 사전 승인이 필요한 안전 기준을 설정합니다.
            </p>
          </div>
        </div>

        <SoheeButton size="sm" variant="primary" onClick={handleSave}>
          설정 저장하기
        </SoheeButton>
      </div>

      {savedToast && (
        <div className="p-3.5 rounded-2xl bg-state-ok-soft text-state-ok border border-state-ok/30 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-state-ok" />
          안전 설정이 성공적으로 저장되었습니다.
        </div>
      )}

      {/* 1. Emergency Kill Switch */}
      <SoheeCard
        variant="elevated"
        className={`space-y-3.5 border-l-4 transition-all ${
          isKillSwitchActive
            ? "border-l-state-danger bg-state-danger-soft/40"
            : "border-l-zinc-300 dark:border-l-zinc-700"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertOctagon className={`w-5 h-5 ${isKillSwitchActive ? "text-state-danger" : "text-zinc-500"}`} />
            <div>
              <h3 className="text-sm font-black text-[#171717] dark:text-white">
                소희 자동 업무 즉시 멈춤
              </h3>
              <p className="text-xs text-[#666666] dark:text-zinc-400">
                켜 두면 소희의 모든 외부 게시, 메시지 발송, 예약 처리가 즉시 전면 멈춥니다.
              </p>
            </div>
          </div>

          <button
            onClick={toggleKillSwitch}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
              isKillSwitchActive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md animate-pulse"
                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300"
            }`}
          >
            {isKillSwitchActive ? "자동 작업이 멈춰 있어요" : "자동 작업 켜져 있어요"}
          </button>
        </div>
      </SoheeCard>

      {/* 2. Approval Policy Mode */}
      <SoheeCard variant="elevated" className="space-y-4">
        <h3 className="text-sm font-black text-[#171717] dark:text-white flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#6D4AFF]" />
          자동화 승인 모드 (위임 수준)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div
            onClick={() => setApprovalPolicy("always")}
            className={`p-4 rounded-2xl border cursor-pointer transition-all space-y-1.5 ${
              approvalPolicy === "always"
                ? "bg-[#F1EDFF] dark:bg-[#231C44]/50 border-[#6D4AFF] text-[#171717] dark:text-white ring-1 ring-[#6D4AFF]"
                : "bg-white dark:bg-zinc-900 border-[#EAE7E3] dark:border-zinc-800 opacity-70 hover:opacity-100"
            }`}
          >
            <strong className="block text-xs font-black">모든 작업 사전 승인</strong>
            <p className="text-[11px] text-[#666666] dark:text-zinc-400">
              SNS 게시 및 고객 메시지 발송 전 사장님의 확인을 100% 거칩니다.
            </p>
          </div>

          <div
            onClick={() => setApprovalPolicy("medium_high")}
            className={`p-4 rounded-2xl border cursor-pointer transition-all space-y-1.5 ${
              approvalPolicy === "medium_high"
                ? "bg-[#F1EDFF] dark:bg-[#231C44]/50 border-[#6D4AFF] text-[#171717] dark:text-white ring-1 ring-[#6D4AFF]"
                : "bg-white dark:bg-zinc-900 border-[#EAE7E3] dark:border-zinc-800 opacity-70 hover:opacity-100"
            }`}
          >
            <div className="flex items-center justify-between">
              <strong className="block text-xs font-black">중요 작업만 승인 (추천)</strong>
              <span className="px-1.5 py-0.2 rounded-md bg-[#6D4AFF] text-white text-[9px] font-black">추천</span>
            </div>
            <p className="text-[11px] text-[#666666] dark:text-zinc-400">
              단순 리뷰 감사는 자동 처리하고, 게시물/대량 메시지는 사전 확인합니다.
            </p>
          </div>

          <div
            onClick={() => setApprovalPolicy("autonomous")}
            className={`p-4 rounded-2xl border cursor-pointer transition-all space-y-1.5 ${
              approvalPolicy === "autonomous"
                ? "bg-[#F1EDFF] dark:bg-[#231C44]/50 border-[#6D4AFF] text-[#171717] dark:text-white ring-1 ring-[#6D4AFF]"
                : "bg-white dark:bg-zinc-900 border-[#EAE7E3] dark:border-zinc-800 opacity-70 hover:opacity-100"
            }`}
          >
            <strong className="block text-xs font-black">자율 운영 모드</strong>
            <p className="text-[11px] text-[#666666] dark:text-zinc-400">
              소희가 안전 한도 내에서 최적의 타이밍에 직접 게시하고 응대합니다.
            </p>
          </div>
        </div>
      </SoheeCard>

      {/* 3. Safety Limits */}
      <SoheeCard variant="elevated" className="space-y-4">
        <h3 className="text-sm font-black text-[#171717] dark:text-white flex items-center gap-2">
          <Lock className="w-4 h-4 text-[#6D4AFF]" />
          일일 발송 및 예산 한도
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-[#FAF9F7] dark:bg-zinc-900 border border-[#EAE7E3] dark:border-zinc-800 space-y-2">
            <span className="block text-xs font-bold text-[#666666] dark:text-zinc-400">
              일일 최대 고객 메시지 발송 건수
            </span>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={dailyMessageLimit}
                onChange={(e) => setDailyMessageLimit(Number(e.target.value))}
                className="w-24 px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black"
              />
              <span className="text-xs text-zinc-500">건 / 일</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#FAF9F7] dark:bg-zinc-900 border border-[#EAE7E3] dark:border-zinc-800 space-y-2">
            <span className="block text-xs font-bold text-[#666666] dark:text-zinc-400">
              월간 AI 이미지 및 메시지 예산 상한
            </span>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={monthlyBudgetLimit}
                onChange={(e) => setMonthlyBudgetLimit(Number(e.target.value))}
                step={10000}
                className="w-32 px-3 py-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-black"
              />
              <span className="text-xs text-zinc-500">원 / 월</span>
            </div>
          </div>
        </div>
      </SoheeCard>
    </div>
  );
}
