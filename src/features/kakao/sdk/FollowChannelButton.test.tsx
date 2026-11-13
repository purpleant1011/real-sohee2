import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FollowChannelButton } from './FollowChannelButton'
import * as sdkLoader from './load-kakao-sdk'

describe('FollowChannelButton', () => {
  const originalEnv = process.env.NEXT_PUBLIC_KAKAO_JS_KEY

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = ''
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = originalEnv
  })

  it('channelPublicId가 제공되지 않거나 빈 문자열이면 아무것도 렌더링하지 않아야 한다 (환경 미설정)', () => {
    const { container: c1 } = render(
      <FollowChannelButton channelPublicId="" jsKey="test-key" />,
    )
    expect(c1.firstChild).toBeNull()

    const { container: c2 } = render(
      <FollowChannelButton
        channelPublicId="   "
        jsKey="test-key"
      />,
    )
    expect(c2.firstChild).toBeNull()
  })

  it('jsKey가 prop이나 환경변수 어디에도 없으면 아무것도 렌더링하지 않아야 한다 (환경 미설정)', () => {
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = ''
    const { container } = render(
      <FollowChannelButton channelPublicId="_xabc123" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('환경이 정상 설정된 경우 44px 이상의 터치 타겟과 접근성 라벨을 가진 버튼을 렌더링해야 한다', () => {
    render(
      <FollowChannelButton
        channelPublicId="_xabc123"
        jsKey="valid-js-key"
      />,
    )

    const button = screen.getByRole('button', { name: /카카오톡 채널 추가/i })
    expect(button).toBeDefined()
    expect(button.getAttribute('aria-label')).toContain('카카오톡 채널 추가')
    // 모바일 터치 영역 44px 이상 클래스 또는 스타일 검증
    expect(button.className).toMatch(/(min-h-\[44px\]|h-\[44px\]|h-11|h-12)/)
  })

  it('마운트 시점에는 Kakao.Channel.addChannel을 자동으로 호출하지 않아야 한다 (자동 호출 금지)', () => {
    const loadSpy = vi.spyOn(sdkLoader, 'loadKakaoSdk')
    render(
      <FollowChannelButton
        channelPublicId="_xabc123"
        jsKey="valid-js-key"
      />,
    )

    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('버튼 클릭 시 loadKakaoSdk 후 Kakao.Channel.addChannel을 사용자 지정 channelPublicId로 호출해야 한다', async () => {
    const mockAddChannel = vi.fn()
    const mockKakao = {
      init: vi.fn(),
      isInitialized: vi.fn(() => true),
      Channel: {
        addChannel: mockAddChannel,
      },
    }

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: true,
      kakao: mockKakao,
    })

    render(
      <FollowChannelButton
        channelPublicId="_xCUSTOM_ID"
        jsKey="valid-js-key"
      />,
    )

    const button = screen.getByRole('button', { name: /카카오톡 채널 추가/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockAddChannel).toHaveBeenCalledWith({
        channelPublicId: '_xCUSTOM_ID',
      })
    })
  })

  it('SDK 로드 실패 시 한국어 안내 문구를 표시해야 한다', async () => {
    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: false,
      reason: 'Failed to load script',
    })

    render(
      <FollowChannelButton
        channelPublicId="_xabc123"
        jsKey="valid-js-key"
      />,
    )

    const button = screen.getByRole('button', { name: /카카오톡 채널 추가/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(
        screen.getByText(/카카오톡 채널을 연결할 수 없습니다/i),
      ).toBeDefined()
    })
  })

  it('addChannel 실행 중 팝업 차단 또는 오류 발생 시 한국어 안내 문구를 표시해야 한다', async () => {
    const mockKakao = {
      init: vi.fn(),
      isInitialized: vi.fn(() => true),
      Channel: {
        addChannel: vi.fn(() => {
          throw new Error('Popup blocked')
        }),
      },
    }

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: true,
      kakao: mockKakao,
    })

    render(
      <FollowChannelButton
        channelPublicId="_xabc123"
        jsKey="valid-js-key"
      />,
    )

    const button = screen.getByRole('button', { name: /카카오톡 채널 추가/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(
        screen.getByText(/팝업이 차단되었거나 채널 연결에 실패했습니다/i),
      ).toBeDefined()
    })
  })
})
