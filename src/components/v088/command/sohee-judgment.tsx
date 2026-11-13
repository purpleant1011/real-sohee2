'use client'

import React, { useState } from 'react'
import { 
  Sparkles, 
  ArrowRight, 
  Target, 
  Compass, 
  CheckSquare, 
  TrendingUp, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ShieldCheck
} from 'lucide-react'
import Link from 'next/link'

export interface BriefingSection {
  id: string
  title: string
  icon: React.ElementType
  badge?: string
  content: string
  evidence?: string
  actionLink?: { text: string; href: string }
}

export function SoheeJudgment({
  dateStr = '2026년 8월 31일 월요일'
}: {
  dateStr?: string
}) {
  const [isExpanded, setIsExpanded] = useState(true)

  const briefingFlow: BriefingSection[] = [
    {
      id: 'target',
      title: '1. 이번 주 매출 목표',
      icon: Target,
      badge: '주간 목표 54만원',
      content: '화·수·목 오후 2~5시 유휴 예약 슬롯 6개 소진 및 신규 고객 4명 확보를 최우선 목표로 가동 중입니다.',
      evidence: '네이버 예약 실시간 연동 슬롯 잔여 6개 측정'
    },
    {
      id: 'situation',
      title: '2. 현재 매장 상황',
      icon: Compass,
      badge: '유휴 슬롯 집중',
      content: '주말 예약은 100% 마감되었으나, 주중 오후 시간대 예약률이 35%로 저조하여 맞춤 오퍼가 시급합니다.',
      evidence: '최근 2주간 요일별 예약 추이 데이터'
    },
    {
      id: 'judgment',
      title: '3. 소희의 마케팅 판단',
      icon: Sparkles,
      badge: '첫 방문 15% 할인 제안',
      content: '주변 상권 봄 축제 키워드와 연계한 [대표 메뉴/서비스 소개] 콘텐츠를 오늘 발행하고, 15% 첫 방문 쿠폰을 노출하면 48시간 내 슬롯 4개 이상 마감이 가능합니다.',
      evidence: '인근 경쟁사 트래픽 및 과거 유사 캠페인 전환율 42%'
    },
    {
      id: 'decision_needed',
      title: '4. 사장님 결정 필요',
      icon: CheckSquare,
      badge: '2건 대기 중',
      content: '네이버 블로그 원고 검토 및 첫 방문 15% 혜택 안내 정책 승인이 필요합니다.',
      actionLink: { text: '의사결정 큐 확인하기', href: '#decision-queue' }
    },
    {
      id: 'results',
      title: '5. 직전 24시간 실행 결과',
      icon: TrendingUp,
      badge: '신규 문의 3건',
      content: '어제 발행된 인스타그램 릴스 1편에서 1,420회 조회수와 3건의 1:1 상담 예약 문의가 발생했습니다.',
      evidence: 'Meta Graph API 실시간 조회'
    },
    {
      id: 'anomaly',
      title: '6. 이상 징후 감지',
      icon: ShieldCheck,
      badge: '정상 가동 중',
      content: 'SNS 콘텐츠 이상 징후 없음, 채널 연동 상태 및 안전성 가드레일 정상입니다.',
      evidence: '안전성 가드레일 전수 통과'
    }
  ]

  return (
    <div className="p-5 md:p-6 rounded-2xl bg-white dark:bg-[#121215] border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span>사장님 아침 업무 브리핑</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-foreground dark:text-primary font-semibold">
                6단계 정밀 진단
              </span>
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              소희가 분석한 매장 현황, 판단 근거, 즉시 결정할 사항을 보고합니다.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <span>{isExpanded ? '간략히' : '전체보기'}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
          {briefingFlow.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.id}
                className="p-3.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-900/40 border border-zinc-200/60 dark:border-zinc-800/60 flex flex-col justify-between space-y-2.5"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      {item.title}
                    </span>
                    {item.badge && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 shadow-2xs">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {item.content}
                  </p>
                </div>

                <div className="pt-2 border-t border-zinc-200/40 dark:border-zinc-800/40 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span>{item.evidence || '소희 지능 분석'}</span>
                  {item.actionLink && (
                    <Link
                      href={item.actionLink.href}
                      className="text-primary font-semibold hover:underline flex items-center gap-0.5"
                    >
                      <span>{item.actionLink.text}</span>
                      <ArrowRight className="w-2.5 h-2.5" />
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
