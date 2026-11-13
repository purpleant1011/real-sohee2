'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { READINESS_LABELS } from './labels'
import type {
  ChannelReadiness,
  ItemReadinessState,
  PublishReadinessResult,
  ReadinessItem,
} from './types'

export interface ReadinessCardProps {
  workspaceId: string
  initialData?: PublishReadinessResult | null
  defaultCollapsed?: boolean
  className?: string
  onReadinessChange?: (readiness: PublishReadinessResult) => void
}

function StatusBadge({ state }: { state: ItemReadinessState }) {
  if (state === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-state-ok-soft text-state-ok border border-[var(--state-ok-line)]">
        <CheckCircle2 className="size-3.5 text-state-ok shrink-0" aria-hidden="true" />
        <span>{READINESS_LABELS.itemStates.ok}</span>
      </span>
    )
  }
  if (state === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-state-danger-soft text-state-danger border border-[var(--state-danger-line)]">
        <AlertCircle className="size-3.5 text-state-danger shrink-0" aria-hidden="true" />
        <span>{READINESS_LABELS.itemStates.blocked}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold bg-state-warn-soft text-state-warn border border-[var(--state-warn-line)]">
      <HelpCircle className="size-3.5 text-state-warn shrink-0" aria-hidden="true" />
      <span>{READINESS_LABELS.itemStates.unknown}</span>
    </span>
  )
}

function ItemRow({ item }: { item: ReadinessItem }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-border/60 bg-background/50 hover:bg-muted/30 transition-colors">
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge state={item.state} />
          <span className="text-sm font-semibold text-foreground tracking-tight">
            {item.label}
          </span>
        </div>
        {item.reason && item.state !== 'ok' && (
          <p className="text-xs text-muted-foreground leading-relaxed pl-0.5">
            {item.reason}
          </p>
        )}
      </div>
      {item.action && item.state !== 'ok' && (
        <div className="shrink-0 pt-1 sm:pt-0">
          <Link
            href={item.action.href}
            className="inline-flex items-center justify-center min-h-11 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.action.label}
          </Link>
        </div>
      )}
    </div>
  )
}

