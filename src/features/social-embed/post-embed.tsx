'use client'

import { useState } from 'react'
import { getEmbedUrl } from './embed-url'

export interface PostEmbedProps {
  readonly permalink?: string | null
  readonly title?: string
  readonly className?: string
}

export function PostEmbed({ permalink, title, className }: PostEmbedProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (!permalink || !permalink.trim()) {
    return null
  }

  const embed = getEmbedUrl(permalink)

  if (!embed) {
    return (
      <a
        href={permalink}
        target="_blank"
        rel="noopener noreferrer"
        className={className ?? 'inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2'}
      >
        실제 게시물 보기
      </a>
    )
  }

  const fallbackTitle =
    embed.provider === 'instagram'
      ? '인스타그램 게시물 미리 보기'
      : '스레드 게시물 미리 보기'
  const iframeTitle = title || fallbackTitle

  return (
    <div className={className ?? 'inline-flex flex-col items-start gap-1.5'}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="inline-flex items-center justify-center rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted cursor-pointer"
      >
        {isOpen ? '접기' : '게시물 미리 보기'}
      </button>
      {isOpen ? (
        <div className="mt-1 w-full max-w-[540px] overflow-hidden rounded border border-border bg-card shadow-xs">
          <iframe
            src={embed.src}
            sandbox="allow-scripts allow-same-origin allow-popups"
            loading="lazy"
            referrerPolicy="no-referrer"
            title={iframeTitle}
            height="480"
            width="100%"
            style={{
              border: 0,
              overflow: 'hidden',
              minHeight: '480px',
              maxWidth: '540px',
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
