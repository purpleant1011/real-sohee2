'use client'

import { useState } from 'react'
import {
  AlertCircle,
  Ban,
  Heart,
  HelpCircle,
  MessageCircle,
  RotateCw,
  Send,
  ShieldAlert,
  Smile,
  Trash2,
  UserCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { InstagramIcon } from './engagement-icons'
import { generateCommentToneOptions, type CommentToneKey } from './comment-tones'
import { formatRelativeTime } from './engagement-time'
import type { EngagementCommentItem } from './types'

export interface EngagementCommentCardProps {
  comment: EngagementCommentItem
  sendEnabled: boolean
  onOpenSendDialog: (comment: EngagementCommentItem, replyText: string) => void
  onRegenerateDraft: (commentId: string) => Promise<void>
  onDismiss: (commentId: string) => Promise<void>
  onUpdateDraft?: (commentId: string, text: string) => Promise<void>
}

function getClassificationIcon(classification: string | null) {
  switch (classification) {
    case 'THANKS':
      return <Heart aria-hidden="true" className="size-3.5 shrink-0" />
    case 'GREETING':
      return <Smile aria-hidden="true" className="size-3.5 shrink-0" />
    case 'QUESTION':
      return <HelpCircle aria-hidden="true" className="size-3.5 shrink-0" />
    case 'COMPLAINT':
      return <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />
    case 'SENSITIVE':
      return <ShieldAlert aria-hidden="true" className="size-3.5 shrink-0" />
    case 'SPAM':
      return <Ban aria-hidden="true" className="size-3.5 shrink-0" />
    case 'NEEDS_HUMAN':
      return <UserCheck aria-hidden="true" className="size-3.5 shrink-0" />
    default:
      return null
  }
}

export function EngagementCommentCard({
  comment,
  sendEnabled,
  onOpenSendDialog,
  onRegenerateDraft,
  onDismiss,
  onUpdateDraft,
}: Readonly<EngagementCommentCardProps>) {
  const initialText = comment.draft?.draft_text ?? ''
  const [draftText, setDraftText] = useState(initialText)
  const [originalDraftText] = useState(initialText)
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedTone, setSelectedTone] = useState<CommentToneKey | null>('friendly')
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // 외부 재전송 가드(ANI-1778)
  const runExternalWrite = useExternalWriteGuard()
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const charLimit = comment.channel === 'threads' ? 500 : 2200
  const isCharOver = draftText.length > charLimit
  const isEditedAfterApproval =
    comment.status === 'APPROVED' && draftText !== originalDraftText

  const isEditable =
    comment.status === 'RECEIVED' ||
    comment.status === 'CLASSIFIED' ||
    comment.status === 'DRAFTED' ||
    comment.status === 'APPROVED'

  const isNeedsCheck = comment.status === 'NEEDS_CHECK' || comment.status === 'FAILED'
  const toneOptions = generateCommentToneOptions({
    commentText: comment.comment_text,
    authorHandle: comment.author_handle,
    baseDraftText: initialText,
  })

  const isSent = comment.status === 'SENT'
  const isDismissed = comment.status === 'DISMISSED'

  async function handleRegenerate() {
    setIsRegenerating(true)
    setActionError(null)
    try {
      await onRegenerateDraft(comment.id)
    } catch {
      setActionError('답글 초안을 다시 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsRegenerating(false)
    }
  }

  async function handleDismiss() {
    setIsDismissing(true)
    setActionError(null)
    try {
      await onDismiss(comment.id)
    } catch {
      setActionError('댓글을 무시 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsDismissing(false)
    }
  }

  function handleDraftChange(nextText: string) {
    setDraftText(nextText)
    setActionError(null)
    if (onUpdateDraft) {
      onUpdateDraft(comment.id, nextText).catch(() => {})
    }
  }

  return (
    <article
      aria-labelledby={`comment-heading-${comment.id}`}
      className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs transition-shadow duration-200 motion-reduce:transition-none space-y-4"
    >
      {/* Header chips & author & time */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Channel chip */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
            {comment.channel === 'instagram' ? (
              <InstagramIcon aria-hidden="true" className="size-3.5" />
            ) : (
              <MessageCircle aria-hidden="true" className="size-3.5" />
            )}
            <span>{comment.channel_label}</span>
          </span>

          {/* Author handle */}
          <span
            id={`comment-heading-${comment.id}`}
            className="text-sm font-bold text-foreground"
          >
            @{comment.author_handle}
          </span>

          {/* Relative time */}
          <time
            className="text-xs text-muted-foreground"
            dateTime={comment.comment_created_at}
          >
            {formatRelativeTime(comment.comment_created_at)}
          </time>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Classification chip with icon & Korean text */}
          {comment.classification_label ? (
            <Badge
              className="font-medium gap-1 px-2 py-0.5"
              variant="outline"
            >
              {getClassificationIcon(comment.classification)}
              <span>{comment.classification_label}</span>
            </Badge>
          ) : null}

          {/* Status badge */}
          <Badge
            className="px-2 py-0.5"
            variant={
              isSent
                ? 'success'
                : isNeedsCheck
                  ? 'warning'
                  : isDismissed
                    ? 'secondary'
                    : 'default'
            }
          >
            {comment.status_label}
          </Badge>
        </div>
      </div>

      {/* Comment text with 4-line clamp toggle */}
      <div className="space-y-1.5">
        <p
          className={`text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed ${
            isExpanded ? '' : 'line-clamp-4'
          }`}
        >
          {comment.comment_text}
        </p>
        {comment.comment_text.length > 120 ? (
          <button
            aria-expanded={isExpanded}
            className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm min-h-[32px] sm:min-h-[28px] inline-flex items-center cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
            type="button"
          >
            {isExpanded ? '접기' : '더 보기'}
          </button>
        ) : null}
      </div>

      {/* Action error / success inline notifications */}
      {actionError ? (
        <div
          aria-live="assertive"
          className="rounded-md bg-destructive/10 p-2.5 text-xs font-medium text-destructive"
          role="alert"
        >
          {actionError}
        </div>
      ) : null}

      {actionSuccess ? (
        <div
          aria-live="polite"
          className="rounded-md bg-state-ok-soft p-2.5 text-xs font-medium text-state-ok"
        >
          {actionSuccess}
        </div>
      ) : null}

      {/* 확인 필요 explanation banner */}
      {isNeedsCheck ? (
        <div className="space-y-3 rounded-lg border border-[var(--state-warn-line)] bg-state-warn-soft p-3.5 text-state-warn">
          <p className="text-xs leading-relaxed font-medium">
            답글이 올라갔는지 확인해 주세요. {comment.channel_label} 앱에서 확인한 뒤에 다시 보내지 말아 주세요.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              className="text-muted-foreground hover:text-foreground text-xs"
              disabled={isDismissing}
              onClick={handleDismiss}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trash2 aria-hidden="true" className="size-3.5 mr-1" />
              무시
            </Button>
            <Button
              className="bg-state-warn hover:bg-state-warn/90 text-state-warn-soft font-bold text-xs gap-1"
              size="sm"
              type="button"
              onClick={async () => {
                const outcome = await runExternalWrite('send', `comment:${comment.id}`, async () => {
                  try {
                    const res = await fetch(`/api/workspaces/${comment.workspace_id}/engagement/comments/${comment.id}/retry`, { method: 'POST' })
                    if (res.ok) {
                      window.location.reload()
                    }
                  } catch {}
                })
                if (!outcome.ran) setActionError(outcome.decision.message)
              }}
            >
              <RotateCw aria-hidden="true" className="size-3.5 mr-1" />
              다시 확인 후 전송
            </Button>
          </div>
        </div>
      ) : null}

      {/* SENT cards (read-only) */}
      {isSent ? (
        <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/40 p-3.5">
          <span className="text-xs font-semibold text-muted-foreground">보낸 답글</span>
          <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {draftText || '답글이 정상적으로 등록되었습니다.'}
          </p>
        </div>
      ) : null}

      {/* DISMISSED cards (read-only) */}
      {isDismissed ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <span>무시 처리된 댓글이에요.</span>
          {draftText ? (
            <p className="mt-1 rounded-md bg-muted/30 p-2 text-foreground/70 whitespace-pre-wrap">
              {draftText}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Editable draft area for actionable comments */}
      {isEditable ? (
        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            {/* 3대 톤 칩 선택 */}
            <div className="flex flex-wrap items-center gap-1.5 pb-1">
              <span className="text-[11px] font-semibold text-muted-foreground mr-0.5">추천 답글 톤:</span>
              {toneOptions.map((opt) => {
                const isSelected = selectedTone === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setSelectedTone(opt.key)
                      handleDraftChange(opt.text)
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'bg-secondary/70 hover:bg-secondary text-secondary-foreground border border-border/40'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>

            <div className="flex items-center justify-between">
              <label
                className="text-xs font-bold text-foreground"
                htmlFor={`draft-text-${comment.id}`}
              >
                답글 초안
              </label>
              <span
                className={`text-xs ${
                  isCharOver
                    ? 'font-bold text-destructive'
                    : 'text-muted-foreground'
                }`}
              >
                {draftText.length.toLocaleString()} / {charLimit.toLocaleString()}자
              </span>
            </div>

            <Textarea
              className="text-base md:text-sm leading-relaxed"
              id={`draft-text-${comment.id}`}
              onChange={(e) => handleDraftChange(e.target.value)}
              placeholder="소희가 작성할 답글을 입력해 주세요."
              rows={3}
              value={draftText}
            />
          </div>

          {/* Re-approval notice when edited after approval */}
          {isEditedAfterApproval ? (
            <p className="text-xs font-medium text-state-warn">
              내용을 고쳤어요. 보내기 전에 다시 확인해 주세요.
            </p>
          ) : null}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  className="min-h-[44px]"
                  disabled={isRegenerating || isDismissing}
                  onClick={handleRegenerate}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <RotateCw
                    aria-hidden="true"
                    className={`size-3.5 mr-1 ${isRegenerating ? 'animate-spin' : ''}`}
                  />
                  다시 만들기
                </Button>

                <Button
                  className="min-h-[44px] text-muted-foreground hover:text-foreground"
                  disabled={isRegenerating || isDismissing}
                  onClick={handleDismiss}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-3.5 mr-1" />
                  무시
                </Button>
              </div>

              <div className="flex flex-col items-end gap-1">
                <Button
                  className="min-h-[44px]"
                  disabled={!sendEnabled || !draftText.trim() || isCharOver}
                  onClick={() => onOpenSendDialog(comment, draftText)}
                  size="sm"
                  type="button"
                  variant="default"
                >
                  <Send aria-hidden="true" className="size-3.5 mr-1" />
                  이 답글 보내기
                </Button>
                {!sendEnabled ? (
                  <span className="text-[11px] text-muted-foreground">
                    답글 보내기가 아직 꺼져 있어요
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}
