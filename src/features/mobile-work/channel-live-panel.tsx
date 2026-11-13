'use client'

import Link from 'next/link'
import { ArrowRight, ExternalLink, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SocialReportMetric } from '@/features/reports/types'
import {
  useChannelEngagement,
  useSocialPerformanceRefresh,
  type SupportedConnectedChannel,
} from './use-channel-engagement'

export type ChannelLivePanelChannel = SupportedConnectedChannel
export type ChannelConnectionStatus = 'connected' | 'expired' | 'disconnected' | 'unknown'

export interface ChannelLivePanelProps {
  workspaceId: string
  contentId: string
  channel: ChannelLivePanelChannel
  contentStatus: string
  connectionStatus: ChannelConnectionStatus
  publishedUrl?: string | null
  publishAttemptId?: string | null
  providerPostId?: string | null
  publishedAt?: string | null
  initialMetrics?: readonly SocialReportMetric[] | null
  initialCollectedAt?: string | null
}

const CHANNEL_DISPLAY_NAME: Record<ChannelLivePanelChannel, string> = {
  instagram: 'Instagram',
  threads: 'Threads',
}

const STATUS_DISPLAY_NAME: Record<string, string> = {
  draft: '초안',
  review: '검토 중',
  approved: '승인됨',
  scheduled: '예약됨',
  published: '게시됨',
  archived: '보관됨',
}

const SOCIAL_METRIC_LABELS: Record<string, string> = {
  views: '조회',
  likes: '좋아요',
  comments: '댓글',
  saved: '저장',
  shares: '공유',
  replies: '답글',
  reposts: '재게시',
  quotes: '인용',
  visits: '방문',
  inquiries: '문의',
}

function formatSocialMetricItem(metric: SocialReportMetric): string {
  const label = SOCIAL_METRIC_LABELS[metric.metric] ?? metric.metric
  if (metric.state === 'available' && metric.value !== null) {
    return `${label} ${metric.value}`
  }
  return `${label} 확인하지 못했어요`
}

function formatKstDateTime(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Seoul',
    }).format(new Date(isoString))
  } catch {
    return isoString
  }
}

/**
 * 인스타그램·스레드(API 연동 채널)를 위한 모바일 작업 상세 실시간 연동 패널.
 * 순수 읽기 전용 프레젠테이션 컴포넌트로, 직접 발행 API나 외부 쓰기 엔드포인트를 호출하지 않으며
 * 승인 화면(/app/work/:contentId/approve)으로만 연결합니다.
 */
