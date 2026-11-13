import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExampleLedgerScreen } from './example-ledger-screen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ExampleLedgerScreen', () => {
  it('mounts the ledger with example reservations and says it is an example', () => {
    render(<ExampleLedgerScreen />)

    expect(screen.getByText(/예시 화면이에요/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '예약표', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('김예시 · 속눈썹펌')).toBeInTheDocument()
    expect(screen.getByText('확정')).toBeInTheDocument()
    expect(screen.getByText('확정 대기')).toBeInTheDocument()
  })

  it('shows the overlapping reservation and the state mismatch as examples of those states', () => {
    render(<ExampleLedgerScreen />)

    expect(screen.getByRole('alert')).toHaveTextContent('같은 시간에 겹친 예약이 있어요')
    expect(screen.getByText('다른 화면과 상태가 달라요. 새로 확인해 주세요')).toBeInTheDocument()
  })

  it('keeps other workspaces out of the ledger', () => {
    render(<ExampleLedgerScreen />)

    expect(screen.queryByText('다른 가게 고객 · 커트')).not.toBeInTheDocument()
  })

  it('says it will not re-read the ledger instead of refreshing', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('example screen must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<ExampleLedgerScreen />)

    fireEvent.click(screen.getByRole('button', { name: '새로 확인' }))

    expect(screen.getByRole('status')).toHaveTextContent('예시 화면이라 다시 조회하지 않아요.')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('예시 화면에서 예약 등록 시트를 열면 제출이 비활성화되고 안내가 뜬다', () => {
    render(<ExampleLedgerScreen />)

    fireEvent.click(screen.getByRole('button', { name: '예약 등록' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/예시 화면에서는 예약을 등록할 수 없어요/)).toBeInTheDocument()
    const submitBtn = screen.getByRole('button', { name: '예약 등록' }) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)
  })
})
