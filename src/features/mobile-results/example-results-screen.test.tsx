// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExampleResultsScreen } from './example-results-screen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ExampleResultsScreen', () => {
  it('mounts the results screen with example data', () => {
    render(<ExampleResultsScreen />)

    expect(screen.getByRole('heading', { name: '성과', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/2026-10-17 ~ 2026-10-23 기준/)).toBeInTheDocument()
  })

  it('draws example numbers so the screen shape is reviewable', () => {
    render(<ExampleResultsScreen />)

    expect(screen.getByText('4건')).toBeInTheDocument()
    expect(screen.getByText('12건')).toBeInTheDocument()
    expect(screen.getByText('5건')).toBeInTheDocument()
    expect(screen.getByText('3건')).toBeInTheDocument()
    expect(screen.getByText('240,000원')).toBeInTheDocument()
    expect(screen.getByText('120,000원')).toBeInTheDocument()
    expect(screen.getByText(/약 70분을 아꼈어요/)).toBeInTheDocument()
  })

  it('marks every example number with an example badge and an explanation', () => {
    const { container } = render(<ExampleResultsScreen />)

    // 지표 카드 4 + 금액 2 + 시간 절감 1
    expect(container.querySelectorAll('[data-example-badge]')).toHaveLength(7)
    expect(screen.getAllByText('예시').length).toBe(7)
    expect(screen.getByText(/예시 화면이에요/)).toBeInTheDocument()
    // 예시 값은 '근거 확인'으로 표시하지 않는다.
    expect(screen.queryByText('근거 확인')).toBeNull()
    expect(screen.getAllByText('예시 값이에요')).toHaveLength(4)
  })

  it('never leaks the internal dataset code to the owner screen', () => {
    const { container } = render(<ExampleResultsScreen />)

    expect(container.textContent).not.toContain('EXAMPLE')
    expect(container.textContent).not.toContain('ACTUAL')
    expect(container.textContent).not.toContain('DEMO')
  })

  it('never sends a request', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('example screen must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)

    render(<ExampleResultsScreen />)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
