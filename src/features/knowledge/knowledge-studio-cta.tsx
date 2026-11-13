'use client'

import Link from 'next/link'
import { Sparkles, ArrowRight, AlertCircle, HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface KnowledgeStudioCTAProps {
  /** 사용 가능한 지식 개수 또는 지식 항목 배열 */
  items?: readonly { canUseAsEvidence?: boolean }[]
  /** 직접 전달 가능한 유효 근거 수 (우선 적용) */
  availableCount?: number
  /** 지식 조회 오류 메시지 (오류 상태와 빈 상태를 구분) */
  error?: string | null
  /** 지식 등록 영역 앵커 링크 (기본: #knowledge-upload-title) */
  registerAnchorHref?: string
  className?: string
}

export function KnowledgeStudioCTA({
  items,
  availableCount,
  error = null,
  registerAnchorHref = '#knowledge-upload-title',
  className,
}: KnowledgeStudioCTAProps) {
  const validCount =
    typeof availableCount === 'number'
      ? availableCount
      : (items?.filter((item) => Boolean(item.canUseAsEvidence)).length ?? 0)

  const hasError = Boolean(error)
  const isEmpty = !hasError && validCount === 0
  const isReady = !hasError && validCount > 0

  return (
    <section
      aria-labelledby="studio-cta-title"
      className={cn(
        'w-full max-w-full rounded-xl border bg-card p-5 text-card-foreground',
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            <span>스튜디오 바로 연결</span>
          </div>

          <h2
            id="studio-cta-title"
            className="text-lg font-bold tracking-tight text-foreground sm:text-xl break-keep"
          >
            이 정보로 인스타그램·스레드·네이버·당근 글 만들기
          </h2>

          <p className="text-sm leading-relaxed text-muted-foreground break-keep max-w-2xl">
            나의 지식에 적어 둔 내용만 사용해서 채널별 예상 화면을 만들어 드려요. 실제로 올라가지는 않아요.
          </p>

          {hasError && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
            >
              <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="leading-normal">
                <p className="font-semibold">{error}</p>
                <p className="text-muted-foreground mt-0.5">
                  지식 자료를 확인할 수 없어 지금은 글을 생성할 수 없습니다. 페이지를 새로고침해 주세요.
                </p>
              </div>
            </div>
          )}

          {isEmpty && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <HelpCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>먼저 가게 정보를 확인해 주세요</span>
              <a
                href={registerAnchorHref}
                className="inline-flex items-center font-semibold text-primary underline underline-offset-4 hover:text-primary/80 min-h-[44px]"
              >
                지식 자료 등록하기
              </a>
            </div>
          )}
        </div>

        <div className="shrink-0 pt-1 sm:pt-0">
          {isReady ? (
            <Button
              asChild
              className="w-full sm:w-auto font-semibold min-h-[44px]"
              size="lg"
            >
              <Link href="/app/content?studio=four-channel">
                4채널 글 만들기
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              disabled
              className="w-full sm:w-auto font-semibold min-h-[44px] cursor-not-allowed opacity-60"
              size="lg"
              type="button"
            >
              4채널 글 만들기
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
