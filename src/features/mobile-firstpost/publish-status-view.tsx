import { StatusPill } from '@/components/mobile-ui'
import { cn } from '@/lib/utils'
import type { PublishStatus } from './publish-status'

/**
 * 게시 상태 표시 — 공통 상태 어휘(색 + 아이콘 + 글자)를 그대로 쓴다.
 * 판정은 `publish-status.ts` 가 맡고, 이 파일은 상태를 올리거나 바꾸지 않는다.
 */

/** 좁은 목록 행에 쓰는 상태 알약. */
export function PublishStatusPill({ status, className }: Readonly<{
  status: PublishStatus
  className?: string
}>) {
  return <StatusPill kind={status.kind} label={status.label} className={className} />
}

/**
 * 상태 알약 + 설명 + 확인된 게시물 링크.
 * 링크는 독립 재조회로 확인된 주소일 때만 있다. 확인 전에는 링크를 만들지 않는다.
 */
export function PublishStatusView({ status, className }: Readonly<{
  status: PublishStatus
  className?: string
}>) {
  return (
    <div data-publish-state={status.state} className={cn('flex flex-col items-start gap-1.5', className)}>
      <PublishStatusPill status={status} />
      <p className="text-[13px] leading-relaxed text-muted-foreground">{status.detail}</p>
      {status.permalink ? (
        <a
          className="inline-flex min-h-11 items-center text-[13px] font-medium text-foreground underline underline-offset-4"
          href={status.permalink}
          target="_blank"
          rel="noopener noreferrer"
        >
          게시물 보기<span className="sr-only"> (새 창에서 열기)</span>
        </a>
      ) : null}
    </div>
  )
}
