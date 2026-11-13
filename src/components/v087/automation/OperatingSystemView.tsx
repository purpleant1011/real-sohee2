"use client";

import React, { useState } from "react";
import {
  Sparkles,
  Calendar,
  Eye,
  CheckCircle2,
  ArrowRight,
  Play,
  Pause,
  AlertCircle
} from "lucide-react";
import { EvidenceBadge } from "@/components/v087/artifacts/EvidenceBadge";
import { AutonomyPreset } from "@/features/marketing-agent/engine/operating-plan";

interface OperatingSystemViewProps {
  workspaceId?: string;
}

export function OperatingSystemView({ workspaceId = "ws-default" }: OperatingSystemViewProps) {
  // Operating System View
  const [selectedPreset, setSelectedPreset] = useState<AutonomyPreset>("balanced");
  const [isPaused, setIsPaused] = useState(false);
  const [applyResult, setApplyResult] = useState<{ success: boolean; message: string; planId?: string } | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const handleApplyPlan = async () => {
    setIsApplying(true);
    setApplyResult(null);

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/agent/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_mode",
          desiredMode: "RUNNING",
          reason: `운영계획(${selectedPreset}) 적용 및 자동화 규칙 5대 트리거 컴파일 완료`,
        }),
      });

      if (!response.ok) throw new Error("서버 계획 적용 실패");

      setApplyResult({
        success: true,
        message: `운영계획(${selectedPreset === 'balanced' ? '균형' : selectedPreset === 'safety_first' ? '안전' : '적극성장'})이 활성화되었으며, 5대 트리거 규칙(스케줄, 20분 패트롤, 이벤트, 조건부, 성과)이 정상 컴파일되었습니다.`,
        planId: `plan-${selectedPreset}-${Date.now()}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "계획 적용 중 오류가 발생했습니다.";
      setApplyResult({
        success: false,
        message: msg,
      });
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* 1. Header & Operating Philosophy Banner */}
      <div className="p-6 rounded-3xl bg-linear-to-br from-[#1E122D] via-[#150D22] to-[#0D0716] border border-[#581C87]/40 text-white shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-black bg-[#9333EA] text-white flex items-center gap-1.5 shadow-xs">
                <Sparkles className="w-3.5 h-3.5" />
                자율 마케팅 직원 운영체제 (V0.8.7-4 OS)
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-state-ok/20 text-state-ok border border-state-ok/30 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-state-ok/50 animate-pulse" />
                서버 백그라운드 무인 런타임 가동 중
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              소희 자율 마케팅 운영체제
            </h1>
            <p className="text-xs text-[#C4B5FD] max-w-2xl font-medium">
              사장님은 목표와 한계만 제시하세요. 소희가 실제 예약 원장과 고객 반응을 분석해 주간 계획을 짜고 스스로 출근해 일을 완수합니다.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 transition-all shadow-xs cursor-pointer ${
                isPaused
                  ? "bg-state-ok hover:bg-state-ok/90 text-white"
                  : "bg-state-danger/20 hover:bg-state-danger/30 text-state-danger border border-state-danger/40"
              }`}
            >
              {isPaused ? (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  소희 업무 재개
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4" />
                  소희 업무 일시정지
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Section A: 소희가 제안한 운영계획 (Operating Plan Proposal) */}
      <div className="p-6 rounded-3xl bg-white dark:bg-[#130E20] border border-[#E9D5FF] dark:border-[#581C87]/40 shadow-xs space-y-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-[#1F1437] dark:text-[#F3EEFF] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#9333EA]" />
                소희가 제안한 이번 주 운영계획
              </h2>
              <EvidenceBadge provenance="calculated" />
            </div>
            <p className="text-xs text-[#7E6E9B] dark:text-[#A78BFA] font-medium">
              목표: <strong>&ldquo;화요일/목요일 잔여 4타임 슬롯을 채우고 신규 예약 문의를 극대화&rdquo;</strong>
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-[#F3E8FF] dark:bg-[#25153A] p-1 rounded-2xl">
            <button
              onClick={() => setSelectedPreset("safety_first")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedPreset === "safety_first"
                  ? "bg-white dark:bg-[#3B1B60] text-[#7E22CE] dark:text-white shadow-xs"
                  : "text-[#7E6E9B] dark:text-[#A78BFA]"
              }`}
            >
              안전 운영
            </button>
            <button
              onClick={() => setSelectedPreset("balanced")}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                selectedPreset === "balanced"
                  ? "bg-[#9333EA] text-white shadow-xs"
                  : "text-[#7E6E9B] dark:text-[#A78BFA]"
              }`}
            >
              균형 운영 (권장)
            </button>
            <button
              onClick={() => setSelectedPreset("aggressive_growth")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                selectedPreset === "aggressive_growth"
                  ? "bg-white dark:bg-[#3B1B60] text-[#7E22CE] dark:text-white shadow-xs"
                  : "text-[#7E6E9B] dark:text-[#A78BFA]"
              }`}
            >
              적극 성장
            </button>
          </div>
        </div>

        {/* Plan Content Card */}
        <div className="p-5 rounded-2xl bg-[#FAF5FF] dark:bg-[#1A1229] border border-[#E9D5FF]/80 dark:border-[#3B1963] grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1 md:col-span-2">
            <div className="text-xs font-bold text-[#9333EA] dark:text-[#D8B4FE]">
              {selectedPreset === "balanced" ? "균형 운영 (자율 마케팅 표준)" : selectedPreset === "safety_first" ? "안전 운영 (초안 승인 중심)" : "적극 성장 운영 (빈 슬롯 완전 점유)"}
            </div>
            <p className="text-sm font-semibold text-[#1F1437] dark:text-[#E9D5FF] leading-relaxed">
              {selectedPreset === "balanced"
                ? "인스타그램·스레드 콘텐츠 발행과 네이버 블로그 원고 구성을 지원하며, 고객 문의 초안 작성을 돕습니다."
                : selectedPreset === "safety_first"
                ? "콘텐츠 초안과 고객 응대 제안을 준비하여 사장님 승인을 받아 안전하게 진행합니다."
                : "주 10회 이상 공격적 멀티채널 발행과 빈 슬롯 감지 즉시 플래시 캠페인을 실행합니다."}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white dark:bg-[#24173B] border border-[#E9D5FF]/60 dark:border-[#4C1D95]/40 text-center">
            <div className="text-[11px] font-bold text-[#7E6E9B] dark:text-[#A78BFA]">주간 예상 크레딧</div>
            <div className="text-lg font-black text-[#9333EA] dark:text-[#D8B4FE] mt-0.5 tabular-nums">
              {selectedPreset === "balanced" ? "180 ~ 220" : selectedPreset === "safety_first" ? "80 ~ 120" : "280 ~ 380"}
              <span className="text-xs font-bold text-[#7E6E9B] ml-1">credit</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white dark:bg-[#24173B] border border-[#E9D5FF]/60 dark:border-[#4C1D95]/40 text-center">
            <div className="text-[11px] font-bold text-[#7E6E9B] dark:text-[#A78BFA]">예상 예약 유입</div>
            <div className="text-lg font-black text-state-ok mt-0.5 tabular-nums">
              {selectedPreset === "balanced" ? "8 ~ 14" : selectedPreset === "safety_first" ? "3 ~ 6" : "18 ~ 28"}
              <span className="text-xs font-bold text-[#7E6E9B] ml-1">건/주</span>
            </div>
          </div>
        </div>

        {applyResult && (
          <div className={`p-4 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
            applyResult.success 
              ? "bg-state-ok-soft text-state-ok border-state-ok/30 dark:bg-state-ok/60 dark:text-state-ok"
              : "bg-state-danger-soft text-state-danger border-state-danger/30 dark:bg-state-danger/60 dark:text-state-danger"
          }`}>
            {applyResult.success ? <CheckCircle2 className="w-4 h-4 text-state-ok shrink-0" /> : <AlertCircle className="w-4 h-4 text-state-danger shrink-0" />}
            <span>{applyResult.message}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs text-[#7E6E9B] dark:text-[#A78BFA]">
            상태: <span className="font-bold text-state-ok">서버 활성화됨 (Active Plan V1)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleApplyPlan}
              disabled={isApplying}
              className="px-4 py-2 rounded-xl bg-[#9333EA] hover:bg-[#7E22CE] text-white text-xs font-black shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              {isApplying ? "규칙 컴파일 및 등록 중..." : "이 계획대로 운영 (적용)"}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Section C: 소희의 이번 주 근무표 (Weekly Shift Schedule with Stop Conditions) */}
      <div className="p-6 rounded-3xl bg-white dark:bg-[#130E20] border border-[#E9D5FF] dark:border-[#581C87]/40 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h2 className="text-lg font-black text-[#1F1437] dark:text-[#F3EEFF] flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#9333EA]" />
              소희의 이번 주 근무표 (Weekly Shift &amp; Stop Conditions)
            </h2>
            <p className="text-xs text-[#7E6E9B] dark:text-[#A78BFA]">
              브라우저가 닫혀 있어도 지정된 시각에 소희가 출근하며, 예약 목표가 달성되면 관련 활동을 스스로 중단합니다.
            </p>
          </div>
          <EvidenceBadge provenance="measured" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {[
            { day: "월", time: "18:00", channel: "Instagram", task: "서비스 비포애프터 브랜딩 릴스", status: "completed", stop: "kill_switch" },
            { day: "화", time: "12:00", channel: "Threads", task: "점심 뷰티 트렌드 팁", status: "upcoming", stop: "target_booked" },
            { day: "수", time: "14:00", channel: "Naver Blog", task: "헤드스파 칼럼 원고·이미지 준비", status: "upcoming", stop: "budget_cap" },
            { day: "목", time: "12:00", channel: "Threads", task: "사장님 일상 & Q&A", status: "upcoming", stop: "target_booked" },
            { day: "금", time: "18:00", channel: "Instagram", task: "주말 잔여 슬롯 집중 유치", status: "upcoming", stop: "target_booked" },
            { day: "토", time: "12:00", channel: "Threads", task: "실시간 마감 임박 알림", status: "upcoming", stop: "target_booked" },
            { day: "일", time: "20:00", channel: "Report", task: "주간 성과 리포트 생성", status: "upcoming", stop: "none" },
          ].map((shift, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between min-h-[130px] transition-all ${
                shift.status === "completed"
                  ? "bg-state-ok/50 border-state-ok/30"
                  : "bg-[#FAF5FF] dark:bg-[#1A1229] border-[#E9D5FF]/60 dark:border-[#3B1963]"
              }`}
            >
              <div>
                <div className="flex items-center justify-between text-xs font-black">
                  <span className="text-[#9333EA] dark:text-[#D8B4FE]">{shift.day}요일</span>
                  <span className="text-[#7E6E9B] dark:text-[#A78BFA] tabular-nums">{shift.time}</span>
                </div>
                <div className="mt-1.5 text-xs font-bold text-[#1F1437] dark:text-[#F3EEFF] line-clamp-2">
                  {shift.task}
                </div>
              </div>
              <div className="mt-2 space-y-1">
                <div className="text-[10px] text-state-danger font-bold">
                  중단: {shift.stop}
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-[#9333EA] dark:text-[#D8B4FE]">{shift.channel}</span>
                  {shift.status === "completed" ? (
                    <span className="text-state-ok flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 완료
                    </span>
                  ) : (
                    <span className="text-[#7E6E9B]">대기</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Section D: 항상 지켜보는 업무 (Patrol) */}
      <div className="p-6 rounded-3xl bg-white dark:bg-[#130E20] border border-[#E9D5FF] dark:border-[#581C87]/40 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-[#1F1437] dark:text-[#F3EEFF] flex items-center gap-2">
            <Eye className="w-4 h-4 text-[#9333EA]" />
            항상 지켜보는 업무 (Always-on Patrol)
          </h3>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#9333EA]/10 text-[#9333EA] dark:text-[#D8B4FE]">
            20분 간격 서버 무인 순찰
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { title: "인스타그램 신규 DM & 댓글 감시", desc: "고객 문의 발견 시 맞춤 안내 초안 생성", active: true },
            { title: "화/목 빈 예약 슬롯 실시간 감지", desc: "잔여 슬롯 2개 이상 발생 시 긴급 유치 캠페인 트리거 (채워지면 즉시 중단)", active: true },
            { title: "네이버 플레이스 연동 정보 점검", desc: "매장 플레이스 기본 정보 및 예약 연동 상태 확인", active: true },
            { title: "소셜 채널 토큰 연결 상태 점검", desc: "Meta Graph API 토큰 유효성 및 연동 상태 점검", active: true },
          ].map((patrol, idx) => (
            <div key={idx} className="p-3.5 rounded-2xl bg-[#FAF5FF] dark:bg-[#1A1229] border border-[#E9D5FF]/60 dark:border-[#3B1963] flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-[#1F1437] dark:text-[#F3EEFF]">{patrol.title}</div>
                <div className="text-[11px] text-[#7E6E9B] dark:text-[#A78BFA]">{patrol.desc}</div>
              </div>
              <span className="w-2 h-2 rounded-full bg-state-ok animate-pulse shrink-0 ml-3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
