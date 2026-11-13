'use client'

import { Fragment, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, Send, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LongBubbleText, LongDraftSheet, LONG_DRAFT_LABEL } from './chat-long-form'
import { draftCountLabel, shouldCollapseBubble } from './long-form'
import {
  isSafeEvidenceHref,
  type ChatBubble,
  type ChatRole,
} from './transcript'
import {
  executionLabel,
  isExecutionVerified,
  needsOwnerDecision,
  readExecutionStage,
} from './execution-state'
import {
  CHAT_SEND_FAILED_NOTICE,
  failedSendNotice,
  type ChatSendResult,
} from './chat-send'

export const DEFAULT_EMPTY_LABEL = '아직 나눈 대화가 없어요.'
export const CHAT_COMPOSER_PLACEHOLDER = '소희에게 무엇을 맡길까요?'
export const CHAT_PENDING_LABEL = '전송 중'

export const DEFAULT_CHAT_SUGGESTIONS = [
  '이번 주 인스타 피드 게시물 만들어줘',
  '단골 고객 대상 카카오톡 메시지 작성해줘',
  '네이버 플레이스 소식 글 써줘',
] as const

const ROLE_LABELS: Record<ChatRole, string> = {
  owner: '사장님',
  sohee: '소희',
  system: '시스템',
}

/** 승인 화면 경로. id 는 경로 조각이 되므로 인코딩한다. */
export function approvalHref(approvalId: string): string {
  return `/app/approvals/${encodeURIComponent(approvalId)}`
}

function EvidenceLink({ label, href }: { label: string; href: string }) {
  // 모바일 R2 터치 타깃 게이트(44px): 증거 링크는 문장 속 인라인 링크가 아니라
  // 목록의 독립 탭 대상이므로 최소 높이를 준다(underline 은 링크 식별용으로 유지).
  const className =
    'inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 break-words focus-visible:outline-2 focus-visible:outline-ring'

  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    )
  }

  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  )
}

export function ChatBubbleItem({ bubble }: { bubble: ChatBubble }) {
  // transcript 정규화를 통과했더라도 렌더 직전에 한 번 더 검사한다(fail-closed).
  const evidence = bubble.evidence.filter(link => isSafeEvidenceHref(link.href))
  const isOwner = bubble.role === 'owner'

  return (
    <li
      data-chat-bubble
      data-role={bubble.role}
      data-pending={bubble.pending ? 'true' : undefined}
      className={
        isOwner
          ? 'flex flex-col items-end gap-1'
          : 'flex flex-col items-start gap-1'
      }
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          {ROLE_LABELS[bubble.role]}
        </span>
        {bubble.pending ? (
          <span role="status" className="text-xs text-muted-foreground">
            {CHAT_PENDING_LABEL}
          </span>
        ) : null}
      </div>

      <LongBubbleText
        text={bubble.text}
        collapsible={shouldCollapseBubble(bubble.text)}
        className={
          isOwner
            ? 'max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-base leading-relaxed text-primary-foreground'
            : 'w-full min-w-0 break-words text-[15px] leading-7 text-foreground'
        }
      />

      {evidence.length > 0 ? (
        <ul aria-label="근거 자료" className="space-y-1">
          {evidence.map(link => (
            <li key={`${bubble.id}:${link.href}`}>
              <EvidenceLink label={link.label} href={link.href} />
            </li>
          ))}
        </ul>
      ) : null}

      {bubble.approval ? (
        <section
          data-chat-approval={bubble.approval.id}
          aria-label="승인 제안"
          className="w-full space-y-2 rounded-2xl border border-border bg-card p-4"
        >
          <p className="text-base font-medium">{bubble.approval.title}</p>
          <Link
            href={approvalHref(bubble.approval.id)}
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            승인 화면에서 확인
          </Link>
        </section>
      ) : null}
    </li>
  )
}

