import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet'

function SheetHarness({ side }: { side?: 'right' | 'left' | 'top' | 'bottom' }) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button">업무 상세 열기</button>
      </SheetTrigger>
      <SheetContent side={side} aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>인스타·스레드 게시</SheetTitle>
        </SheetHeader>
        <input aria-label="메모" />
        <SheetClose>닫기</SheetClose>
      </SheetContent>
    </Sheet>
  )
}

describe('Sheet', () => {
  it('renders nothing until it is opened', () => {
    render(<SheetHarness />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '인스타·스레드 게시' })).not.toBeInTheDocument()
  })

  it('opens from its trigger as an accessible dialog and moves focus inside', async () => {
    render(<SheetHarness />)

    fireEvent.click(screen.getByRole('button', { name: '업무 상세 열기' }))

    const dialog = screen.getByRole('dialog', { name: '인스타·스레드 게시' })
    expect(dialog).toBeInTheDocument()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('closes with Escape and returns focus to the trigger', async () => {
    render(<SheetHarness />)

    const trigger = screen.getByRole('button', { name: '업무 상세 열기' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes from its own close control', async () => {
    render(<SheetHarness />)

    fireEvent.click(screen.getByRole('button', { name: '업무 상세 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps Tab and Shift+Tab focus inside the sheet', () => {
    render(<SheetHarness />)
    fireEvent.click(screen.getByRole('button', { name: '업무 상세 열기' }))

    const dialog = screen.getByRole('dialog', { name: '인스타·스레드 게시' })
    const input = screen.getByRole('textbox', { name: '메모' })
    const closeButton = screen.getByRole('button', { name: '닫기' })

    input.focus()
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('describes itself only when a description is rendered', () => {
    function DescribedSheet() {
      const [open, setOpen] = useState(true)

      return (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent>
            <SheetTitle>업무 상세</SheetTitle>
            <SheetDescription>확인할 내용을 읽어 주세요.</SheetDescription>
          </SheetContent>
        </Sheet>
      )
    }

    render(<DescribedSheet />)

    const dialog = screen.getByRole('dialog', { name: '업무 상세' })
    expect(dialog).toHaveAccessibleDescription('확인할 내용을 읽어 주세요.')
  })

  it.each([
    ['right', 'sheet-content'],
    ['left', 'sheet-content'],
    ['top', 'sheet-content'],
    ['bottom', 'sheet-content'],
  ] as const)('marks the %s side on its content', (side, slot) => {
    render(<SheetHarness side={side} />)
    fireEvent.click(screen.getByRole('button', { name: '업무 상세 열기' }))

    const content = document.querySelector(`[data-slot="${slot}"]`)
    expect(content).toHaveAttribute('data-side', side)
  })
})
