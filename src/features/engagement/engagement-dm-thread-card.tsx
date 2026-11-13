'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Clock,
  MessageSquare,
  RotateCw,
  Send,
  Trash2,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { InstagramIcon } from './engagement-icons'
import { formatRelativeTime } from './engagement-time'
import { DM_MAX_TEXT_LENGTH, DM_EXPIRED_KOREAN_MESSAGE } from './dm/constants'
import { CustomerInquiryReview } from '@/features/customers/customer-inquiry-review'
import type { InstagramDmThreadItem } from './dm/types'

export interface EngagementDmThreadCardProps {
  thread: InstagramDmThreadItem
  sendEnabled: boolean
  onOpenSendDialog: (thread: InstagramDmThreadItem, replyText: string) => void
  onSelectOption: (threadId: string, optionId: string) => Promise<void>
  onRegenerateDraft: (threadId: string) => Promise<void>
  onDismiss: (threadId: string) => Promise<void>
  onUpdateDraft?: (threadId: string, text: string) => Promise<void>
}

export function EngagementDmThreadCard({
  thread,
  sendEnabled,
  onOpenSendDialog,
  onSelectOption,
  onRegenerateDraft,
  onDismiss,
  onUpdateDraft,
}: Readonly<EngagementDmThreadCardProps>) {
  const initialText = thread.draft?.draft_text ?? ''
  const [draftText, setDraftText] = useState(initialText)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(
    thread.draft?.selected_option_id ?? (thread.draft?.options?.[0]?.id ?? null)
  )
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isExpired = thread.is_expired || thread.status === 'EXPIRED'
  const isSent = thread.status === 'SENT'
  const isNeedsCheck = thread.status === 'NEEDS_CHECK'
  const isDismissed = thread.status === 'DISMISSED'

  const charLimit = DM_MAX_TEXT_LENGTH
  const isCharOver = draftText.length > charLimit
  const canSend =
    !isExpired &&
    !isSent &&
    !isDismissed &&
    draftText.trim().length > 0 &&
    !isCharOver

  const options = thread.draft?.options ?? []


  async function handleOptionSelect(optionId: string) {
    setSelectedOptionId(optionId)
    const opt = options.find((o) => o.id === optionId)
    if (opt) {
      setDraftText(opt.draftText)
      try {
        await onSelectOption(thread.id, optionId)
      } catch (err: any) {
        console.error('[EngagementDmThreadCard] Option selection failed:', err)
      }
    }
  }

  async function handleRegenerate() {
    setIsRegenerating(true)
    setActionError(null)
    try {
      await onRegenerateDraft(thread.id)
    } catch (err: any) {
      setActionError(err?.message || '답장 초안을 다시 생성하지 못했어요.')
    } finally {
      setIsRegenerating(false)
    }
  }

  async function handleDismiss() {
    setIsDismissing(true)
    setActionError(null)
    try {
      await onDismiss(thread.id)
    } catch (err: any) {
      setActionError(err?.message || '대화를 숨기지 못했어요.')
    } finally {
      setIsDismissing(false)
    }
  }

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setDraftText(val)
    if (selectedOptionId) {
      // Clear selected chip if edited directly
      const opt = options.find((o) => o.id === selectedOptionId)
      if (opt && opt.draftText !== val) {
        setSelectedOptionId(null)
      }
    }
    if (onUpdateDraft) {
      void onUpdateDraft(thread.id, val)
    }
  }

  return (
    <article
      aria-label={`@${thread.customer_handle} 고객과의 1:1 메시지`}
      className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs space-y-4 transition-all"
    >
      {/* 1. Header: Customer handle, channel badge, 24h countdown, status badge */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <User aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-foreground truncate">
                @{thread.customer_handle}
              </span>
              <InstagramIcon aria-hidden="true" className="size-3.5 text-muted-foreground shrink-0" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {formatRelativeTime(thread.last_message_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 24-hour countdown badge */}
          <Badge
            variant={isExpired ? 'destructive' : 'secondary'}
            className="flex items-center gap-1 text-[11px] font-semibold"
          >
            <Clock aria-hidden="true" className="size-3" />
            <span>{thread.countdown_text}</span>
          </Badge>

          {/* Status badge: countdown_text 와 동일한 텍스트(예: [만료됨] [만료됨])인 경우 중복 렌더링 방지 */}
          {thread.status_label !== thread.countdown_text ? (
            <Badge
              variant={isSent ? 'outline' : isNeedsCheck ? 'destructive' : 'default'}
              className="text-[11px] font-semibold"
            >
              {thread.status_label}
            </Badge>
          ) : null}
        </div>
      </header>

      {/* 2. Expired Warning Banner (Hard Invariant 2) */}
      {isExpired ? (
        <aside
          aria-label="답장 가능 시간 만료 안내"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs sm:text-sm text-destructive flex items-start gap-2.5 shadow-2xs font-medium"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0 mt-0.5" />
          <p className="leading-relaxed">{DM_EXPIRED_KOREAN_MESSAGE}</p>
        </aside>
      ) : null}

      {/* 3. Messages Timeline */}
      <section aria-label="메시지 대화 내역" className="space-y-2.5 pt-1">
        {thread.messages && thread.messages.length > 0 ? (
          thread.messages.map((msg) => {
            const isCustomer = msg.sender_type === 'customer'
            return (
              <div
                key={msg.id || msg.provider_message_id}
                className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-muted-foreground">
                  <span>{isCustomer ? `@${thread.customer_handle}` : '소희 (매장)'}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(msg.sent_at)}</span>
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    isCustomer
                      ? 'bg-muted/70 text-foreground border border-border/50 rounded-tl-xs'
                      : 'bg-primary text-primary-foreground rounded-tr-xs font-normal'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            )
          })
        ) : (
          <div className="rounded-xl bg-muted/60 p-3.5 text-xs sm:text-sm text-foreground">
            <p className="text-[11px] text-muted-foreground mb-1">고객 메시지</p>
            <p className="leading-relaxed whitespace-pre-wrap">{thread.last_message_text}</p>
          </div>
        )}
      </section>

      {/* 4. Direction Options Selection Chips (Hard Invariant 3) */}
      {!isExpired && !isSent && !isDismissed ? (
        <section aria-label="답장 안내 방향 선택" className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground flex items-center gap-1">
              <MessageSquare aria-hidden="true" className="size-3.5 text-primary" />
              <span>추천 안내 방향</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isRegenerating}
              onClick={handleRegenerate}
              className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
            >
              <RotateCw aria-hidden="true" className={`size-3 ${isRegenerating ? 'animate-spin' : ''}`} />
              <span>방향 다시 생성</span>
            </Button>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">예약 가능 시간은 고객 수락·서비스·가격·예약표를 확인한 뒤 안내해 주세요.</p>

          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label="안내 방향 옵션"
          >
            {options.map((opt) => {
              const isSelected = selectedOptionId === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => handleOptionSelect(opt.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                      : 'border-border/80 bg-background text-foreground hover:bg-muted/60'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* 5. Live Draft Textarea & Send Control (Zero Auto-Send) */}
      {!isSent && !isDismissed ? (
        <section aria-label="답장 문안 작성 및 수정" className="space-y-2 pt-1">
          <div className="relative">
            <Textarea
              value={draftText}
              onChange={handleDraftChange}
              disabled={isExpired}
              placeholder={isExpired ? '24시간이 지나 답장을 보낼 수 없어요.' : '답장 문안을 입력하거나 추천 방향을 선택해 주세요.'}
              rows={3}
              className={`text-base md:text-sm leading-relaxed resize-none p-3.5 transition-colors ${
                isExpired ? 'opacity-60 cursor-not-allowed bg-muted/40' : ''
              }`}
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1.5 px-1">
              <span className={isCharOver ? 'text-destructive font-bold' : ''}>
                {draftText.length} / {charLimit}자
              </span>
              <span>1:1 직접 발송만 지원해요</span>
            </div>
          </div>

          {actionError ? (
            <p className="text-xs text-destructive font-medium px-1">{actionError}</p>
          ) : null}

          {/* Action buttons */}
          <div className="flex flex-wrap items-start justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isDismissing}
              onClick={handleDismiss}
              className="text-xs text-muted-foreground hover:text-destructive gap-1 h-9"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              <span>숨기기</span>
            </Button>

            <CustomerInquiryReview threadId={thread.id} />

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!canSend || !sendEnabled}
              onClick={() => onOpenSendDialog(thread, draftText)}
              className="gap-1.5 text-xs font-bold h-9 px-4"
            >
              <Send aria-hidden="true" className="size-3.5" />
              <span>답장 보내기</span>
            </Button>
          </div>
        </section>
      ) : null}
    </article>
  )
}
