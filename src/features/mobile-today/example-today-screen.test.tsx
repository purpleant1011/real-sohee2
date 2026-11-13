// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExampleTodayScreen } from './example-today-screen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ExampleTodayScreen', () => {
  it('mounts the today screen with example data', () => {
    render(<ExampleTodayScreen />)

    expect(screen.getByRole('heading', { name: '오늘, 소희와 함께' })).toBeInTheDocument()
    expect(screen.getByText(/예시 가게/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '다음 행동' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '게시 전 최종 확인이 필요해요' })).toBeInTheDocument()
    expect(screen.getByText('소희의 업무 기록')).toBeInTheDocument()
  })

  it('marks itself as an example and never draws counts or metrics', () => {
    const { container } = render(<ExampleTodayScreen />)

    expect(screen.getByText(/예시 화면이에요/)).toBeInTheDocument()
    // 건수는 실제 확인 건수처럼 읽히지 않도록 그리지 않는다(와이어프레임의 "2건/1건"은 자리 표시용).
    expect(screen.getByRole('heading', { name: '지금 확인할 일' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\d+건/)
    // 확인된 결과는 근거가 없으므로 숫자 대신 이유를 보여준다.
    expect(screen.getByText(/확인된 결과가 생기면/)).toBeInTheDocument()
    expect(screen.queryByText('근거 확인')).toBeNull()
    expect(container.querySelectorAll('[data-example-badge]')).toHaveLength(0)
  })

  it('never leaks the internal dataset code to the owner screen', () => {
    const { container } = render(<ExampleTodayScreen />)

    expect(container.textContent).not.toContain('EXAMPLE')
    expect(container.textContent).not.toContain('ACTUAL')
    expect(container.textContent).not.toContain('DEMO')
  })

  it('never sends a request', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('example screen must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)

    render(<ExampleTodayScreen />)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('says it will not open the delegate screen instead of navigating silently', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('example screen must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<ExampleTodayScreen />)

    fireEvent.click(screen.getByRole('button', { name: '소희에게 소식 맡기기' }))

    expect(
      screen.getByText('예시 화면이라 소식 맡기기 화면으로 넘어가지 않아요.'),
    ).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the autonomy control read-only and does not call the server', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('example screen must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<ExampleTodayScreen />)

    expect(screen.getByRole('region', { name: '소희 일하기' })).toBeInTheDocument()
    expect(screen.getByText('소희가 일할 준비가 됐어요')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '잠시 멈추기' }))
    })

    expect(
      screen.getByText('예시 화면이라 자율근무를 바꾸지 않아요. 실제 변경은 앱에서 해 주세요.'),
    ).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
