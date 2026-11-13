'use client'

import { useState } from 'react'
import { Sparkles, MessageCircle, Mail, Heart, ChevronDown, ChevronUp } from 'lucide-react'

export interface EngagementMorningBriefingProps {
  commentCount?: number
  dmCount?: number
  reactionCount?: number
  autoRepliedTodayCount?: number
  upcomingPlannedPost?: {
    themeTitle: string
    scheduledSlotLabel: string
  } | null
}

export function EngagementMorningBriefing({
  commentCount = 0,
  dmCount = 0,
  reactionCount = 0,
  autoRepliedTodayCount = 0,
  upcomingPlannedPost = null,
}: Readonly<EngagementMorningBriefingProps>) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  const hasAnyData =
    commentCount > 0 ||
    dmCount > 0 ||
    reactionCount > 0 ||
    autoRepliedTodayCount > 0 ||
    Boolean(upcomingPlannedPost)

  if (!hasAnyData) {
    return null
  }

  return (
    <section
      aria-label="소희의 소셜 반응 일일 브리핑"
      className="rounded-2xl border border-primary/20 bg-card p-4.5 sm:p-5 shadow-xs space-y-3.5"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-xs shrink-0">
            <Sparkles aria-hidden="true" className="size-4.5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-foreground flex items-center gap-2">
              <span>소희의 소셜 반응 일일 브리핑</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                실시간 분석
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              스레드와 인스타그램에서 발생한 고객 반응을 분석하고 오늘 필요한 액션을 정리했어요.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-xs font-bold text-primary hover:text-primary/80 p-1.5 rounded-lg hover:bg-primary/10 transition-colors flex items-center gap-1 cursor-pointer"
        >
          <span>{isCollapsed ? '펼치기' : '접기'}</span>
          {isCollapsed ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronUp aria-hidden="true" className="size-3.5" />
          )}
        </button>
      </div>

      {!isCollapsed ? (
        <div className="space-y-3">
          {/* 📅 L3 점장형 정기 소셜 포스팅 예고 배너 */}
          {upcomingPlannedPost ? (
            <div className="rounded-xl bg-state-wait-soft border border-[var(--state-wait-line)] p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-state-wait shadow-2xs">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-state-wait animate-pulse" />
                <span>📢 소희가 준비한 정기 소식: [{upcomingPlannedPost.themeTitle}]</span>
              </div>
              <span className="text-[11px] font-semibold text-state-wait">
                {upcomingPlannedPost.scheduledSlotLabel} 자동 발행 예정 🚀
              </span>
            </div>
          ) : null}

          {/* 소희 자율 처리 실적 배너 */}
          {autoRepliedTodayCount > 0 ? (
            <div className="rounded-xl bg-state-ok-soft border border-[var(--state-ok-line)] p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-state-ok shadow-2xs">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-state-ok animate-pulse" />
                <span>오늘 소희가 알아서 칭찬·인사 댓글 {autoRepliedTodayCount}건에 센스있게 자동 답글을 달았어요!</span>
              </div>
              <span className="text-[11px] font-semibold text-state-ok">
                사장님 시간 약 {autoRepliedTodayCount * 5}분 절약 ✨
              </span>
            </div>
          ) : null}

          {/* 주요 지표 칩 그리드: 실제 데이터가 있는 지표만 표시 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
            {commentCount > 0 ? (
              <div className="rounded-xl border border-border/60 bg-card p-2.5 sm:p-3 flex items-center gap-2.5">
                <div className="size-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <MessageCircle aria-hidden="true" className="size-4" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground">스레드 답글</p>
                  <p className="text-xs sm:text-sm font-extrabold text-foreground">답글 대기 {commentCount}건</p>
                </div>
              </div>
            ) : null}

            {dmCount > 0 ? (
              <div className="rounded-xl border border-border/60 bg-card p-2.5 sm:p-3 flex items-center gap-2.5">
                <div className="size-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <Mail aria-hidden="true" className="size-4" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground">인스타그램 메시지</p>
                  <p className="text-xs sm:text-sm font-extrabold text-foreground">메시지 문의 {dmCount}건</p>
                </div>
              </div>
            ) : null}

            {reactionCount > 0 ? (
              <div className="rounded-xl border border-border/60 bg-card p-2.5 sm:p-3 flex items-center gap-2.5">
                <div className="size-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <Heart aria-hidden="true" className="size-4" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground">소셜 호응</p>
                  <p className="text-xs sm:text-sm font-extrabold text-foreground">공감 반응 {reactionCount}+회</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* DM 문의가 실제로 대기 중일 때만 액션 안내 */}
          {dmCount > 0 ? (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-xs leading-relaxed text-foreground font-medium">
              <p>
                💡 <strong>소희의 조언:</strong> 인스타그램 메시지로 들어온 <strong>예약 문의는 24시간 내 답변이 중요해요</strong>.
                상단 <span className="font-bold underline">메시지</span> 탭에서 확인해 보세요.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
