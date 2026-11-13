'use client'

import React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Sparkles, AlertCircle, Radio, Calendar, MessageCircle, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TodayCardData } from './types'

export interface TodayCardViewProps {
  card: TodayCardData
  pendingSummary?: {
    total: number
    comments?: number
    posts?: number
    dms?: number
  } | null
  density?: 'compact' | 'detailed'
  className?: string
}

export function TodayCardView({
  card,
  pendingSummary,
  density = 'compact',
  className,
}: TodayCardViewProps) {
  const getIcon = () => {
    switch (card.state) {
      case 'INQUIRY_RECEIVED':
        return <MessageCircle className="size-3.5 sm:size-4 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden="true" />
      case 'READY_POST':
        return <Sparkles className="size-3.5 sm:size-4 text-purple-600 dark:text-purple-400 shrink-0" aria-hidden="true" />
      case 'AUTONOMOUS_POST_DUE':
        return <Clock className="size-3.5 sm:size-4 text-purple-600 dark:text-purple-400 shrink-0" aria-hidden="true" />
      case 'NEEDS_REAPPROVAL':
        return <AlertCircle className="size-3.5 sm:size-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
      case 'CONNECT_CHANNEL':
        return <Radio className="size-3.5 sm:size-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
      case 'NO_POST_YET':
      default:
        return <Calendar className="size-3.5 sm:size-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
    }
  }

  const hasPending = pendingSummary && pendingSummary.total > 0

  return (
    <Card
      className={cn(
        'border-primary/25 bg-gradient-to-b from-card to-background/50 rounded-2xl shadow-xs overflow-hidden transition-all duration-200 hover:border-primary/40',
        className
      )}
    >
      <CardContent className="p-0">
        {/* 상단 본문 영역 (herotop) */}
        <div className={cn(
          'p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4',
          density === 'detailed' && 'bg-purple-500/5'
        )}>
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11px] font-semibold tracking-tight">
                {getIcon()}
                지금 확인하면 좋아요
              </span>
              <Badge variant="outline" className="text-[11px] font-medium border-border/80">
                {card.badgeLabel}
              </Badge>
            </div>

            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-2xl font-bold tracking-tight text-foreground leading-snug">
                  {card.title}
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {card.description}
                </p>
              </div>

              {card.postImageUrl && (
                <div className="relative size-14 sm:size-16 rounded-xl overflow-hidden bg-muted shrink-0 border border-border">
                  <Image
                    src={card.postImageUrl}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 56px, 64px"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 단 1개의 주 액션(Primary CTA) 버튼 영역 */}
          <div className="w-full sm:w-auto shrink-0 flex flex-col items-start sm:items-end gap-1.5 pt-1 sm:pt-0">
            <Button
              asChild
              size="lg"
              className="w-full sm:w-auto min-h-[46px] px-6 text-sm font-semibold shadow-xs cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Link href={card.ctaHref} className="flex items-center justify-center gap-2">
                <span>{card.ctaLabel}</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </Button>
            <span className="text-[11px] text-muted-foreground hidden sm:block">
              사장님 승인 전에는 발송하지 않아요
            </span>
          </div>
        </div>

        {/* 하단 요약 바 (herobottom - 단 1개의 주 CTA 링크 원칙을 보존하기 위해 텍스트 표시) */}
        <div className="px-4 sm:px-6 py-2.5 bg-muted/30 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2 truncate">
            {hasPending ? (
              <span>
                <strong className="font-semibold text-foreground">결정 대기 {pendingSummary.total}건</strong>
                {typeof pendingSummary.dms === 'number' && pendingSummary.dms > 0 && ` · 문의 ${pendingSummary.dms}`}
                {typeof pendingSummary.posts === 'number' && pendingSummary.posts > 0 && ` · 콘텐츠 ${pendingSummary.posts}`}
              </span>
            ) : (
              <span>
                <strong className="font-semibold text-foreground">안전한 자율근무</strong> · 사장님의 규칙 안에서 일하고 있어요
              </span>
            )}
          </div>
          <span className="text-[11px] text-primary flex items-center gap-0.5 shrink-0 ml-2 font-medium">
            전체 확인 ↗
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
