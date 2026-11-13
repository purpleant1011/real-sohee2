import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { V085MorningBriefing } from './v085-morning-briefing'
import { V085ApprovalInbox } from './v085-approval-inbox'
import { V085CustomerOpportunities } from './v085-customer-opportunities'
import { V085BookingConversion } from './v085-booking-conversion'
import { V085TodaySchedule } from './v085-today-schedule'
import { V085CommandCenter } from './v085-command-center'

describe('V085 Home Components (Prototype V0.86)', () => {
  describe('V085MorningBriefing', () => {
    it('renders greeting, primary goal and current action', () => {
      render(
        <V085MorningBriefing
          ownerName="사장님"
          primaryGoalTitle="이번 주 빈 예약 3자리를 채울게요."
          primaryGoalDesc="최근 문의 고객과 반응이 좋았던 홍보 콘텐츠를 연결해 예약 전환을 만들고 있어요."
          currentActionText="미예약 문의 4명에게 재접촉 중"
          currentActionMeta="Instagram · 다음 실행 10:30"
        />
      )

      expect(screen.getByText(/좋은 아침이에요,/i)).toBeInTheDocument()
      expect(screen.getByText(/사장님/i)).toBeInTheDocument()
      expect(screen.getByText(/이번 주 빈 예약 3자리를 채울게요./i)).toBeInTheDocument()
      expect(screen.getByText(/미예약 문의 4명에게 재접촉 중/i)).toBeInTheDocument()
    })
  })

  describe('V085ApprovalInbox', () => {
    it('renders approval inbox with items and allows approval action', () => {
      render(<V085ApprovalInbox />)

      expect(screen.getByText(/사장님 확인 필요/i)).toBeInTheDocument()
      expect(screen.getByText(/자연스러움은 더하는 게 아니라, 나답게 정돈하는 것/i)).toBeInTheDocument()

      const approveButtons = screen.getAllByRole('button', { name: /승인/i })
      expect(approveButtons.length).toBeGreaterThan(0)

      fireEvent.click(approveButtons[0])
      expect(screen.getByText(/승인 완료/i)).toBeInTheDocument()
    })
  })

  describe('V085CustomerOpportunities', () => {
    it('renders customer opportunities with rationale and action button', () => {
      render(<V085CustomerOpportunities />)

      expect(screen.getByText(/오늘의 고객 기회/i)).toBeInTheDocument()
      expect(screen.getByText(/다음 주 토요일 맞춤 상담 가능할까요/i)).toBeInTheDocument()
      expect(screen.getByText(/예약 가능성 높음/i)).toBeInTheDocument()
    })
  })

  describe('V085BookingConversion', () => {
    it('renders booking conversion and sohee operating memos', () => {
      render(
        <V085BookingConversion
          currentBookings={8}
          memos={['우리 매장다운 이야기에 반응이 모이고 있어요']}
        />
      )

      expect(screen.getByText(/이번 주 예약 전환/i)).toBeInTheDocument()
      expect(screen.getByText('8')).toBeInTheDocument()
      expect(screen.getByText(/소희의 운영 메모/i)).toBeInTheDocument()
      expect(screen.getByText(/우리 매장다운 이야기에 반응이 모이고 있어요/i)).toBeInTheDocument()
    })
  })

  describe('V085TodaySchedule', () => {
    it('renders schedule timeline items', () => {
      render(<V085TodaySchedule />)

      expect(screen.getByText(/오늘 일정/i)).toBeInTheDocument()
      expect(screen.getByText(/소희의 근무표/i)).toBeInTheDocument()
      expect(screen.getByText('09:00')).toBeInTheDocument()
      expect(screen.getByText('10:30')).toBeInTheDocument()
      expect(screen.getByText('18:00')).toBeInTheDocument()
    })
  })

  describe('V085CommandCenter', () => {
    it('renders quick prompt chips and reports the plan builder is not connected yet', async () => {
      render(<V085CommandCenter />)

      expect(screen.getByText(/소희에게 지시하기/i)).toBeInTheDocument()

      const chip = screen.getByText(/화·목 오후 빈 예약 채워줘/i)
      fireEvent.click(chip)

      // 계획 수립 API 연결 전이므로 샘플 계획 대신 정직한 안내를 보여준다.
      const notice = await screen.findByText(/계획 세우기가 아직 연결되지 않았어요/i)
      expect(notice).toBeInTheDocument()
      expect(screen.queryByText(/소희가 이해한 실행 계획/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/이 계획대로 즉시 운영하기/i)).not.toBeInTheDocument()
    })

    it('focuses the command input when Cmd+K or / is pressed', () => {
      render(<V085CommandCenter />)
      const input = screen.getByPlaceholderText(/소희에게 이번 주 마케팅 목표나 업무를 지시하세요/i)
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      expect(document.activeElement).toBe(input)
    })
  })
})
