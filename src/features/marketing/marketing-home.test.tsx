import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  CHANNEL_CAPABILITIES,
  INDUSTRIES,
  MARKETING_COPY,
  PRODUCT_STEPS,
} from './v085-content'
import { MARKETING_ASSETS } from './v085-assets'
import { V085MarketingHome } from './v085-marketing-home'

describe('V0.85 marketing contract', () => {
  it('고정 가치 제안과 행동을 제공한다', () => {
    expect(MARKETING_COPY.heroTitle).toBe('여러 마케팅 채널을 돌아다니지 마세요.')
    expect(MARKETING_COPY.primaryCta).toBe('내 매장으로 무료 진단하기')
    expect(MARKETING_COPY.secondaryCta).toBe('실제 운영 화면 보기')
  })

  it('일곱 단계 제품 흐름과 네 업종을 제공한다', () => {
    expect(PRODUCT_STEPS).toHaveLength(7)
    expect(INDUSTRIES.map((item) => item.slug)).toEqual([
      'beauty',
      'food',
      'education',
      'local-service',
    ])
  })

  it('채널의 현실적 실행 경계를 유지한다', () => {
    expect(CHANNEL_CAPABILITIES.find((item) => item.id === 'naver-blog')?.mode)
      .toBe('사용자 최종 게시 흐름 검증 완료')
    expect(CHANNEL_CAPABILITIES.find((item) => item.id === 'naver-place')?.mode)
      .toBe('감독형 실행 검증 완료')
  })

  it('최소 열여덟 개의 목적 있는 생성 자산을 선언한다', () => {
    expect(Object.keys(MARKETING_ASSETS)).toHaveLength(18)
  })
})

describe('V085MarketingHome', () => {
  it('첫 화면에서 문제, 가치와 세 가지 시작 행동을 보여준다', () => {
    render(<V085MarketingHome />)

    expect(screen.getByRole('heading', { name: MARKETING_COPY.heroTitle })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: MARKETING_COPY.primaryCta })).toHaveAttribute('href', '/diagnosis')
    expect(screen.getByRole('link', { name: MARKETING_COPY.secondaryCta })).toHaveAttribute('href', '/product#operations')
    expect(screen.getByRole('link', { name: MARKETING_COPY.signupCta })).toHaveAttribute('href', '/signup')
    expect(screen.getByRole('img', { name: MARKETING_ASSETS.hero.alt })).toBeInTheDocument()
  })

  it('흩어진 하루와 소희가 정리한 하루를 함께 설명한다', () => {
    render(<V085MarketingHome />)

    expect(screen.getByRole('heading', { name: '혹시 지금도 이렇게 일하고 있나요?' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: MARKETING_ASSETS.fragmentedDay.alt })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: MARKETING_ASSETS.organizedDay.alt })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '소희 사용 전과 후' })).toBeInTheDocument()
  })

  it('제품 흐름의 일곱 단계를 실제로 전환한다', async () => {
    render(<V085MarketingHome />)

    fireEvent.click(screen.getByRole('button', { name: /답변 초안 세 가지를 비교해요/ }))

    expect(screen.getByRole('button', { name: /답변 초안 세 가지를 비교해요/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('빠르고 짧게')).toBeInTheDocument()
    expect(screen.getByText('따뜻하고 친절하게')).toBeInTheDocument()
    expect(screen.getByText('상담으로 이어지게')).toBeInTheDocument()
  })

  it('업종에 따라 고객 질문과 결과 이미지를 바꾼다', async () => {
    render(<V085MarketingHome />)

    fireEvent.click(screen.getByRole('tab', { name: '교육' }))

    expect(screen.getByText('과정 문의에서 체험과 등록까지')).toBeInTheDocument()
    expect(screen.getByText('초등 4학년도 이번 달 체험 수업을 신청할 수 있나요?')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: MARKETING_ASSETS.education.alt })).toBeInTheDocument()
  })

  it('채널별 현실 경계와 안전한 위임 증거를 보여준다', () => {
    render(<V085MarketingHome />)

    expect(screen.getByRole('table', { name: '채널별 연결 수준' })).toBeInTheDocument()
    expect(screen.getByText('사용자 최종 게시 흐름 검증 완료')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '자동화보다 먼저, 정확한 위임을 보여드립니다.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: MARKETING_ASSETS.delegationReceipt.alt })).toBeInTheDocument()
  })

  it('이번 주 계획과 구체적인 시작 행동으로 마무리한다', () => {
    render(<V085MarketingHome />)
    expect(screen.getByRole('heading', { name: '오늘 고객을 놓치지 않고, 이번 주 마케팅을 끝내세요.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: MARKETING_ASSETS.finalPlan.alt })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '내 매장 마케팅 상태 진단하기' })).toHaveAttribute('href', '/diagnosis')
    expect(screen.getByText('소희가 모든 채널에 자동으로 게시하나요?')).toBeInTheDocument()
  })
})