export function ReadinessCard({
  workspaceId,
  initialData = null,
  defaultCollapsed,
  className = '',
  onReadinessChange,
}: Readonly<ReadinessCardProps>) {
  const [data, setData] = useState<PublishReadinessResult | null>(initialData)
  const [isLoading, setIsLoading] = useState<boolean>(!initialData)
  const [error, setError] = useState<string | null>(null)
  const [isCardCollapsed, setIsCardCollapsed] = useState<boolean>(() => {
    if (typeof defaultCollapsed === 'boolean') return defaultCollapsed
    return initialData?.state === 'ready'
  })
  const [channelCollapsed, setChannelCollapsed] = useState<Record<string, boolean>>({
    threads: true, // Secondary channel collapsed on mobile by default
  })

  const fetchReadiness = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/publish-readiness`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error('준비 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요')
      }
      const json = await res.json()
      if (json.success && json.data) {
        setData(json.data)
        onReadinessChange?.(json.data)
        if (defaultCollapsed === undefined && json.data.state === 'ready') {
          setIsCardCollapsed(true)
        }
      } else {
        throw new Error(json.error || '준비 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요')
      }
    } catch (err: any) {
      setError(err?.message || '준비 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, defaultCollapsed, onReadinessChange])

  useEffect(() => {
    if (!initialData) {
      void fetchReadiness()
    }
  }, [fetchReadiness, initialData])

  // Summary Text Calculation
  let summaryText = '준비 상태를 확인하는 중이에요'
  if (error) {
    summaryText = '준비 상태를 불러오지 못했어요. 잠시 후 다시 확인해 주세요'
  } else if (data) {
    if (data.state === 'ready') {
      summaryText = READINESS_LABELS.summaries.ready
    } else if (data.state === 'unknown') {
      summaryText = READINESS_LABELS.summaries.unknown
    } else {
      // Calculate remaining blocker count
      const globalPending = data.global_items.filter((it) => it.state !== 'ok').length
      const channelMinPending =
        data.channels.length > 0
          ? Math.min(...data.channels.map((ch) => ch.items.filter((it) => it.state !== 'ok').length))
          : 0
      const remainingCount = Math.max(1, globalPending + channelMinPending)
      summaryText = READINESS_LABELS.summaries.remaining(remainingCount)
    }
  }

  function toggleChannel(channelName: string) {
    setChannelCollapsed((prev) => ({
      ...prev,
      [channelName]: !prev[channelName],
    }))
  }

  return (
    <Card className={`border-border shadow-xs ${className}`}>
      <CardHeader className="p-4 sm:p-5 pb-3 sm:pb-4 border-b border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base sm:text-lg font-bold flex items-center gap-2">
              <span>첫 게시 준비 점검</span>
            </CardTitle>
            <div
              role="status"
              aria-live="polite"
              className="text-xs sm:text-sm font-semibold text-muted-foreground flex items-center gap-2"
            >
              {data?.state === 'ready' && (
                <span className="w-2 h-2 rounded-full bg-state-ok shrink-0" />
              )}
              {data?.state === 'blocked' && (
                <span className="w-2 h-2 rounded-full bg-state-danger shrink-0" />
              )}
              {data?.state === 'unknown' && (
                <span className="w-2 h-2 rounded-full bg-state-warn shrink-0" />
              )}
              <span>{summaryText}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchReadiness}
              disabled={isLoading}
              className="min-h-11 max-md:min-h-11 text-xs gap-1.5"
            >
              <RefreshCw
                className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>다시 확인하기</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCardCollapsed((prev) => !prev)}
              aria-expanded={!isCardCollapsed}
              aria-label={isCardCollapsed ? '전체 항목 자세히 보기' : '전체 항목 접기'}
              className="min-h-11 max-md:min-h-11 text-xs gap-1"
            >
              <span>{isCardCollapsed ? '자세히 보기' : '접기'}</span>
              {isCardCollapsed ? (
                <ChevronDown className="size-4" aria-hidden="true" />
              ) : (
                <ChevronUp className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {!isCardCollapsed && (
        <CardContent className="p-4 sm:p-5 space-y-6">
          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg border border-[var(--state-danger-line)] bg-state-danger-soft text-state-danger text-xs font-medium"
            >
              {error}
            </div>
          )}

          {data && (
            <div className="space-y-6">
              {/* 1. Global Pre-requisites */}
              <section className="space-y-2.5" aria-labelledby="global-readiness-title">
                <h3
                  id="global-readiness-title"
                  className="text-xs font-bold text-muted-foreground uppercase tracking-wider"
                >
                  기본 점검 항목
                </h3>
                <div className="space-y-2">
                  {data.global_items.map((item) => (
                    <ItemRow key={item.key} item={item} />
                  ))}
                </div>
              </section>

              {/* 2. Per-channel checklist sections */}
              <div className="space-y-4">
                {data.channels.map((channelData: ChannelReadiness) => {
                  const isCollapsed = Boolean(channelCollapsed[channelData.channel])
                  return (
                    <section
                      key={channelData.channel}
                      className="rounded-xl border border-border/80 overflow-hidden"
                      aria-label={`${channelData.channel_label} 준비 점검`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleChannel(channelData.channel)}
                        aria-expanded={!isCollapsed}
                        className="w-full flex items-center justify-between p-3.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left min-h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-bold text-sm text-foreground">
                            {channelData.channel_label}
                          </span>
                          <StatusBadge state={channelData.state === 'ready' ? 'ok' : channelData.state} />
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="hidden sm:inline">
                            {isCollapsed ? '펼치기' : '접기'}
                          </span>
                          {isCollapsed ? (
                            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronUp className="size-4 shrink-0" aria-hidden="true" />
                          )}
                        </div>
                      </button>

                      {!isCollapsed && (
                        <div className="p-3.5 space-y-2 bg-card border-t border-border/60">
                          {channelData.items.map((item) => (
                            <ItemRow key={item.key} item={item} />
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
