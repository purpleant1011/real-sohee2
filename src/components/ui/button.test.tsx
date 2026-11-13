import { createRef } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'
import { Tabs } from './tabs'

describe('Button', () => {
  it('keeps its accessible name and has a touch-safe minimum height', () => {
    render(<Button aria-label="콘텐츠 승인">승인</Button>)

    expect(screen.getByRole('button', { name: '콘텐츠 승인' })).toHaveStyle({ minHeight: '44px' })
  })

  it('keeps icon-only controls at least 44px wide and tall without blocking wider styles', () => {
    render(
      <Button aria-label="알림 닫기" style={{ minHeight: '1px', minWidth: '1px', width: '72px' }}>
        {null}
      </Button>,
    )

    const button = screen.getByRole('button', { name: '알림 닫기' })
    expect(button).toHaveStyle({ minHeight: 'max(44px, 1px)', minWidth: 'max(44px, 1px)', width: '72px' })
  })

  it('forwards a ref and native button attributes while defaulting to type button', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} className="custom-button" style={{ color: 'rgb(1, 2, 3)' }} disabled>
        저장
      </Button>,
    )

    const button = screen.getByRole('button', { name: '저장' })
    expect(ref.current).toBe(button)
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toBeDisabled()
    expect(button).toHaveClass('custom-button')
    expect(button).toHaveStyle({ color: 'rgb(1, 2, 3)' })
  })
})

describe('Tabs', () => {
  const tabs = [
    { id: 'overview', label: '개요', content: '개요 내용' },
    { id: 'activity', label: '활동', content: '활동 내용' },
    { id: 'settings', label: '설정', content: '설정 내용' },
  ]

  it('connects tabs to their selected panel and selects with a click', () => {
    render(<Tabs aria-label="작업 영역" tabs={tabs} />)

    const tablist = screen.getByRole('tablist', { name: '작업 영역' })
    const overview = screen.getByRole('tab', { name: '개요' })
    const activity = screen.getByRole('tab', { name: '활동' })
    expect(tablist).toContainElement(overview)
    expect(overview).toHaveAttribute('aria-controls')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', overview.id)

    fireEvent.click(activity)
    expect(activity).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('활동 내용')
  })

  it('moves focus and selection with ArrowRight, ArrowLeft, Home, and End', () => {
    render(<Tabs aria-label="작업 영역" tabs={tabs} />)

    const tablist = screen.getByRole('tablist', { name: '작업 영역' })
    const overview = within(tablist).getByRole('tab', { name: '개요' })
    const activity = within(tablist).getByRole('tab', { name: '활동' })
    const settings = within(tablist).getByRole('tab', { name: '설정' })

    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    expect(activity).toHaveFocus()
    expect(activity).toHaveAttribute('aria-selected', 'true')
    expect(overview).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(activity, { key: 'End' })
    expect(settings).toHaveFocus()
    fireEvent.keyDown(settings, { key: 'Home' })
    expect(overview).toHaveFocus()
    fireEvent.keyDown(overview, { key: 'ArrowLeft' })
    expect(settings).toHaveFocus()
  })

  it('keeps controlled selection with its caller while reporting keyboard changes', () => {
    const onValueChange = vi.fn()
    render(<Tabs aria-label="작업 영역" tabs={tabs} value="overview" onValueChange={onValueChange} />)

    const activity = screen.getByRole('tab', { name: '활동' })
    fireEvent.click(activity)

    expect(onValueChange).toHaveBeenCalledWith('activity')
    expect(screen.getByRole('tab', { name: '개요' })).toHaveAttribute('aria-selected', 'true')
    expect(activity).toHaveAttribute('aria-selected', 'false')
  })
})
