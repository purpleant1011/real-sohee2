'use client'

import React, { useEffect, useRef } from 'react'
import Link from 'next/link'
import { AlertCircle, AlertTriangle, Clock, RefreshCw, Sparkles, Store } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { FirstPostErrorGuidance } from './first-post-error-guidance'

interface FirstPostErrorCardProps {
  guidance: FirstPostErrorGuidance
  onRetry?: () => void
  onVault?: () => void
  isLoading?: boolean
}

function getCategoryIcon(category: FirstPostErrorGuidance['category']) {
  switch (category) {
    case 'INSUFFICIENT_CREDITS':
    case 'PUBLISH_NOT_ENABLED':
    case 'WORKSPACE_NOT_IN_LIVE_ROLLOUT':
      return <Sparkles className="h-6 w-6 text-indigo-500 shrink-0" aria-hidden="true" />
    case 'TRIAL_LIMIT':
      return <Store className="h-6 w-6 text-indigo-500 shrink-0" aria-hidden="true" />
    case 'DAILY_LIMIT':
    case 'REVISION_LIMIT':
    case 'TIMEOUT':
      return <Clock className="h-6 w-6 text-amber-500 shrink-0" aria-hidden="true" />
    case 'CHANNELS_DISCONNECTED':
      return <AlertCircle className="h-6 w-6 text-indigo-500 shrink-0" aria-hidden="true" />
    case 'TRANSIENT':
    default:
      return <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0" aria-hidden="true" />
  }
}

export function FirstPostErrorCard({ guidance, onRetry, onVault, isLoading = false }: FirstPostErrorCardProps) {
  const primaryButtonRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null)

  useEffect(() => {
    // 접근성: 오류 카드 표시 시 주요 액션 버튼으로 포커스 이동
    primaryButtonRef.current?.focus()
  }, [guidance.category])

  return (
    <Card
      role="alert"
      aria-live="assertive"
      className="w-full max-w-md mx-auto my-8 border-border shadow-sm p-2 sm:p-4 text-center sm:text-left"
    >
      <CardHeader className="space-y-3 px-4 pt-4 pb-2">
        <div className="flex items-center gap-3 justify-center sm:justify-start">
          <div className="rounded-full bg-muted/60 p-2.5">
            {getCategoryIcon(guidance.category)}
          </div>
          <CardTitle className="text-lg sm:text-xl font-bold leading-snug">
            {guidance.title}
          </CardTitle>
        </div>
        <CardDescription className="text-sm text-muted-foreground leading-relaxed break-keep">
          {guidance.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-4 py-2">
        {/* 보조 안내 또는 내용 유지 알림 */}
        {guidance.category === 'TRANSIENT' && (
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2.5">
            작성하신 매장 정보나 설정 내용은 안전하게 보관되어 있어요.
          </p>
        )}
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row gap-2.5 px-4 pt-2 pb-4">
        {guidance.primaryAction.actionType === 'retry' ? (
          <Button
            ref={primaryButtonRef as React.RefObject<HTMLButtonElement>}
            variant={guidance.primaryAction.variant ?? 'default'}
            className="w-full sm:flex-1 min-h-11 font-medium"
            disabled={isLoading}
            onClick={onRetry}
          >
            {isLoading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {guidance.primaryAction.label}
          </Button>
        ) : guidance.primaryAction.actionType === 'vault' ? (
          <Button
            ref={primaryButtonRef as React.RefObject<HTMLButtonElement>}
            variant={guidance.primaryAction.variant ?? 'default'}
            className="w-full sm:flex-1 min-h-11 font-medium"
            disabled={isLoading}
            onClick={onVault || onRetry}
          >
            {isLoading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {guidance.primaryAction.label}
          </Button>
        ) : (
          <Button
            ref={primaryButtonRef as React.RefObject<HTMLButtonElement>}
            variant={guidance.primaryAction.variant ?? 'default'}
            className="w-full sm:flex-1 min-h-11 font-medium"
            asChild
          >
            <Link href={guidance.primaryAction.href || '#'}>
              {guidance.primaryAction.label}
            </Link>
          </Button>
        )}

        {guidance.secondaryAction && (
          <Button
            variant={guidance.secondaryAction.variant ?? 'outline'}
            className="w-full sm:w-auto min-h-11 font-medium"
            asChild
          >
            <Link href={guidance.secondaryAction.href || '#'}>
              {guidance.secondaryAction.label}
            </Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
