'use client'

import { useEffect, useState } from 'react'
import { Sparkles, CheckCircle2, Star, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { NaverPlaceSummary } from './place-extractor'

export type NaverPlaceConnectCardProps = Readonly<{
  workspaceId: string
  initialPlace?: NaverPlaceSummary | null
  onPlaceSynced?: (place: NaverPlaceSummary) => void
  onStartBlogPost?: (place?: NaverPlaceSummary) => void
  onStartSnsCard?: (place?: NaverPlaceSummary) => void
}>

export function NaverPlaceConnectCard({
  workspaceId,
  initialPlace = null,
  onPlaceSynced,
  onStartBlogPost,
  onStartSnsCard,
}: NaverPlaceConnectCardProps) {
  const [place, setPlace] = useState<NaverPlaceSummary | null>(initialPlace)

  useEffect(() => {
    if (!place && workspaceId) {
      let active = true
      try {
        const promise = fetch(`/api/workspaces/${workspaceId}/naver-place-sync`)
        if (promise && typeof promise.then === 'function') {
          promise
            .then((res) => (res && res.ok ? res.json() : null))
            .then((data) => {
              if (active && data?.summary) {
                setPlace(data.summary)
                onPlaceSynced?.(data.summary)
              }
            })
            .catch(() => {})
        }
      } catch {
        // Safe fallback when route is not available
      }
      return () => {
        active = false
      }
    }
  }, [workspaceId, place, onPlaceSynced])

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-background to-emerald-500/5 p-4 sm:p-5 shadow-xs transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-emerald-600 text-white font-extrabold text-xs shadow-2xs">
              M
            </span>
            <h2 className="text-base sm:text-lg font-bold tracking-tight">
              {place ? '매장 지식 등록 상태' : '매장 기본 정보 직접 등록'}
            </h2>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10">
              {place ? '직접 등록 매장' : '직접 입력 안내'}
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {place
              ? '등록된 매장 정보를 바탕으로 맞춤형 블로그 및 SNS 글을 준비해요.'
              : '네이버 지도 자동 연동은 제공하지 않아요. 아래 매장 정보 폼에서 상호, 주소, 업종을 직접 입력해 주시면 소희가 맞춤형 글을 준비해 드려요.'}
          </p>
        </div>
      </div>

      {!place ? (
        <div className="mt-4 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-50/20 p-4 text-xs text-muted-foreground leading-relaxed">
          <p>
            💡 아래 <strong>[우리 가게 정보]</strong> 칸에 매장 정보를 직접 적어 주세요. 소희가 그 내용을 바탕으로 글을 써요.
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-border bg-card p-4 space-y-3.5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-foreground">{place.name}</h3>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <CheckCircle2 className="size-3" /> 등록 완료
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                <span>{place.category}</span>
                <span>·</span>
                <span>{place.roadAddress}</span>
              </p>
            </div>

            {place.visitorReviewScore && (
              <div className="flex items-center gap-1.5 text-xs bg-amber-500/10 text-amber-900 dark:text-amber-300 border border-amber-500/20 px-2.5 py-1 rounded-lg shrink-0">
                <Star className="size-3.5 fill-amber-500 text-amber-500" aria-hidden />
                <span className="font-bold">{place.visitorReviewScore.toFixed(2)}</span>
                {place.visitorReviewCount && (
                  <span className="text-muted-foreground">({place.visitorReviewCount}명 방문)</span>
                )}
              </div>
            )}
          </div>

          {/* Place Images Grid */}
          {place.images.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <ImageIcon className="size-3" /> 매장 실제 사진 {place.images.length}장 등록됨:
              </span>
              <div className="grid grid-cols-4 gap-2">
                {place.images.slice(0, 4).map((src, i) => (
                  <div key={i} className="aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="size-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action CTA */}
          <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              매장 정보가 소희 지식에 반영되어 환각 없는 블로그 및 SNS 글이 작성돼요.
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                onClick={() => onStartSnsCard?.(place ?? undefined)}
                className="text-xs font-medium h-9 px-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-xs cursor-pointer"
              >
                <Sparkles className="size-3.5" aria-hidden />
                ⭐ 찐 후기 감사 카드뉴스 (인스타/스레드)
              </Button>
              <Button
                type="button"
                onClick={() => onStartBlogPost?.(place ?? undefined)}
                className="text-xs font-medium h-9 px-4 bg-[#03C75A] hover:bg-[#03C75A]/90 text-white shadow-xs cursor-pointer"
              >
                <Sparkles className="size-3.5" aria-hidden />
                이 정보로 블로그 첫 글 쓰기
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