export function ChannelLivePanel({
  workspaceId,
  contentId,
  channel,
  contentStatus,
  connectionStatus,
  publishedUrl,
  publishAttemptId,
  providerPostId,
  publishedAt,
  initialMetrics,
  initialCollectedAt,
}: Readonly<ChannelLivePanelProps>) {
  const engagement = useChannelEngagement(workspaceId, channel)
  const performance = useSocialPerformanceRefresh({
    workspaceId,
    publishAttemptId,
    publishedAt,
    initialMetrics,
    initialCollectedAt,
  })

  const isConnected = connectionStatus === 'connected'
  const isPendingReview = contentStatus === 'draft' || contentStatus === 'review'
  const hasValidHttpsUrl =
    typeof publishedUrl === 'string' && publishedUrl.startsWith('https://')

  return (
    <section
      aria-label={`${CHANNEL_DISPLAY_NAME[channel]} 실시간 연동 현황`}
      className="space-y-3 rounded-2xl border border-border bg-card p-4 text-foreground"
    >
      {/* 헤더: 채널명 및 상태 뱃지 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{CHANNEL_DISPLAY_NAME[channel]}</Badge>
          <Badge variant={isConnected ? 'outline' : 'destructive'}>
            {isConnected
              ? (STATUS_DISPLAY_NAME[contentStatus] ?? contentStatus)
              : connectionStatus === 'expired'
                ? '연결 만료'
                : '미연결'}
          </Badge>
        </div>
      </div>

      {/* (a) 게시 상태 행 */}
      <div className="space-y-2">
        {!isConnected ? (
          <Button
            asChild
            variant="outline"
            className="flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-sm font-semibold"
          >
            <Link prefetch={false} href="/app/channels">
              <span>채널 연결하기</span>
              <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          </Button>
        ) : isPendingReview ? (
          <Button
            asChild
            variant="default"
            className="flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-sm font-semibold"
          >
            <Link prefetch={false} href={`/app/work/${encodeURIComponent(contentId)}/approve`}>
              <span>승인하고 게시하기</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        ) : contentStatus === 'approved' ? (
          <Button
            asChild
            variant="default"
            className="flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-sm font-semibold"
          >
            <Link prefetch={false} href={`/app/work/${encodeURIComponent(contentId)}/approve`}>
              <span>게시 전 최종 확인</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        ) : contentStatus === 'published' && hasValidHttpsUrl ? (
          <Button
            asChild
            variant="outline"
            className="flex min-h-12 w-full items-center justify-between rounded-xl border-primary/30 bg-primary/5 px-4 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            <a href={publishedUrl} target="_blank" rel="noopener noreferrer">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="size-4" aria-hidden="true" />
                실제 게시물 보기
              </span>
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
        ) : null}
      </div>

      {/* (b) 실시간 응대 행 */}
      <div>
        {engagement.state === 'loading' ? (
          <div className="flex min-h-12 w-full items-center justify-between rounded-xl border border-border bg-muted/40 px-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
              실시간 응대
            </span>
            <span>확인 중...</span>
          </div>
        ) : engagement.state === 'ready' && engagement.summary ? (
          <Button
            asChild
            variant="outline"
            className="flex min-h-12 w-full items-center justify-between rounded-xl border-border bg-card px-4 text-sm font-medium hover:bg-accent"
          >
            <Link prefetch={false} href="/app/engagement">
              <span className="inline-flex items-center gap-2 text-foreground">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                실시간 응대
              </span>
              <span className="font-semibold text-primary">
                DM {engagement.summary.dmCount}건 · 댓글 {engagement.summary.pendingCommentCount}건
              </span>
            </Link>
          </Button>
        ) : (
          <Button
            asChild
            variant="outline"
            className="flex min-h-12 w-full items-center justify-between rounded-xl border-border bg-card px-4 text-sm font-medium hover:bg-accent"
          >
            <Link prefetch={false} href="/app/engagement">
              <span className="inline-flex items-center gap-2 text-foreground">
                <MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                실시간 응대
              </span>
              <span className="text-muted-foreground">확인하지 못했어요</span>
            </Link>
          </Button>
        )}
      </div>

      {/* (c) 채널 성과 영역 (게시 완료 및 providerPostId 검증 시에만 노출) */}
      {contentStatus === 'published' && Boolean(providerPostId) ? (
        <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">채널 성과</span>
            <Button
              type="button"
              variant="outline"
              disabled={performance.isPending || performance.cooldownRemaining > 0}
              onClick={() => void performance.refresh()}
              className="min-h-[44px] px-3.5 text-base font-semibold"
            >
              {performance.isPending ? (
                <>
                  <RefreshCw className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
                  불러오는 중…
                </>
              ) : (
                '성과 새로고침'
              )}
            </Button>
          </div>

          {/* 지표 목록 */}
          <div className="text-sm text-foreground">
            {performance.metrics && performance.metrics.length > 0 ? (
              <p className="leading-6">
                {performance.metrics.map(formatSocialMetricItem).join(' · ')}
              </p>
            ) : (
              <p className="text-muted-foreground">아직 수집된 채널 지표가 없습니다.</p>
            )}
          </div>

          {/* 수집 시각 */}
          {performance.collectedAt ? (
            <p className="text-xs text-muted-foreground">
              수집 시각 {formatKstDateTime(performance.collectedAt)}
            </p>
          ) : null}

          {/* 오류 메시지 */}
          {performance.error ? (
            <div role="alert" className="text-xs text-destructive">
              <span>{performance.error}</span>
              {performance.isMissingScope ? (
                <Link
                  prefetch={false}
                  href="/app/channels"
                  className="ml-2 font-medium underline hover:text-destructive/80"
                >
                  채널 연결
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* (d) 안내 노트 */}
      <p className="text-xs text-muted-foreground">게시는 승인한 뒤에만 나가요.</p>
    </section>
  )
}
