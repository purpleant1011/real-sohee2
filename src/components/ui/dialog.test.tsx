import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dialog } from './dialog'

function DialogHarness() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        새 항목 만들기
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="새 캠페인 만들기">
        <input aria-label="캠페인 이름" />
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('uses its title as an accessible name and moves focus into the dialog when opened', async () => {
    render(<DialogHarness />)

    fireEvent.click(screen.getByRole('button', { name: '새 항목 만들기' }))

    const dialog = screen.getByRole('dialog', { name: '새 캠페인 만들기' })
    expect(dialog).toBeInTheDocument()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('closes with Escape and restores focus to the opener', async () => {
    render(<DialogHarness />)

    const trigger = screen.getByRole('button', { name: '새 항목 만들기' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes from its visible close button', async () => {
    render(<DialogHarness />)

    fireEvent.click(screen.getByRole('button', { name: '새 항목 만들기' }))
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  })

  it('keeps Tab and Shift+Tab focus within its focus scope', () => {
    render(<DialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: '새 항목 만들기' }))

    const closeButton = screen.getByRole('button', { name: '닫기' })
    const input = screen.getByRole('textbox', { name: '캠페인 이름' })
    const dialog = screen.getByRole('dialog', { name: '새 캠페인 만들기' })
    input.focus()
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('tabs through a closed disclosure summary without focusing its hidden actions', () => {
    render(<Dialog open onOpenChange={() => {}} title="원고 검토">
      <button>전체 복사</button>
      <details><summary>추가 작업</summary><button>제목 복사</button></details>
      <a href="#write">글쓰기 열기</a>
    </Dialog>)
    const copy = screen.getByRole('button', { name: '전체 복사' })
    const summary = screen.getByText('추가 작업')
    const link = screen.getByRole('link', { name: '글쓰기 열기' })
    copy.focus()
    fireEvent.keyDown(copy, { key: 'Tab' })
    expect(summary).toHaveFocus()
    fireEvent.keyDown(summary, { key: 'Tab' })
    expect(link).toHaveFocus()
    fireEvent.keyDown(link, { key: 'Tab' })
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus()
  })

  it('includes disclosure actions only after they are opened', () => {
    render(<Dialog open onOpenChange={() => {}} title="원고 검토">
      <details open><summary>추가 작업</summary><button>제목 복사</button></details>
      <a href="#write">글쓰기 열기</a>
    </Dialog>)
    const summary = screen.getByText('추가 작업')
    summary.focus()
    fireEvent.keyDown(summary, { key: 'Tab' })
    expect(screen.getByRole('button', { name: '제목 복사' })).toHaveFocus()
  })

  it('excludes controls hidden by an ancestor or a disabled fieldset from tab wrapping', () => {
    render(<Dialog open onOpenChange={() => {}} title="원고 검토">
      <button>전체 복사</button>
      <div hidden><button>숨은 작업</button></div>
      <div style={{ display: 'none' }}><button>표시하지 않는 작업</button></div>
      <fieldset disabled><button>준비 전 작업</button></fieldset>
      <a href="#write">글쓰기 열기</a>
    </Dialog>)
    const copy = screen.getByRole('button', { name: '전체 복사' })
    copy.focus()
    fireEvent.keyDown(copy, { key: 'Tab' })
    expect(screen.getByRole('link', { name: '글쓰기 열기' })).toHaveFocus()
  })

  it('keeps focus on the dialog when its content has no focusable children', async () => {
    function StaticDialogHarness() {
      const [open, setOpen] = useState(false)

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            설명 열기
          </button>
          <Dialog open={open} onOpenChange={setOpen} title="읽기 전용 안내">
            <p>확인할 내용을 읽어 주세요.</p>
          </Dialog>
        </>
      )
    }

    render(<StaticDialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: '설명 열기' }))

    const dialog = screen.getByRole('dialog', { name: '읽기 전용 안내' })
    await waitFor(() => expect(dialog).toHaveFocus())

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus()
  })

  it('keeps focus safely in the dialog when its opener is removed before close', async () => {
    function RemovingOpenerHarness() {
      const [open, setOpen] = useState(false)

      return (
        <>
          {!open ? (
            <button type="button" onClick={() => setOpen(true)}>
              사라지는 열기
            </button>
          ) : null}
          <Dialog open={open} onOpenChange={setOpen} title="안전한 닫기">
            <p>내용</p>
          </Dialog>
        </>
      )
    }

    render(<RemovingOpenerHarness />)
    const trigger = screen.getByRole('button', { name: '사라지는 열기' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(document.body)
  })

  it('restores to a visible fallback when responsive layout hides the original opener', async () => {
    function ResponsiveHarness() {
      const [open, setOpen] = useState(false)
      const [hidden, setHidden] = useState(false)
      return <>
        <button data-review-trigger hidden={hidden} onClick={() => { setHidden(true); setOpen(true) }}>검토 열기</button>
        <button data-review-trigger>원고 복사</button>
        <Dialog open={open} onOpenChange={setOpen} title="반응형 검토" restoreFocusFallbackSelector="[data-review-trigger]">
          <p>검토 내용</p>
        </Dialog>
      </>
    }
    render(<ResponsiveHarness />)
    const opener = screen.getByRole('button', { name: '검토 열기' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: '원고 복사' })).toHaveFocus())
  })

  it('closes only the inner dialog on Escape and restores focus inside the outer dialog', async () => {
    function NestedDialogHarness() {
      const [outerOpen, setOuterOpen] = useState(false)
      const [innerOpen, setInnerOpen] = useState(false)

      return (
        <>
          <button type="button" onClick={() => setOuterOpen(true)}>
            상위 대화상자 열기
          </button>
          <Dialog open={outerOpen} onOpenChange={setOuterOpen} title="상위 설정">
            <button type="button" onClick={() => setInnerOpen(true)}>
              세부 설정 열기
            </button>
            <Dialog open={innerOpen} onOpenChange={setInnerOpen} title="세부 설정">
              <input aria-label="세부 이름" />
            </Dialog>
          </Dialog>
        </>
      )
    }

    render(<NestedDialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: '상위 대화상자 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '세부 설정 열기' }))

    const innerDialog = screen.getByRole('dialog', { name: '세부 설정' })
    fireEvent.keyDown(innerDialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '세부 설정' })).not.toBeInTheDocument())
    const outerDialog = screen.getByRole('dialog', { name: '상위 설정' })
    expect(outerDialog).toBeInTheDocument()
    await waitFor(() => expect(outerDialog).toContainElement(document.activeElement as HTMLElement))
  })

  it('locks document scrolling while open and restores existing inline overflow values when closed', async () => {
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'clip'
    document.body.style.overflow = 'scroll'

    render(<DialogHarness />)
    fireEvent.click(screen.getByRole('button', { name: '새 항목 만들기' }))

    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.documentElement.style.overflow).toBe('clip')
    expect(document.body.style.overflow).toBe('scroll')

    document.documentElement.style.overflow = previousHtmlOverflow
    document.body.style.overflow = previousBodyOverflow
  })

  it('keeps scrolling locked until the final nested dialog closes', async () => {
    function NestedLockHarness() {
      const [outerOpen, setOuterOpen] = useState(false)
      const [innerOpen, setInnerOpen] = useState(false)

      return (
        <>
          <button type="button" onClick={() => setOuterOpen(true)}>
            바깥 열기
          </button>
          <Dialog open={outerOpen} onOpenChange={setOuterOpen} title="바깥 대화상자">
            <button type="button" onClick={() => setInnerOpen(true)}>
              안쪽 열기
            </button>
            <Dialog open={innerOpen} onOpenChange={setInnerOpen} title="안쪽 대화상자">
              <p>안쪽 내용</p>
            </Dialog>
          </Dialog>
        </>
      )
    }

    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    render(<NestedLockHarness />)

    fireEvent.click(screen.getByRole('button', { name: '바깥 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '안쪽 열기' }))
    expect(document.documentElement.style.overflow).toBe('hidden')

    fireEvent.keyDown(screen.getByRole('dialog', { name: '안쪽 대화상자' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '안쪽 대화상자' })).not.toBeInTheDocument())
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(screen.getByRole('dialog', { name: '바깥 대화상자' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '바깥 대화상자' })).not.toBeInTheDocument())
    expect(document.documentElement.style.overflow).toBe(previousHtmlOverflow)
    expect(document.body.style.overflow).toBe(previousBodyOverflow)
  })
})
