'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { MobileSheet } from '@/components/mobile-ui'
import { draftCountLabel } from './long-form'

export const EXPAND_LABEL = '더 보기'
export const COLLAPSE_LABEL = '접기'
export const LONG_DRAFT_LABEL = '길게 쓰기'
export const LONG_DRAFT_DESCRIPTION =
  '여기서 고친 내용은 입력창의 초안과 같아요. 보내면 한 통의 메시지로 전해져요.'

/**
 * 접힘 줄 수를 클래스로 고정한다. Tailwind 는 소스에 적힌 문자열만 만들기 때문에
 * `line-clamp-${n}` 같은 조립은 쓰지 않는다. `long-form.test.ts` 가
 * `BUBBLE_COLLAPSE_LINES` 와 어긋나지 않는지 검사한다.
 */
export const BUBBLE_CLAMP_CLASS = 'line-clamp-8'

const TOGGLE =
  'inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring'

/**
 * 긴 대화 본문. 접었을 때도 원문을 지우지 않고 '더 보기'로 그대로 펼친다.
 * 접힘은 CSS 줄 수 제한이라 화면 폭이 달라도 읽던 위치가 어긋나지 않는다.
 *
 * 레이아웃(말풍선 정렬·최대 폭)은 호출부가 정한다. 여기서는 본문과 토글만 그린다.
 */
export function LongBubbleText({
  text,
  collapsible,
  className,
}: {
  text: string
  /** 접을 분량인지. 판정은 `shouldCollapseBubble` 이 한다. */
  collapsible: boolean
  /** 말풍선 모양 클래스. 호출부의 기존 스타일을 그대로 받는다. */
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const clamped = collapsible && !expanded

  return (
    <>
      <p
        id={bodyId}
        className={`${className ?? ''} whitespace-pre-wrap ${clamped ? BUBBLE_CLAMP_CLASS : ''}`}
      >
        {text}
      </p>

      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded(current => !current)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className={TOGGLE}
        >
          {expanded ? COLLAPSE_LABEL : EXPAND_LABEL}
        </button>
      ) : null}
    </>
  )
}

export interface LongDraftSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy?: boolean
  placeholder?: string
}

/** 긴 원고를 편하게 고치는 전체 높이 편집기. 초안은 컴포저와 같은 상태를 쓴다. */
export function LongDraftSheet({
  open,
  onOpenChange,
  value,
  onChange,
  onSubmit,
  busy = false,
  placeholder,
}: LongDraftSheetProps) {
  const canSubmit = value.trim() !== '' && !busy
  const count = draftCountLabel(value)

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={LONG_DRAFT_LABEL}
      description={LONG_DRAFT_DESCRIPTION}
    >
      <div className="space-y-3 px-4 pb-4">
        <textarea
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label="메시지 내용 (길게 쓰기)"
          rows={10}
          disabled={busy}
          className="min-h-[40dvh] w-full resize-none rounded-2xl border border-input bg-background px-4 py-3 text-base leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{count ?? ''}</span>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="min-h-11 rounded-full px-6"
          >
            보내기
          </Button>
        </div>
      </div>
    </MobileSheet>
  )
}
