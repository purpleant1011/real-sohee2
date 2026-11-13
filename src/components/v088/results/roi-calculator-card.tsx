'use client'

import React, { useState } from 'react'
import { Sparkles, TrendingUp, Clock, DollarSign, Users, FileText, Check, Copy, Share2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

export interface RoiCalculatorCardProps {
  hoursSaved?: number
  costSavedWon?: number
  reachCount?: number
  postsCount?: number
  businessName?: string
  className?: string
}

export function RoiCalculatorCard({
  hoursSaved = 42,
  costSavedWon = 350000,
  reachCount = 1420,
  postsCount = 8,
  businessName = '우리 매장',
  className = '',
}: RoiCalculatorCardProps) {
  const [copied, setCopied] = useState(false)

  const handleCopySummary = async () => {
    const summaryText = `[${businessName} × AI 직원 소희 성과 리포트]
✨ 아낀 마케팅 시간: ${hoursSaved}시간
💰 절감된 외주 마케팅비: ₩${costSavedWon.toLocaleString('ko-KR')}
👥 닿은 잠재 고객: ${reachCount.toLocaleString('ko-KR')}명
📢 정성껏 발행한 소식: ${postsCount}건

사장님은 본업에 집중하고, 마케팅은 소희가 똑부러지게 해내고 있어요 🌿`

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(summaryText)
        setCopied(true)
        toast.success('성과 요약이 클립보드에 복사되었어요! SNS나 지인에게 자랑해 보세요 🎉')
        setTimeout(() => setCopied(false), 2500)
      }
    } catch {
      toast.error('클립보드 복사에 실패했습니다.')
    }
  }

  return (
    <Card
      data-testid="roi-calculator-card"
      className={`border-state-wait/25 bg-gradient-to-br from-state-wait/90 via-background to-primary/80 dark:from-state-wait/40 dark:via-background dark:to-primary/30 shadow-xs overflow-hidden ${className}`}
    >
      <CardHeader className="p-5 sm:p-6 pb-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-state-wait-soft text-state-wait">
              <Sparkles className="size-4.5" aria-hidden="true" />
            </span>
            <span className="text-xs font-bold text-muted-foreground">소희 실시간 ROI 환산</span>
          </div>
          <Badge
            variant="outline"
            className="border-state-wait/30 text-state-wait bg-state-wait/50 text-xs font-semibold"
          >
            대행사 외주 대비
          </Badge>
        </div>
        <CardTitle className="text-lg sm:text-xl font-bold text-foreground leading-snug tracking-tight">
          소희가 사장님께 돌려드린 실질적인 가치예요
        </CardTitle>
        <p className="text-xs sm:text-sm text-muted-foreground">
          대행사 외주나 야근 없이, 소희와 함께 가게 소식 제작과 고객 소통을 해결하고 아낀 비용과 시간입니다.
        </p>
      </CardHeader>

      <CardContent className="p-5 sm:p-6 pt-2 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* 1. 절감된 외주비 */}
          <div className="p-3.5 rounded-xl border border-state-ok/30 bg-card dark:bg-card/70 space-y-1 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <DollarSign className="size-3.5 text-state-ok" />
              <span>절감 마케팅비</span>
            </div>
            <div className="text-lg sm:text-xl font-extrabold text-state-ok">
              ₩{costSavedWon.toLocaleString('ko-KR')}
            </div>
            <div className="text-[10px] text-muted-foreground">대행사 인건비 세이브</div>
          </div>

          {/* 2. 아낀 시간 */}
          <div className="p-3.5 rounded-xl border border-border bg-card dark:bg-card/70 space-y-1 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Clock className="size-3.5 text-state-wait" />
              <span>아낀 시간</span>
            </div>
            <div className="text-lg sm:text-xl font-extrabold text-foreground">
              {hoursSaved}시간
            </div>
            <div className="text-[10px] text-muted-foreground">글 작성 & 소통 시간</div>
          </div>

          {/* 3. 닿은 잠재 고객 */}
          <div className="p-3.5 rounded-xl border border-border bg-card dark:bg-card/70 space-y-1 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Users className="size-3.5 text-state-wait" />
              <span>닿은 잠재 고객</span>
            </div>
            <div className="text-lg sm:text-xl font-extrabold text-foreground">
              {reachCount.toLocaleString('ko-KR')}명
            </div>
            <div className="text-[10px] text-muted-foreground">인스타·스레드·플레이스</div>
          </div>

          {/* 4. 발행된 소식 */}
          <div className="p-3.5 rounded-xl border border-border bg-card dark:bg-card/70 space-y-1 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <FileText className="size-3.5 text-primary" />
              <span>발행된 소식</span>
            </div>
            <div className="text-lg sm:text-xl font-extrabold text-foreground">
              {postsCount}건
            </div>
            <div className="text-[10px] text-muted-foreground">환각 없는 매장 이야기</div>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2 flex items-center justify-between gap-3 flex-wrap border-t border-border/40">
          <span className="text-xs text-muted-foreground">
            사장님은 손님 맞이에만 집중하세요. 마케팅은 소희가 성실하게 채워드릴게요.
          </span>
          <Button
            type="button"
            size="sm"
            onClick={handleCopySummary}
            className="font-medium text-xs h-9 px-3.5 bg-state-wait hover:bg-state-wait/90 text-white shadow-xs cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="size-3.5 mr-1" />
                복사 완료!
              </>
            ) : (
              <>
                <Copy className="size-3.5 mr-1" />
                성과 요약 1초 복사
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
