import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DelegateBar } from './delegate-bar'

describe('DelegateBar', () => {
  it('소희에게 일 맡기기 버튼과 보조 문구를 렌더링하고, 클릭 시 onDelegate를 호출한다', () => {
    const onDelegate = vi.fn()
    render(<DelegateBar onDelegate={onDelegate} />)

    const button = screen.getByRole('button', { name: '소희에게 일 맡기기' })
    expect(button).toBeInTheDocument()
    expect(screen.getByText('소희에게 일 맡기기')).toBeInTheDocument()
    expect(screen.getByText('무엇이든 말씀해 주세요')).toBeInTheDocument()

    fireEvent.click(button)
    expect(onDelegate).toHaveBeenCalledTimes(1)
  })

  it('터치 타깃이 56px 이상(min-h-14) 클래스를 포함한다', () => {
    render(<DelegateBar onDelegate={vi.fn()} />)
    const button = screen.getByRole('button', { name: '소희에게 일 맡기기' })
    expect(button.className).toContain('min-h-14')
  })
})
