'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getNaverFailureCopy } from './naver-failure-copy'

const STATUS_MESSAGES = [
  '글을 쓰고 있어요',
  '사진을 만들고 있어요 (예상 1~2분)',
  '거의 다 됐어요',
] as const

export type NaverGeneratingStateProps = Readonly<{
  topic: string
  imageCount: number
  onCancel: () => void
  isCancelling?: boolean
  error?: {
    message: string
    errorCode?: string | null
  } | null
  onRetry?: () => void
}>

export function NaverGeneratingState({
  topic,
  imageCount,
  onCancel,
  isCancelling = false,
  error = null,
  onRetry,
}: NaverGeneratingStateProps) {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (error) return
    const timer = setInterval(() => {
      setStepIndex((prev) => (prev < STATUS_MESSAGES.length - 1 ? prev + 1 : prev))
    }, 5000)
    return () => clearInterval(timer)
  }, [error])

  if (error) {
    const failure = getNaverFailureCopy(error.errorCode, error.message)

    return (
      <div className="flex flex-col items-center justify-center p-8 text-center space-y-6">
        <div className="rounded-full bg-destructive/10 p-3 text-destructive">
          <AlertCircle className="size-8" aria-hidden />
        </div>

        <div className="space-y-2 max-w-md">
          <h3 className="text-base font-semibold text-foreground">글 생성을 완료하지 못했어요</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{failure.message}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {(failure.action === 'retry' || failure.action === 'retry_new') && onRetry && (
            <Button
              type="button"
              onClick={onRetry}
              className="min-h-[44px]"
            >
              <RefreshCw className="size-4" aria-hidden />
              {failure.action === 'retry_new' ? '같은 주제로 다시 만들기' : '다시 시도'}
            </Button>
          )}

          {failure.action === 'charge' && (
            <Button asChild className="min-h-[44px]">
              <Link href="/app/settings/billing">
                크레딧 충전하기
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          )}

          {failure.action === 'reauth' && (
            <Button asChild variant="outline" className="min-h-[44px]">
              <Link href="/app/settings/channels/naver">
                네이버 연결 확인하기
              </Link>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="min-h-[44px]"
          >
            처음으로
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center space-y-6">
      <div className="relative flex items-center justify-center">
        <Loader2 className="size-10 text-primary animate-spin" aria-hidden />
      </div>

      <div
        role="status"
        aria-live="polite"
        className="space-y-2"
      >
        <p className="text-lg font-semibold text-foreground">
          {STATUS_MESSAGES[stepIndex]}
        </p>
        <p className="text-xs text-muted-foreground max-w-xs line-clamp-2">
          &ldquo;{topic}&rdquo; (사진 {imageCount}장)
        </p>
      </div>

      <div className="pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={isCancelling}
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          {isCancelling ? '취소하는 중…' : '그만두기'}
        </Button>
      </div>
    </div>
  )
}
