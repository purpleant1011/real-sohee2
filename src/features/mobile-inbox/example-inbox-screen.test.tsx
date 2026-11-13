import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExampleInboxScreen } from './example-inbox-screen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ExampleInboxScreen', () => {
  it('mounts the inbox list with example data and says it is an example', () => {
    render(<ExampleInboxScreen />)

    expect(screen.getByText(/예시 화면이에요/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '소통함', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '소통 목록' })).toBeInTheDocument()
    expect(screen.getByText('김예시')).toBeInTheDocument()
  })

  it('explains that the reply buttons do not open or copy anything', () => {
    render(<ExampleInboxScreen />)

    fireEvent.click(screen.getByRole('button', { name: '답안 검토하기' }))
    expect(screen.getByRole('status')).toHaveTextContent('예시 화면이라 대화 상세로 넘어가지 않아요.')

    fireEvent.click(screen.getByRole('button', { name: '답안 복사' }))
    expect(screen.getByRole('status')).toHaveTextContent('예시 화면이라 답안을 복사하지 않아요.')
  })

  it('never fetches or sends anything from the example screen', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('example screen must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<ExampleInboxScreen />)

    fireEvent.click(screen.getByRole('button', { name: '답안 복사' }))

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
