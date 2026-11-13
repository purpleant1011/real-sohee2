import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EngagementMorningBriefing } from './engagement-morning-briefing'

describe('EngagementMorningBriefing', () => {
  it('renders morning briefing summary and key stats correctly', () => {
    render(
      <EngagementMorningBriefing
        commentCount={3}
        dmCount={1}
        reactionCount={30}
      />
    )

    expect(screen.getByText(/소희의 소셜 반응 일일 브리핑/i)).toBeDefined()
    expect(screen.getByText(/답글 대기 3건/i)).toBeDefined()
    expect(screen.getByText(/메시지 문의 1건/i)).toBeDefined()
    expect(screen.getByText(/공감 반응 30\+회/i)).toBeDefined()
  })

  it('renders helpful action guidance message', () => {
    render(
      <EngagementMorningBriefing
        commentCount={3}
        dmCount={1}
      />
    )

    expect(screen.getByText(/예약 문의는 24시간 내 답변이 중요해요/i)).toBeDefined()
  })

  it('renders auto-replied count banner when autoRepliedTodayCount is greater than 0', () => {
    render(
      <EngagementMorningBriefing
        commentCount={2}
        dmCount={0}
        autoRepliedTodayCount={3}
      />
    )

    expect(screen.getByText(/소희가 알아서 칭찬·인사 댓글 3건에 센스있게 자동 답글을 달았어요!/i)).toBeDefined()
    expect(screen.getByText(/사장님 시간 약 15분 절약/i)).toBeDefined()
  })

  it('renders upcoming planned post announcement banner when present', () => {
    render(
      <EngagementMorningBriefing
        upcomingPlannedPost={{
          themeTitle: '시술 후 오래 유지되는 홈케어 꿀팁',
          scheduledSlotLabel: '오늘 19:00',
        }}
      />
    )

    expect(screen.getByText(/소희가 준비한 정기 소식/i)).toBeDefined()
    expect(screen.getByText(/오늘 19:00 자동 발행 예정/i)).toBeDefined()
  })
})
