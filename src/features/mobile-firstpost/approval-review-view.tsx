'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { StateView, StatusPill, type StateKind } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'
import {
  APPROVAL_CTA,
  buildApprovalReview,
  createApprovalRequester,
  type ApprovalReviewInput,
  type ApprovalSubmission,
} from './approval-review'
import { ApprovalRequestError } from './approval-client'
import { PREVIEW_ACTION_LABEL } from './preview-set'

/**
 * M07 게시 전 최종 승인 화면 (ANI-1680).
 * 어디에 → 무엇을 → 비용을 한 화면에 보이고 고정 CTA 하나만 둔다.
 * '요청 보냄'은 '게시됨'이 아니다 — 결과는 M08 이 판정한다.
 */
export type ApprovalReviewViewProps = Readonly<{
  input: ApprovalReviewInput
  /** 사진 id → 화면용 주소. 없으면 사진 칸을 만들지 않는다. */
  imageUrlFor?: (imageId: string) => string | null
  load?: StateKind
  checkedAt?: string | null
  /** 승인 요청 전송. 호출 측이 서버 명령에 연결한다. */
  onSubmit: (request: ApprovalSubmission) => Promise<unknown>
  onRetry?: () => void
  /** 승인만 기록하는 호출부는 게시 요청과 구분해 안내한다. */
  successMessage?: string
}>

type SubmitState = 'IDLE' | 'SENDING' | 'SENT' | 'FAILED'

export function ApprovalReviewView({ input, imageUrlFor, load = 'ready', checkedAt, onSubmit, onRetry, successMessage }: ApprovalReviewViewProps) {
  const review = useMemo(() => buildApprovalReview(input), [input])
  const latest = useRef({ input, onSubmit })
  const requesterRef = useRef<ReturnType<typeof createApprovalRequester> | null>(null)
  useEffect(() => {
    latest.current = { input, onSubmit }
  })
  const [submit, setSubmit] = useState<SubmitState>('IDLE')
  const [message, setMessage] = useState<string | null>(null)

  const approve = async () => {
    setSubmit('SENDING')
    setMessage(null)
    try {
      requesterRef.current ??= createApprovalRequester({
        read: () => latest.current.input,
        submit: (r) => latest.current.onSubmit(r),
      })
      const result = await requesterRef.current.run()
      if (result.kind === 'SUBMITTED') setSubmit('SENT')
      else {
        setSubmit('IDLE')
        setMessage(result.kind === 'BLOCKED' ? result.messages[0] ?? '지금은 요청할 수 없어요.' : '승인 문구를 확인해 주세요.')
      }
    } catch (error) {
      setSubmit('FAILED')
      const detail = error instanceof ApprovalRequestError ? error.userMessage : null
      setMessage(`${detail ?? '요청을 보내지 못했어요.'} 게시된 것은 없어요. 다시 시도해 주세요.`)
    }
  }

  const sent = submit === 'SENT'

  return (
    <StateView
      kind={load}
      checkedAt={checkedAt}
      skeleton="detail"
      action={onRetry ? <Button variant="outline" className="min-h-11" onClick={onRetry}>다시 확인</Button> : undefined}
    >
      <section data-first-post-approval aria-label="게시 전 최종 확인" className="space-y-5">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">올리기 전에 확인해 주세요</h2>
          <StatusPill
            kind={review.approvalStatus === 'STALE' ? 'review' : review.approvalStatus === 'CURRENT' ? 'awaiting_approval' : 'draft'}
            label={review.statusLabel}
          />
        </header>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">어디에 올려요</h3>
          <ul className="space-y-1.5">
            {review.targets.map((t) => (
              <li key={t.channel} className="flex flex-wrap items-baseline justify-between gap-x-2 rounded-xl border border-border px-3 py-2 text-sm">
                <span className="font-medium">{t.channelName} {t.handle}</span>
                <span className="text-muted-foreground">{t.verified ? '✓ ' : ''}{t.statusLabel}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">무엇을 올려요</h3>
          {imageUrlFor
            ? review.imageIds.map((id) => {
                const src = imageUrlFor(id)
                // eslint-disable-next-line @next/next/no-img-element
                return src ? <img key={id} src={src} alt="올릴 사진" className="max-h-64 w-full rounded-xl border border-border object-contain" /> : null
              })
            : null}
          {review.copies.map((c) => (
            <article key={c.channel} className="space-y-1 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground">{c.channelName}</p>
              <p className="whitespace-pre-wrap break-words">{c.text}</p>
              <p className="font-medium text-primary">{c.cta}</p>
            </article>
          ))}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">올리는 때</dt>
          <dd className="text-right">{review.timingLabel}</dd>
          <dt className="text-muted-foreground">비용</dt>
          <dd className="text-right font-medium">{review.cost.label}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">{review.cost.detail}</p>

        {review.blockerMessages.length > 0 && !sent ? (
          <ul role="alert" className="space-y-1 rounded-xl bg-state-warn-soft px-3 py-2 text-sm text-state-warn">
            {review.blockerMessages.map((m) => <li key={m}>{m}</li>)}
          </ul>
        ) : null}
        {message ? <p role="status" className="text-sm text-state-warn">{message}</p> : null}
        {sent ? (
          <p role="status" className="rounded-xl bg-state-wait-soft px-3 py-2 text-sm text-state-wait">
            {successMessage ?? '게시 요청을 보냈어요. 실제로 올라간 것은 확인되면 알려드릴게요.'}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
          <Button className="min-h-11 w-full" disabled={!review.ctaEnabled || submit === 'SENDING' || sent} onClick={approve}>
            {submit === 'SENDING' ? '요청 보내는 중' : APPROVAL_CTA}
          </Button>
          {review.manualFallback.length > 0 ? (
            <div className="flex gap-2">
              {review.manualFallback.map((a) => (
                <Button key={a} variant="outline" className="min-h-11 flex-1">{PREVIEW_ACTION_LABEL[a]}</Button>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </StateView>
  )
}
