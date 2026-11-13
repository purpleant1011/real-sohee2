"use client";

import { Sparkles, Calendar, ArrowRight, Flame, Trophy, AlertCircle } from "lucide-react";
import Link from "next/link";

interface FirstWowPreviewProps {
  storeName?: string;
  category?: string;
  targetGoal?: string;
  availableCredits?: number;
}

export function FirstWowPreviewCard({
  storeName,
  category,
  targetGoal = "신규 단골 유치 및 예약 증대",
  availableCredits = 40000
}: FirstWowPreviewProps) {
  const isProfileConfigured = Boolean(storeName && storeName !== '신규 매장' && storeName !== '매장명 설정 대기');

  return (
    <div className="p-6 rounded-3xl bg-gradient-to-br from-state-wait/40 via-primary/20 to-zinc-900/60 border border-state-wait/30 shadow-2xl backdrop-blur-xl space-y-5">
      {/* 배너 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-black text-state-wait">
          <Sparkles className="w-4 h-4" />
          <span>소희 AI의 맞춤 마케팅 제안 (First WOW)</span>
        </div>
        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-state-wait/20 text-state-wait border border-state-wait/30">
          14일 Trial 전용
        </span>
      </div>

      {/* 맞춤 분석 요약 */}
      <div className="space-y-1">
        <h3 className="text-lg font-black text-white tracking-tight">
          {isProfileConfigured
            ? `"${storeName}" 맞춤 7일 자율 마케팅 캠페인 계획`
            : "매장 비즈니스 정보 기반 첫 마케팅 계획 수립"}
        </h3>
        <p className="text-xs text-zinc-400">
          {isProfileConfigured
            ? `업종(${category || '일반'}) 상권과 ${targetGoal} 목표에 맞춰 콘텐츠 발행 일정을 제안합니다.`
            : "매장 프로필을 완성하시면 소희가 상권과 타겟 고객을 분석하여 맞춤 콘텐츠를 자동 기획합니다."}
        </p>
      </div>

      {/* 프리뷰 카드 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
            <Flame className="w-3.5 h-3.5" />
            <span>인스타그램 캐러셀 기획</span>
          </div>
          <p className="text-[11px] text-zinc-300 line-clamp-2">
            {isProfileConfigured
              ? `"${storeName}만의 차별화된 시그니처 경험과 공간 분위기 소개 📸"`
              : "매장 대표 메뉴와 혜택을 돋보이게 하는 카드뉴스 기획안"}
          </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-state-ok">
            <Calendar className="w-3.5 h-3.5" />
            <span>네이버 블로그 검색 최적화</span>
          </div>
          <p className="text-[11px] text-zinc-300 line-clamp-2">
            {isProfileConfigured
              ? `"${storeName} 지역 검색 상위 노출을 위한 상세 탐방 및 예약 안내"`
              : "지역 키워드 기반 상세 리뷰형 포스팅 기획안"}
          </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-zinc-950/60 border border-zinc-800 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-state-warn">
            <Trophy className="w-3.5 h-3.5" />
            <span>당근 지역 단골 소식</span>
          </div>
          <p className="text-[11px] text-zinc-300 line-clamp-2">
            {isProfileConfigured
              ? `"${storeName} 첫 방문 동네 주민 대상 웰컴 혜택 소식"`
              : "동네 상권 타겟 혜택 쿠폰 소식 기획안"}
          </p>
        </div>
      </div>

      {/* 하단 액션 버튼 */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
        <span className="text-xs text-zinc-400">
          가용 크레딧: <strong className="text-white font-mono">{availableCredits.toLocaleString()} P</strong>
        </span>
        <Link
          href={isProfileConfigured ? "/app/conversations" : "/app/settings/business"}
          className="px-4 py-2 rounded-xl bg-state-wait hover:bg-state-wait/90 text-state-wait-soft font-bold text-xs shadow-md transition flex items-center gap-1.5"
        >
          <span>{isProfileConfigured ? "소희와 캠페인 실행하기" : "매장 프로필 설정하기"}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
