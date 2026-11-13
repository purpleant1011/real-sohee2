import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FocusModeToggle } from './focus-mode-toggle'

describe('FocusModeToggle', () => {
  it('시술 집중 모드 On일 때 정확한 문구와 aria-pressed="true"를 제공한다', () => {
    const onToggle = vi.fn()
    render(<FocusModeToggle isFocusMode={true} onToggle={onToggle} />)

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('시술 집중 모드 켜짐 (긴급한 예약·알림 실패만 안내해요)')).toBeInTheDocument()
  })

  it('시술 집중 모드 Off일 때 꺼짐 상태 문구와 aria-pressed="false"를 제공한다', () => {
    const onToggle = vi.fn()
    render(<FocusModeToggle isFocusMode={false} onToggle={onToggle} />)

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('시술 집중 모드 꺼짐')).toBeInTheDocument()
  })

  it('버튼 클릭 시 onToggle 콜백을 반전된 값으로 호출한다', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<FocusModeToggle isFocusMode={false} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledWith(true)

    rerender(<FocusModeToggle isFocusMode={true} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('최소 44px 터치 타깃 접근성을 지원한다', () => {
    render(<FocusModeToggle isFocusMode={false} onToggle={vi.fn()} />)
    const button = screen.getByRole('button')
    expect(button.className).toMatch(/min-h-(?:11|12|\[44px\])|h-11|h-12/)
  })

  it('disabled 상태일 때 클릭이 비활성화된다', () => {
    const onToggle = vi.fn()
    render(<FocusModeToggle isFocusMode={false} onToggle={onToggle} disabled />)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
