// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import {
  BUBBLE_CLAMP_CLASS,
  COLLAPSE_LABEL,
  EXPAND_LABEL,
  LONG_DRAFT_LABEL,
  LongBubbleText,
  LongDraftSheet,
} from './chat-long-form'
import { BUBBLE_COLLAPSE_CHARS, BUBBLE_COLLAPSE_LINES } from './long-form'

const LONG_TEXT = '가'.repeat(BUBBLE_COLLAPSE_CHARS)

describe('LongBubbleText', () => {
  it('짧은 글에는 펼치기 버튼을 만들지 않는다', () => {
    render(<LongBubbleText text="초안을 준비했어요." collapsible={false} />)

    expect(screen.queryByRole('button', { name: EXPAND_LABEL })).toBeNull()
  })

  it('긴 글은 접힌 채로 원문을 그대로 담고 펼치기를 제공한다', () => {
    render(<LongBubbleText text={LONG_TEXT} collapsible />)

    const body = screen.getByText(LONG_TEXT)
    expect(body).toHaveClass(BUBBLE_CLAMP_CLASS)
    // 접어도 원문은 지우지 않는다(말줄임은 CSS 로만 한다).
    expect(body).toHaveTextContent(LONG_TEXT)
    expect(screen.getByRole('button', { name: EXPAND_LABEL })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('펼치면 접힘을 풀고 다시 접을 수 있다', () => {
    render(<LongBubbleText text={LONG_TEXT} collapsible />)

    fireEvent.click(screen.getByRole('button', { name: EXPAND_LABEL }))

    const expanded = screen.getByRole('button', { name: COLLAPSE_LABEL })
    expect(expanded).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(LONG_TEXT)).not.toHaveClass(BUBBLE_CLAMP_CLASS)

    fireEvent.click(expanded)

    expect(screen.getByText(LONG_TEXT)).toHaveClass(BUBBLE_CLAMP_CLASS)
    expect(screen.getByRole('button', { name: EXPAND_LABEL })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('펼치기 버튼이 본문을 가리킨다', () => {
    render(<LongBubbleText text={LONG_TEXT} collapsible />)

    const body = screen.getByText(LONG_TEXT)
    const toggle = screen.getByRole('button', { name: EXPAND_LABEL })
    expect(toggle).toHaveAttribute('aria-controls', body.id)
    expect(body.id).not.toBe('')
  })

  it('접힘 줄 수 클래스가 줄 수 상수와 어긋나지 않는다', () => {
    expect(BUBBLE_CLAMP_CLASS).toBe(`line-clamp-${BUBBLE_COLLAPSE_LINES}`)
  })
})

describe('LongDraftSheet', () => {
  function Harness({ initial = '', busy = false }: { initial?: string; busy?: boolean }) {
    const [open, setOpen] = useState(true)
    const [value, setValue] = useState(initial)
    return (
      <LongDraftSheet
        open={open}
        onOpenChange={setOpen}
        value={value}
        onChange={setValue}
        onSubmit={() => {}}
        busy={busy}
      />
    )
  }

  it('닫혀 있으면 편집기를 그리지 않는다', () => {
    render(
      <LongDraftSheet
        open={false}
        onOpenChange={() => {}}
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    )

    expect(screen.queryByRole('dialog', { name: LONG_DRAFT_LABEL })).toBeNull()
  })

  it('열리면 같은 초안을 편집할 수 있다', () => {
    render(<Harness initial="긴 원고" />)

    const dialog = screen.getByRole('dialog', { name: LONG_DRAFT_LABEL })
    const textarea = within(dialog).getByLabelText('메시지 내용 (길게 쓰기)')
    expect(textarea).toHaveValue('긴 원고')

    fireEvent.change(textarea, { target: { value: '고친 원고' } })
    expect(textarea).toHaveValue('고친 원고')
  })

  it('초안이 비면 보낼 수 없다', () => {
    render(<Harness initial="" />)

    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()
  })

  it('보내기를 누르면 onSubmit 을 한 번 부른다', () => {
    const onSubmit = vi.fn()
    render(
      <LongDraftSheet
        open
        onOpenChange={() => {}}
        value="보낼 원고"
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('전송 중에는 고치거나 다시 보낼 수 없다', () => {
    render(<Harness initial="보낼 원고" busy />)

    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()
    expect(screen.getByLabelText('메시지 내용 (길게 쓰기)')).toBeDisabled()
  })

  it('긴 초안에는 글자 수를 보여 준다', () => {
    render(<Harness initial={'가'.repeat(250)} />)

    expect(screen.getByText('250자')).toBeInTheDocument()
  })
})
