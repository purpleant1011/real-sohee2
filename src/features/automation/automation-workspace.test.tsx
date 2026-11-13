import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AutomationWorkspace } from './automation-workspace'

describe('AutomationWorkspace', () => {
  it('renders weekly schedule by default with routine tasks and real-time rules', () => {
    render(<AutomationWorkspace />)

    expect(screen.getByText(/자동화 & 소희의 근무표/i)).toBeInTheDocument()
    expect(screen.getByText(/소희의 주간 근무표/i)).toBeInTheDocument()
    expect(screen.getByText(/월요일 정기 루틴 업무/i)).toBeInTheDocument()
    expect(screen.getByText(/실시간 알림 확인 및 응대 규칙/i)).toBeInTheDocument()
  })

  it('switches between days in the weekly schedule', () => {
    render(<AutomationWorkspace />)

    const tueBtn = screen.getByRole('tab', { name: /화요일/i })
    fireEvent.click(tueBtn)

    expect(screen.getByText(/화요일 정기 루틴 업무/i)).toBeInTheDocument()
  })

  it('switches to automation studio wizard and channel trust badges tab', () => {
    render(<AutomationWorkspace />)

    const wizardTab = screen.getByRole('button', { name: /자동화 생성 마법사/i })
    fireEvent.click(wizardTab)
    expect(screen.getByText(/새 자동화 만들기/i)).toBeInTheDocument()

    const channelTab = screen.getByRole('button', { name: /채널별 연동 신뢰 뱃지/i })
    fireEvent.click(channelTab)
    expect(screen.getByText(/채널별 연동 신뢰 뱃지 & 실행 정책/i)).toBeInTheDocument()
    expect(screen.getByText(/원고 준비 지원/i)).toBeInTheDocument()
    expect(screen.queryByText(/스마트에디터 ONE 자동화/i)).not.toBeInTheDocument()
  })

  it('reflects V1.2 policy: Naver Blog and Karrot are for preparation, Instagram for auto publishing', () => {
    render(<AutomationWorkspace />)

    // Old text implying Naver auto publishing must not exist
    expect(screen.queryByText(/네이버 블로그, 당근마켓에 소희가 예약된 주간 일정에 맞춰 자동으로 콘텐츠를 발행하고/)).not.toBeInTheDocument()
    expect(screen.queryByText(/인스타그램 스토리 포스팅/)).not.toBeInTheDocument()

    // New V1.2 text
    expect(screen.getByText(/인스타그램은 예약된 일정에 맞춰 자동으로 콘텐츠를 발행하고, 네이버 블로그와 당근마켓은 원고·사진을 준비하며 실시간으로 응대합니다\./)).toBeInTheDocument()
    expect(screen.getByText(/인스타그램 피드 포스팅/)).toBeInTheDocument()
    expect(screen.getAllByText('초안 자동 준비').length).toBeGreaterThanOrEqual(2)
  })

  it('reflects connected channels from /api/channels matching the channels view source', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/channels') {
        return {
          ok: true,
          json: async () => ({
            instagram: { status: 'VERIFIED', verified: true, supportedPublish: true, accountName: '@my_shop' },
            threads: { status: 'NOT_CONNECTED' },
            naverBlog: { status: 'NOT_CONNECTED' },
            daangn: { status: 'NOT_CONNECTED' },
          }),
        }
      }
      return { ok: false, json: async () => ({}) }
    }))

    render(<AutomationWorkspace />)

    // 인스타그램이 정상 연동으로 반영되어야 함
    expect(await screen.findByText('@my_shop')).toBeInTheDocument()
    const igCard = screen.getByText('인스타그램 피드/릴스').closest('div')
    expect(igCard).toHaveTextContent('정상 연동')
  })
})
