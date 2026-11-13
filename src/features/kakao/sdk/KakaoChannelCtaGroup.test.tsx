import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KakaoChannelCtaGroup } from './KakaoChannelCtaGroup'

describe('KakaoChannelCtaGroup', () => {
  const originalPublicId = process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID
  const originalJsKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = ''
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = 'test-js-key'
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = originalPublicId
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = originalJsKey
  })

  it('기본 안내 문구 "궁금한 점이 있으신가요? 카카오톡으로 편하게 문의하세요"를 렌더링해야 한다', () => {
    render(<KakaoChannelCtaGroup channelPublicId="_rqKxeX" />)

    expect(
      screen.getByText('궁금한 점이 있으신가요? 카카오톡으로 편하게 문의하세요'),
    ).toBeDefined()
  })

  it('채널 추가 버튼과 1:1 상담 문의 버튼이 모두 렌더링되어야 한다', () => {
    render(<KakaoChannelCtaGroup channelPublicId="_rqKxeX" />)

    const followButton = screen.getByRole('button', { name: /카카오톡 채널 추가/i })
    const chatButton = screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })

    expect(followButton).toBeDefined()
    expect(chatButton).toBeDefined()
  })

  it('channelPublicId prop이 없을 때 env fallback 또는 기본값 "_rqKxeX"를 사용해야 한다', () => {
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = ''
    render(<KakaoChannelCtaGroup />)

    // 기본값 _rqKxeX가 들어가 정상적으로 버튼들이 렌더링되어야 함
    expect(screen.getByRole('button', { name: /카카오톡 채널 추가/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })).toBeDefined()
  })

  it('channelPublicId prop이 없을 때 NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID 환경변수를 우선 사용해야 한다', () => {
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = '_customEnvId'
    render(<KakaoChannelCtaGroup />)

    expect(screen.getByRole('button', { name: /카카오톡 채널 추가/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })).toBeDefined()
  })

  it('버튼 텍스트가 거짓 완료를 유발하지 않고 명확한 액션을 표시해야 한다', () => {
    render(<KakaoChannelCtaGroup channelPublicId="_rqKxeX" />)

    // "완료" 같은 완료형 어미 금지 검증
    expect(screen.queryByText(/친구 추가 완료/i)).toBeNull()
    expect(screen.queryByText(/상담 접수 완료/i)).toBeNull()

    // 정확한 액션 명칭
    expect(screen.getByText('카카오톡 채널 추가')).toBeDefined()
    expect(screen.getByText('카카오톡 1:1 상담')).toBeDefined()
  })

  it('layout prop="vertical"일 때 세로 배치 클래스를 포함해야 한다', () => {
    const { container } = render(
      <KakaoChannelCtaGroup channelPublicId="_rqKxeX" layout="vertical" />,
    )
    const buttonContainer = container.querySelector('[data-cta-buttons]')
    expect(buttonContainer?.className).toContain('flex-col')
  })

  it('layout prop="horizontal"일 때 가로 배치 클래스를 포함해야 한다', () => {
    const { container } = render(
      <KakaoChannelCtaGroup channelPublicId="_rqKxeX" layout="horizontal" />,
    )
    const buttonContainer = container.querySelector('[data-cta-buttons]')
    expect(buttonContainer?.className).toContain('flex-row')
  })

  it('showGuideText=false 설정 시 안내 문구를 숨겨야 한다', () => {
    render(
      <KakaoChannelCtaGroup channelPublicId="_rqKxeX" showGuideText={false} />,
    )
    expect(
      screen.queryByText('궁금한 점이 있으신가요? 카카오톡으로 편하게 문의하세요'),
    ).toBeNull()
  })
})
