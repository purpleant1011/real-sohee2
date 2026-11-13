import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExampleCustomersScreen } from './example-customers-screen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ExampleCustomersScreen', () => {
  it('mounts the customer list with example data and says it is an example', () => {
    render(<ExampleCustomersScreen />)

    expect(screen.getByText(/예시 화면이에요/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '고객', level: 1 })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: '고객 목록' })
    expect(within(list).getByText('김예시')).toBeInTheDocument()
    // 동의를 철회한 고객은 이름이 마스킹된다.
    expect(within(list).getByText('이○시')).toBeInTheDocument()
  })

  it('R2 예시 화면은 전송 경로가 없으므로 연락 버튼을 막고 사유를 보여준다', () => {
    render(<ExampleCustomersScreen />)

    const list = screen.getByRole('list', { name: '고객 목록' })
    const buttons = within(list).getAllByRole('button', { name: /로 연락$/ }) as HTMLButtonElement[]
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) expect(button.disabled).toBe(true)
    expect(within(list).getAllByText('읽기 전용 화면이라 연락을 보낼 수 없어요').length).toBeGreaterThan(0)
  })

  it('keeps other workspaces out of the list', () => {
    render(<ExampleCustomersScreen />)

    expect(screen.queryByText('다른 가게 고객')).not.toBeInTheDocument()
  })

  it('never fetches or sends anything from the example screen', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('example screen must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<ExampleCustomersScreen />)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
