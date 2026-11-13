import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExampleCampaignsScreen } from './example-campaigns-screen'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ExampleCampaignsScreen', () => {
  it('mounts the proposal cards with example data', () => {
    render(<ExampleCampaignsScreen />)

    expect(screen.getByRole('heading', { name: '제안', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '캠페인 제안' })).toBeInTheDocument()
    expect(screen.getByText('빈자리 구조대')).toBeInTheDocument()
    expect(screen.getByText('다시 찾아오기')).toBeInTheDocument()
    expect(screen.getByText(/시술 후 관리 60분/)).toBeInTheDocument()
  })

  it('opens the approve button only for the proposal whose checks all passed', () => {
    render(<ExampleCampaignsScreen />)

    const buttons = screen.getAllByRole('button', { name: '문구 확인하고 승인' })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toBeEnabled()
    // 채널 발신 번호가 확인되지 않은 제안은 승인 버튼이 닫히고 이유를 함께 보여준다.
    expect(buttons[1]).toBeDisabled()
    expect(screen.getByText(/문자 발신 번호를 아직 확인하지 못했어요/)).toBeInTheDocument()
  })

  it('marks the example numbers so they are not read as real results', () => {
    render(<ExampleCampaignsScreen />)

    expect(screen.getByText(/예시 화면이에요/)).toBeInTheDocument()
    // 받을 고객 수·예상 예약 수 옆에 '예시' 표시가 붙는다.
    expect(document.querySelectorAll('[data-example-badge]')).toHaveLength(4)
  })

  it('never saves the approval or sends anything, and says so', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('example screen must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<ExampleCampaignsScreen />)

    fireEvent.click(screen.getAllByRole('button', { name: '문구 확인하고 승인' })[0])

    expect(screen.getByRole('status')).toHaveTextContent(
      '예시 화면이라 승인 내용을 저장하지 않아요. 실제 승인은 앱에서 해 주세요.',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
