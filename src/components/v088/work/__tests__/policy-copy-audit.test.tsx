import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RunningTasksView, DecisionQueueView, WaitingTasksView } from '../work-tab-views'
import { ChannelHealth } from '@/components/v088/command/channel-health'
import { SoheeJudgment } from '@/components/v088/command/sohee-judgment'
import { AgentsView } from '@/features/operator-agents/agents-view'

// Mocks
vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

describe('Policy Copy Audit - Prohibited Words & Accurate Copy (V1.2)', () => {
  it('RunningTasksView and DecisionQueueView must not claim Naver API auto publishing or exaggerated effects', () => {
    render(
      <>
        <RunningTasksView isTestAccount={true} />
        <DecisionQueueView isTestAccount={true} />
        <WaitingTasksView isTestAccount={true} />
      </>
    )

    // Prohibited/exaggerated claims must be gone
    expect(screen.queryByText(/네이버 블로그 API 포스팅 실행/)).toBeNull()
    expect(screen.queryByText(/상위 노출 → 주간 방문\/예약 문의 4~6건 증대/)).toBeNull()
    expect(screen.queryByText(/당근마켓 소식란 쿠폰 등록/)).toBeNull()
    expect(screen.queryByText(/네이버 블로그 및 SNS 자동 발행 대기열 연결/)).toBeNull()
    expect(screen.queryByText(/네이버 블로그 정상 노출 HTTP 200 확인/)).toBeNull()

    // Truthful, mitigated copy must be present
    expect(screen.getByText('네이버 블로그 [봄맞이 매장 대표 가이드] 원고 준비 및 복사')).toBeInTheDocument()
    expect(screen.getByText('동네 대표 키워드 검색 시 정보 노출 지원 및 매장 인지도 향상')).toBeInTheDocument()
    expect(screen.getByText('첫 방문 고객 혜택 안내를 통한 유휴 시간대 예약 문의 증대 기대')).toBeInTheDocument()
  })

  it('ChannelHealth must not claim Daangn coupon auto dispatch or exaggerated automation', () => {
    render(<ChannelHealth />)

    expect(screen.queryByText('동네 소식 및 쿠폰 발송 연동')).toBeNull()
    expect(screen.getByText('동네 소식 원고 및 프로필 안내 구성')).toBeInTheDocument()
    expect(screen.getByText('원고 준비 및 복사 지원')).toBeInTheDocument()
  })

  it('SoheeJudgment must not claim fake Alimtalk 100% or Place 3rd ranking', () => {
    render(<SoheeJudgment />)

    expect(screen.queryByText(/카카오톡 알림톡 발송 성공률 100%/)).toBeNull()
    expect(screen.queryByText(/네이버 플레이스 순위 3위 유지/)).toBeNull()
    expect(screen.getByText(/SNS 콘텐츠 이상 징후 없음, 채널 연동 상태 및 안전성 가드레일 정상입니다/)).toBeInTheDocument()
  })

  it('AgentsView must not claim SmartEditor ONE browser session auto posting', () => {
    const { fireEvent } = require('@testing-library/react')
    render(<AgentsView />)

    // Check Missions tab (default or selected)
    expect(screen.queryByText(/네이버 블로그 SEO 시술 후기 발행/)).toBeNull()
    expect(screen.queryByText(/당근마켓 첫방문 15% 할인 쿠폰 배포/)).toBeNull()

    // Switch to 18대 MCP Registry tab
    const mcpTab = screen.getByRole('tab', { name: /18대 MCP Registry/ })
    fireEvent.click(mcpTab)

    expect(screen.queryByText(/스마트에디터 ONE 브라우저 세션 연동 고화질 SEO 포스팅/)).toBeNull()
    expect(screen.getByText(/네이버 블로그 복사용 원고 및 이미지 레이아웃 구성/)).toBeInTheDocument()
  })
})
