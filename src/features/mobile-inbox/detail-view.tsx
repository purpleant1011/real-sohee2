'use client'

import { useState } from 'react'
import { StickyActionBar } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { CHANNEL_LABEL } from './inbox-model'
import { deliveryChip, reviewGate, type ConversationDetailDto } from './detail-model'

export interface ConversationDetailProps {
  detail: ConversationDetailDto
  inlineActions?: boolean
  /** 최종 검토(승인 게이트) 화면으로 넘어간다. 발송이 아니다. */
  onProceedToReview?: (args: { threadId: string; version: number }) => void
  onCopyDraft?: (threadId: string, text: string) => void
}

export function conversationScreenConfig(): ShellScreenConfig {
  return { mode: 'DETAIL', title: '대화' }
}

const BTN = 'inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-medium'

/** M13b 대화 상세. 원문 전체 · 소희 제안 · 대상 확인 · 검토 CTA. 전송 버튼은 없다. */
export function MobileConversationDetail({ detail, inlineActions = false, onProceedToReview, onCopyDraft }: ConversationDetailProps) {
  const ActionBar = inlineActions ? 'div' : StickyActionBar
  // 화면을 연 시점의 서버 값. 이후 서버 값이 달라지면 재검토를 요구한다.
  const [opened] = useState(detail.fingerprint)
  const gate = reviewGate(detail, opened)
  // 검토 화면으로 넘길 경로가 없는 배선(읽기 전용 마운트)에서는 CTA 를 열어 두지 않는다.
  const canProceed = gate.canProceed && Boolean(onProceedToReview)
  const gateMessage =
    gate.message ?? (gate.canProceed && !onProceedToReview ? '최종 검토 화면은 아직 연결되지 않았어요' : null)
  const { thread } = detail
  const chip = deliveryChip(detail.delivery)

  const gateMessageId = gateMessage ? `review-gate-message-${thread.id}` : undefined

  return (
    <div className={inlineActions ? 'w-full space-y-4 text-foreground' : 'mx-auto w-full max-w-2xl space-y-4 pb-28 text-foreground'}>
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">{thread.customerName}</h1>
        <p className="text-sm text-muted-foreground">{CHANNEL_LABEL[thread.channel]}</p>
      </header>

      <section aria-label="받은 글" className="space-y-2">
        {detail.complete ? null : (
          // 서버가 원문을 빠짐없이 읽지 못했다(200건 초과·글자 없는 행). 완전한 대화처럼 그리지 않는다.
          <p role="status" className="rounded-xl bg-muted px-3.5 py-2.5 text-sm leading-5 text-foreground">
            일부 원문만 불러왔어요. 확인되지 않은 대화가 더 있을 수 있어요.
          </p>
        )}
        {detail.messages.length === 0 ? (
          // 원문 0건을 '대화 없음'으로 단정하지 않는다. 서버 read-model 은 글자 없는 행을 건너뛰므로
          // 빈 배열이 곧 빈 대화는 아니다.
          <p role="status" className="rounded-xl bg-muted px-3.5 py-2.5 text-sm leading-5 text-foreground">
            아직 확인된 원문이 없어요. 대화가 비어 있거나, 원문을 읽지 못했을 수 있어요.
          </p>
        ) : (
          <ol className="space-y-2">
            {detail.messages.map(m => (
              <li
                key={m.id}
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-base leading-6 ${
                  m.fromCustomer ? 'bg-secondary text-secondary-foreground' : 'ml-auto bg-primary/10 text-foreground'
                }`}
              >
                <span className="sr-only">{m.fromCustomer ? '손님: ' : '가게: '}</span>
                {m.text}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="소희 답안" className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">소희 답안</h2>
          <span
            data-tone={chip.tone}
            className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
          >
            {chip.label}
          </span>
        </div>
        {thread.draft ? (
          <>
            <p className="whitespace-pre-wrap break-words text-base leading-6">{thread.draft.text}</p>
            <p className="text-sm leading-5 text-muted-foreground">
              {thread.draft.sources.length > 0
                ? `참고: ${thread.draft.sources.join(', ')}`
                : '아직 확인 중이에요'}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">소희 답안이 아직 없어요</p>
        )}
        <p className="text-sm leading-5">
          <span className="text-muted-foreground">보낼 곳 </span>
          {detail.targetLabel ?? '확인하지 못했어요'}
        </p>
      </section>

      {gateMessage ? (
        <p
          id={gateMessageId}
          role="status"
          className="rounded-xl bg-muted px-3 py-2 text-sm leading-5 text-foreground"
        >
          {gateMessage}
        </p>
      ) : null}

      <ActionBar>
        {thread.draft && gate.path.kind === 'manual' ? (
          <button
            type="button"
            className={`${BTN} bg-muted text-foreground`}
            onClick={() => onCopyDraft?.(thread.id, thread.draft!.text)}
          >
            답안 복사
          </button>
        ) : null}
        <button
          type="button"
          disabled={!canProceed}
          aria-disabled={!canProceed}
          aria-describedby={!canProceed ? gateMessageId : undefined}
          title={!canProceed ? (gateMessage ?? undefined) : undefined}
          className={`${BTN} ${canProceed ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          onClick={() => canProceed && onProceedToReview?.({ threadId: thread.id, version: detail.version })}
        >
          최종 검토로 넘어가기
        </button>
      </ActionBar>
    </div>
  )
}
