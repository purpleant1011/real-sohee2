'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { loadPostPublishCare } from './actions/load-post-publish-care'
import { updatePostPublishCare } from './actions/update-post-publish-care'
import type { PostPublishCareChannel, PostPublishCareState } from './actions/post-publish-care-helpers'
import styles from './channel-result-card.module.css'

export type PostPublishCarePanelProps = Readonly<{
  workspaceId: string
  channel: string
  accountLabel: string
  publishedAt?: string | null
  destinationUrl?: string | null
}>

function isCareChannel(ch: string): ch is PostPublishCareChannel {
  return ch === 'instagram' || ch === 'threads'
}

function formatKstTime(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  const valid = isNaN(d.getTime()) ? new Date() : d
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(valid)
}

function CompletionCard({
  channel,
  accountLabel,
  publishedAt,
  destinationUrl,
}: Readonly<{
  channel: PostPublishCareChannel
  accountLabel: string
  publishedAt?: string | null
  destinationUrl?: string | null
}>) {
  const channelTitle = channel === 'instagram' ? 'Instagram' : 'Threads'
  return (
    <div className={styles.publishCompletionCard}>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <CheckCircle2 className="size-4 text-foreground shrink-0" aria-hidden="true" />
        <span>게시했어요</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
        <span>{channelTitle} · {accountLabel}</span>
        <time dateTime={publishedAt ?? undefined}>{formatKstTime(publishedAt)}</time>
      </div>
      <div className="pt-1">
        {destinationUrl ? (
          <a
            href={destinationUrl}
            target="_blank"
            rel="noreferrer"
            className={`${styles.publishCompletionLink} min-h-[44px]`}
          >
            <span>게시물 확인하기</span>
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">채널에서 게시물을 확인하고 있어요</span>
        )}
      </div>
    </div>
  )
}

function CareSwitch({
  label,
  checked,
  onToggle,
}: Readonly<{
  label: string
  checked: boolean
  onToggle: () => void
}>) {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-2">
      <span className={styles.careRowLabel}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={onToggle}
        className={`${styles.careSwitchButton} min-h-[44px]`}
      >
        <span
          className={styles.careSwitchTrack}
          data-checked={checked}
        >
          <span className={styles.careSwitchThumb} />
        </span>
      </button>
    </div>
  )
}

function PostPublishCareContent({
  workspaceId,
  channel,
  accountLabel,
  publishedAt,
  destinationUrl,
}: Readonly<{
  workspaceId: string
  channel: PostPublishCareChannel
  accountLabel: string
  publishedAt?: string | null
  destinationUrl?: string | null
}>) {
  const [state, setState] = useState<PostPublishCareState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const reload = () => {
    setLoading(true)
    setLoadError(false)
    startTransition(async () => {
      const res = await loadPostPublishCare({ workspaceId, channel })
      if (res.ok) setState(res.state)
      else setLoadError(true)
      setLoading(false)
    })
  }

  useEffect(() => {
    let ignore = false
    startTransition(async () => {
      const res = await loadPostPublishCare({ workspaceId, channel })
      if (!ignore) {
        if (res.ok) setState(res.state)
        else setLoadError(true)
        setLoading(false)
      }
    })
    return () => {
      ignore = true
    }
  }, [workspaceId, channel])

  const handleToggle = async (key: 'comment_watch' | 'reaction_report') => {
    if (!state) return
    const prevVal = key === 'comment_watch' ? state.comment_watch.enabled : state.reaction_report.enabled
    const nextVal = !prevVal
    setInlineError(null)

    setState((prev) => (!prev ? prev : {
      ...prev,
      [key]: { ...prev[key], enabled: nextVal },
    }))

    const res = await updatePostPublishCare({ workspaceId, channel, key, enabled: nextVal })
    if (!res.ok) {
      setState((prev) => (!prev ? prev : {
        ...prev,
        [key]: { ...prev[key], enabled: prevVal },
      }))
      setInlineError('설정을 변경하지 못했어요.')
    } else {
      setState(res.state)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <CompletionCard
        channel={channel}
        accountLabel={accountLabel}
        publishedAt={publishedAt}
        destinationUrl={destinationUrl}
      />

      <section aria-label="소희가 이어서 할 일" className="flex flex-col gap-3">
        <h4 className={styles.carePanelTitle}>소희가 이어서 할 일</h4>

        {loading ? (
          <div aria-busy="true" className="flex flex-col gap-2 py-2 text-xs text-muted-foreground">
            <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-between gap-2 py-2 text-xs">
            <span className="text-muted-foreground">소희 사후 설정을 불러오지 못했어요.</span>
            <button
              type="button"
              onClick={reload}
              className="min-h-[44px] px-2 font-medium text-primary underline underline-offset-4 hover:opacity-80"
            >
              다시 시도
            </button>
          </div>
        ) : state ? (
          <div className="flex flex-col gap-2.5">
            {inlineError && <p className="text-destructive font-medium">{inlineError}</p>}

            <CareSwitch
              label="댓글 확인 · 답글 초안 준비"
              checked={state.comment_watch.enabled}
              onToggle={() => handleToggle('comment_watch')}
            />

            {state.reaction_report.needsSetup ? (
              <div className="flex min-h-[44px] items-center justify-between gap-2">
                <span className={styles.careRowLabel}>반응 요약 (게시 24시간 뒤)</span>
                <Link
                  href="/app/account/automation"
                  className="inline-flex min-h-[44px] items-center font-medium text-primary underline underline-offset-4 hover:opacity-80"
                >
                  자동화에서 켜기
                </Link>
              </div>
            ) : (
              <CareSwitch
                label="반응 요약 (게시 24시간 뒤)"
                checked={state.reaction_report.enabled}
                onToggle={() => handleToggle('reaction_report')}
              />
            )}

            <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2">
              <div className={styles.careSecondaryRow}>
                <span>DM 문의</span>
                <span>{state.always_on.dm.active ? '소희가 확인하고 있어요' : (state.always_on.dm.reason ?? '지원하지 않아요')}</span>
              </div>
              <div className={styles.careSecondaryRow}>
                <span>예약 문의</span>
                <span>{state.always_on.booking_inquiry.active ? '소희가 확인하고 있어요' : (state.always_on.booking_inquiry.reason ?? '지원하지 않아요')}</span>
              </div>
            </div>

            <p className={styles.careDisclaimer}>
              소희는 사장님이 승인하기 전에는 손님에게 먼저 답하지 않아요. 초안만 준비해요.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  )
}

export function PostPublishCarePanel(props: PostPublishCarePanelProps) {
  if (!isCareChannel(props.channel)) return null
  return <PostPublishCareContent {...props} channel={props.channel} />
}
