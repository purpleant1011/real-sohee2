'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, ShieldCheck } from 'lucide-react'
import { getEmbedUrl } from '@/features/social-embed/embed-url'
import styles from './live-post-embed.module.css'

export interface LivePostEmbedProps {
  readonly url: string
  readonly verifiedAt?: string | null
}

function fmt(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
}

/**
 * 모바일 전용 게시물 임베드 컴포넌트.
 * Instagram / Threads 게시물인 경우 접힌 카드 형태로 제공하며,
 * 탭했을 때 비로소 iframe을 로드한다. 임베드가 불가할 경우 기존 외부 링크를 노출한다.
 */
export function LivePostEmbed({ url, verifiedAt }: LivePostEmbedProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const embed = getEmbedUrl(url)

  if (!embed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-12 items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 text-sm font-semibold text-primary"
      >
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden="true" />
          실제 게시물 보기
          {verifiedAt ? (
            <span className="font-normal text-muted-foreground">· {fmt(verifiedAt)} 확인</span>
          ) : null}
        </span>
        <ExternalLink className="size-4" aria-hidden="true" />
      </a>
    )
  }

  const providerLabel = embed.provider === 'instagram' ? 'Instagram' : 'Threads'

  return (
    <div className={styles.embedContainer}>
      <div className={`${styles.embedCard} ${isExpanded ? styles.isExpanded : ''}`}>
        <button
          type="button"
          onClick={() => setIsExpanded(prev => !prev)}
          aria-expanded={isExpanded}
          className={styles.embedTrigger}
        >
          <span className="inline-flex items-center gap-2 text-[16px]">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            게시물 미리 보기
            <span className="text-xs font-normal text-muted-foreground">({providerLabel})</span>
          </span>
          {isExpanded ? (
            <ChevronUp className="size-5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </button>

        {isExpanded ? (
          <div className={styles.embedFrameWrapper}>
            <iframe
              src={embed.src}
              title={`${providerLabel} 게시물 미리 보기`}
              sandbox="allow-scripts allow-same-origin allow-popups"
              loading="lazy"
              referrerPolicy="no-referrer"
              className={styles.embedFrame}
            />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.embedExternalLink}
            >
              <span className="inline-flex items-center gap-2">
                실제 게시물 새 창으로 보기
                {verifiedAt ? (
                  <span className="text-xs font-normal text-muted-foreground">· {fmt(verifiedAt)} 확인</span>
                ) : null}
              </span>
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>
        ) : null}
      </div>
    </div>
  )
}
