import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KakaoChatButton } from './KakaoChatButton'
import * as sdkLoader from './load-kakao-sdk'

describe('KakaoChatButton', () => {
  const originalEnv = process.env.NEXT_PUBLIC_KAKAO_JS_KEY
  let openSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = ''
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = originalEnv
  })

  it('channelPublicId가 제공되지 않거나 빈 문자열이면 아무것도 렌더링하지 않아야 한다', () => {
    const { container: c1 } = render(
      <KakaoChatButton channelPublicId="" jsKey="test-key" />,
    )
    expect(c1.firstChild).toBeNull()

    const { container: c2 } = render(
      <KakaoChatButton channelPublicId="   " jsKey="test-key" />,
    )
    expect(c2.firstChild).toBeNull()
  })

  it('44px 이상의 터치 타겟과 aria-label="카카오톡 1:1 상담 문의"를 가진 버튼을 렌더링해야 한다', () => {
    render(
      <KakaoChatButton channelPublicId="_rqKxeX" jsKey="test-key" />,
    )

    const button = screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })
    expect(button).toBeDefined()
    expect(button.getAttribute('aria-label')).toBe('카카오톡 1:1 상담 문의')
    expect(button.className).toMatch(/(min-h-\[44px\]|h-\[44px\]|h-11|h-12)/)
  })

  it('마운트 시점에는 Kakao.Channel.chat을 자동으로 호출하지 않아야 한다 (자동 호출 금지)', () => {
    const loadSpy = vi.spyOn(sdkLoader, 'loadKakaoSdk')
    render(
      <KakaoChatButton channelPublicId="_rqKxeX" jsKey="test-key" />,
    )

    expect(loadSpy).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('버튼 클릭 시 loadKakaoSdk 후 Kakao.Channel.chat을 사용자 지정 channelPublicId로 호출해야 한다', async () => {
    const mockChat = vi.fn()
    const mockKakao = {
      init: vi.fn(),
      isInitialized: vi.fn(() => true),
      Channel: {
        chat: mockChat,
      },
    }

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: true,
      kakao: mockKakao as unknown as sdkLoader.KakaoSdkGlobal,
    })

    render(
      <KakaoChatButton channelPublicId="_rqKxeX" jsKey="test-key" />,
    )

    const button = screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockChat).toHaveBeenCalledWith({
        channelPublicId: '_rqKxeX',
      })
    })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('SDK 로드 실패 시 https://pf.kakao.com/${channelPublicId}/chat 새 창 fallback을 호출해야 한다', async () => {
    const mockWindow = { closed: false } as Window
    openSpy.mockReturnValue(mockWindow)

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: false,
      reason: 'Script load failed',
    })

    render(
      <KakaoChatButton channelPublicId="_rqKxeX" jsKey="test-key" />
    )

    const button = screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        'https://pf.kakao.com/_rqKxeX/chat',
        '_blank',
        'noopener,noreferrer',
      )
    })
  })

  it('Kakao SDK는 로드되었으나 Channel.chat이 없는 미지원 환경 시 fallback 새 창을 열어야 한다', async () => {
    const mockWindow = { closed: false } as Window
    openSpy.mockReturnValue(mockWindow)

    const mockKakao = {
      init: vi.fn(),
      isInitialized: vi.fn(() => true),
      Channel: {},
    }

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: true,
      kakao: mockKakao as unknown as sdkLoader.KakaoSdkGlobal,
    })

    render(
      <KakaoChatButton channelPublicId="_rqKxeX" jsKey="test-key" />
    )

    const button = screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        'https://pf.kakao.com/_rqKxeX/chat',
        '_blank',
        'noopener,noreferrer',
      )
    })
  })

  it('SDK 호출 에러 발생 시 fallback 새 창을 시도해야 한다', async () => {
    const mockWindow = { closed: false } as Window
    openSpy.mockReturnValue(mockWindow)

    const mockKakao = {
      init: vi.fn(),
      isInitialized: vi.fn(() => true),
      Channel: {
        chat: vi.fn(() => {
          throw new Error('SDK error')
        }),
      },
    }

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: true,
      kakao: mockKakao as unknown as sdkLoader.KakaoSdkGlobal,
    })

    render(
      <KakaoChatButton channelPublicId="_rqKxeX" jsKey="test-key" />
    )

    const button = screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        'https://pf.kakao.com/_rqKxeX/chat',
        '_blank',
        'noopener,noreferrer',
      )
    })
  })

  it('fallback 호출 시 팝업 차단(window.open이 null 반환)되면 팝업 차단 안내 문구를 표시해야 한다', async () => {
    openSpy.mockReturnValue(null)

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: false,
      reason: 'SDK failed',
    })

    render(
      <KakaoChatButton channelPublicId="_rqKxeX" jsKey="test-key" />
    )

    const button = screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText(/팝업이 차단되었습니다/i)).toBeDefined()
    })
  })
})
