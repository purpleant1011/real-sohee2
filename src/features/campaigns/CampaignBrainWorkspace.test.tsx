import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CampaignBrainWorkspace } from './CampaignBrainWorkspace'

describe('CampaignBrainWorkspace — 측정되지 않은 성과를 지어내지 않는다', () => {
  it('크레딧을 넘기지 않으면 낙관적 기본값(40,000 SC)을 표시하지 않는다', () => {
    render(<CampaignBrainWorkspace workspaceId="ws-test" businessName="테스트가게" />)

    expect(screen.queryByText(/40,000\s*SC/)).not.toBeInTheDocument()
    expect(screen.getByText('크레딧 확인 필요')).toBeInTheDocument()
  })

  it('잔여 슬롯·예약 달성·확정 건수를 리터럴로 주장하지 않는다', () => {
    const { container } = render(<CampaignBrainWorkspace workspaceId="ws-test" businessName="테스트가게" />)
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/잔여 슬롯 12건/)
    expect(text).not.toMatch(/예약 15건 달성/)
    expect(text).not.toMatch(/현재 3건 확정/)
    expect(screen.getByText('측정 전')).toBeInTheDocument()
  })

  it('크레딧을 실제 값으로 넘기면 그 값을 표시한다', () => {
    render(<CampaignBrainWorkspace workspaceId="ws-test" businessName="테스트가게" availableCredits={1234} />)

    expect(screen.getByText('1,234 SC')).toBeInTheDocument()
    expect(screen.queryByText('크레딧 확인 필요')).not.toBeInTheDocument()
  })

  it('크레딧 0 은 0 으로 정직하게 표시한다 (충분하다고 말하지 않는다)', () => {
    render(<CampaignBrainWorkspace workspaceId="ws-test" businessName="테스트가게" availableCredits={0} />)

    expect(screen.getByText('0 SC')).toBeInTheDocument()
    expect(screen.queryByText('자율 실행 충분')).not.toBeInTheDocument()
  })

  it('가게 이름을 넘기지 않아도 특정 매장명(바이름)을 지어내지 않는다', () => {
    const { container } = render(<CampaignBrainWorkspace workspaceId="ws-test" />)

    expect(container.textContent).not.toContain('바이름')
  })

  it('V1.2 정책: 네이버 블로그 자동 송출/자동 발행 문구를 쓰지 않고 원고 준비로 표기한다', () => {
    render(<CampaignBrainWorkspace workspaceId="ws-test" businessName="테스트가게" />)

    // Old copy implying Naver auto publishing must NOT exist
    expect(screen.queryByText(/네이버 블로그 자동 송출/)).not.toBeInTheDocument()
    expect(screen.queryByText(/네이버 블로그 콘텐츠 2건 자동 발행 승인/)).not.toBeInTheDocument()

    // New V1.2 copy
    expect(screen.getByText(/인스타그램 자동 송출 & 네이버 블로그 원고 준비/)).toBeInTheDocument()
    expect(screen.getByText(/인스타그램 피드 자동 발행 및 네이버 블로그 콘텐츠 원고 준비 승인/)).toBeInTheDocument()

    // Anti-exaggeration assertions
    expect(screen.queryByText(/즉시 7일치/)).not.toBeInTheDocument()
    expect(screen.getByText(/소희가 7일치 채널별 맞춤 일정을 생성합니다/)).toBeInTheDocument()
  })
})