export function ChatTranscript({
  bubbles,
  emptyLabel = DEFAULT_EMPTY_LABEL,
  work,
  onSelectSuggestion,
  suggestions = DEFAULT_CHAT_SUGGESTIONS,
}: {
  bubbles: readonly ChatBubble[]
  emptyLabel?: string
  work?: ReactNode
  onSelectSuggestion?: (suggestion: string) => void
  suggestions?: readonly string[]
}) {
  if (bubbles.length === 0) {
    return <>
      <div className="space-y-4 py-8 text-center">
        <div className="space-y-2">
          <p className="text-lg font-semibold">어떤 일을 함께 할까요?</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{emptyLabel}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">요청부터 작업 내역, 검토할 결과까지<br />이 대화에서 이어가요.</p>
        </div>
        {suggestions.length > 0 && onSelectSuggestion ? (
          <div className="flex flex-col gap-2 pt-2 text-left" aria-label="추천 질문">
            {suggestions.map(suggestion => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSelectSuggestion(suggestion)}
                className="flex min-h-11 items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 active:bg-muted"
              >
                <span>{suggestion}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {work}
    </>
  }

  const lastOwner = bubbles.findLastIndex(bubble => bubble.role === 'owner')
  const reply = bubbles.findIndex((bubble, index) => index > lastOwner && bubble.role === 'sohee')
  // 현재 실행의 기록만 최신 요청과 답변 사이에 둔다. 과거 답변에 새 기록을 붙이지 않는다.
  const workIndex = lastOwner < 0 ? bubbles.length - 1 : reply < 0 ? bubbles.length : reply
  return (
    <ol aria-label="대화 내용" className="space-y-6">
      {bubbles.map((bubble, index) => <Fragment key={bubble.id}>
        {work && index === workIndex ? <li className="list-none">{work}</li> : null}
        <ChatBubbleItem bubble={bubble} />
      </Fragment>)}
      {work && workIndex === bubbles.length ? <li className="list-none">{work}</li> : null}
    </ol>
  )
}

export function ChatExecutionCard({
  stage,
  hasServerOutput,
}: {
  stage: unknown
  hasServerOutput?: unknown
}) {
  const known = readExecutionStage(stage)
  // 서버가 준 단계가 아니면 카드를 만들지 않는다(모르는 값을 진행으로 위장하지 않는다).
  if (!known) return null

  const verified = isExecutionVerified(known, hasServerOutput)

  return (
    <section
      data-chat-execution
      data-stage={known}
      data-verified={verified ? 'true' : undefined}
      aria-label="업무 진행 상황"
      className="space-y-1 rounded-2xl border border-border bg-card p-4"
    >
      <p className="flex items-center gap-2 text-base font-medium">
        {verified ? (
          <ShieldCheck className="size-4" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
        {executionLabel(known)}
      </p>

      <p className="text-sm leading-relaxed text-muted-foreground">
        {verified
          ? '외부 결과까지 확인했어요.'
          : '확인되기 전에는 완료로 표시하지 않아요.'}
      </p>

      {needsOwnerDecision(known) ? (
        <p className="text-sm font-medium">사장님 확인이 필요해요.</p>
      ) : null}
    </section>
  )
}

export interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy?: boolean
  notice?: string | null
  placeholder?: string
  disabled?: boolean
}

/** 표시 전용 컴포저. 초안 상태는 호스트가 들고 있다. */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  busy = false,
  notice = null,
  placeholder = CHAT_COMPOSER_PLACEHOLDER,
  disabled = false,
}: ChatComposerProps) {
  // 긴 원고 편집기는 컴포저와 같은 초안을 보여 주는 별도 화면이라 열림 상태만 들고 있으면 된다.
  const [longDraftOpen, setLongDraftOpen] = useState(false)
  const canSubmit = value.trim() !== '' && !busy && !disabled
  const count = draftCountLabel(value)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit()
  }

  function handleLongDraftSubmit() {
    if (!canSubmit) return
    // 실패해도 초안은 남으므로 시트를 닫고 컴포저의 실패 알림으로 이어 준다.
    setLongDraftOpen(false)
    onSubmit()
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="메시지 보내기"
      className="space-y-2 border-t border-border bg-background p-3"
    >
      {notice ? (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setLongDraftOpen(true)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={longDraftOpen}
          className="px-2 text-sm font-medium text-muted-foreground"
        >
          {LONG_DRAFT_LABEL}
        </Button>
        {count ? (
          <span className="text-xs text-muted-foreground">{count}</span>
        ) : null}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label="메시지 내용"
          rows={1}
          disabled={disabled}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-3 text-base leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        <Button
          type="submit"
          aria-label="보내기"
          disabled={!canSubmit}
          className="size-11 shrink-0 rounded-full p-0"
        >
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <LongDraftSheet
        open={longDraftOpen}
        onOpenChange={setLongDraftOpen}
        value={value}
        onChange={onChange}
        onSubmit={handleLongDraftSubmit}
        busy={busy}
        placeholder={placeholder}
      />
    </form>
  )
}

export interface ChatComposerHostProps {
  onSend: (text: string) => Promise<ChatSendResult> | ChatSendResult
  placeholder?: string
  disabled?: boolean
}

/**
 * 초안·전송 상태를 들고 있는 컴포저. 셸 설정에는 이 요소를 넣고,
 * onSend 는 호출부에서 identity 를 고정해 넘긴다.
 */
export function ChatComposerHost({
  onSend,
  placeholder,
  disabled = false,
}: ChatComposerHostProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit() {
    const text = draft.trim()
    if (text === '' || busy) return

    setBusy(true)
    setNotice(null)

    let result: ChatSendResult
    try {
      result = await onSend(text)
    } catch {
      result = { ok: false, message: CHAT_SEND_FAILED_NOTICE }
    }

    const failure = failedSendNotice(result)
    if (failure !== null) {
      // 실패하면 입력을 지우지 않는다. 사장님이 바로 다시 보낼 수 있어야 한다.
      setNotice(failure)
    } else {
      setDraft('')
      setNotice(null)
    }

    setBusy(false)
  }

  return (
    <ChatComposer
      value={draft}
      onChange={setDraft}
      onSubmit={submit}
      busy={busy}
      notice={notice}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}

/** 진행 카드와 대화 본문을 함께 그리는 화면 본문. */
export function ChatBody({
  bubbles,
  stage,
  hasServerOutput,
  emptyLabel,
  children,
  work,
  onSelectSuggestion,
  suggestions,
}: {
  bubbles: readonly ChatBubble[]
  stage?: unknown
  hasServerOutput?: unknown
  emptyLabel?: string
  children?: ReactNode
  work?: ReactNode
  onSelectSuggestion?: (suggestion: string) => void
  suggestions?: readonly string[]
}) {
  return (
    <div className="space-y-4 py-4">
      {stage === undefined ? null : (
        <ChatExecutionCard stage={stage} hasServerOutput={hasServerOutput} />
      )}
      <ChatTranscript
        bubbles={bubbles}
        emptyLabel={emptyLabel}
        work={work}
        onSelectSuggestion={onSelectSuggestion}
        suggestions={suggestions}
      />
      {children}
    </div>
  )
}
