import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { KakaoSyncBookingButton } from './KakaoSyncBookingButton'
import * as sdkLoader from './load-kakao-sdk'

describe('KakaoSyncBookingButton (ANI-2083 / KAPI-17)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_KAKAO_JS_KEY

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = ''
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = originalEnv
  })

  it('jsKey prop이나 NEXT_PUBLIC_KAKAO_JS_KEY 환경변수가 없으면 아무것도 렌더링하지 않는다 (fail-closed)', () => {
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = ''
    const { container: c1 } = render(<KakaoSyncBookingButton />)
    expect(c1.firstChild).toBeNull()

    const { container: c2 } = render(<KakaoSyncBookingButton jsKey="   " />)
    expect(c2.firstChild).toBeNull()
  })

  it('환경변수가 제공되면 44px 이상 모바일 터치 타겟과 카카오 공식 옐로우 스타일의 버튼을 렌더링한다', () => {
    render(<KakaoSyncBookingButton jsKey="valid-kakao-key" />)

    const button = screen.getByRole('button', { name: /카카오/i })
    expect(button).toBeDefined()
    expect(button.className).toContain('min-h-[44px]')
    expect(button.className).toContain('min-w-[44px]')
    expect(button.className).toContain('bg-[#FEE500]')
    expect(button.className).toContain('text-[#191919]')
  })

  it('마운트 시점에는 Kakao.Auth.authorize를 자동으로 호출하지 않는다', () => {
    const loadSpy = vi.spyOn(sdkLoader, 'loadKakaoSdk')
    render(<KakaoSyncBookingButton jsKey="valid-kakao-key" />)

    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('버튼 클릭 시 SDK를 로드하고 scope(profile_nickname,name,phone_number)로 Kakao.Auth.authorize를 호출한다', async () => {
    const mockAuthorize = vi.fn()
    const mockKakao = {
      init: vi.fn(),
      isInitialized: vi.fn(() => true),
      Auth: {
        authorize: mockAuthorize,
      },
    }

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: true,
      kakao: mockKakao,
    })

    render(
      <KakaoSyncBookingButton
        jsKey="valid-kakao-key"
        redirectUri="https://example.com/booking/kakao/callback"
        state="state-csrf-123"
      />,
    )

    const button = screen.getByRole('button', { name: /카카오/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(mockAuthorize).toHaveBeenCalledWith({
        redirectUri: 'https://example.com/booking/kakao/callback',
        scope: 'profile_nickname,name,phone_number',
        state: 'state-csrf-123',
      })
    })
  })

  it('SDK 로드 실패 시 한국어 에러 안내 문구를 표시한다', async () => {
    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: false,
      reason: 'Script load error',
    })

    render(<KakaoSyncBookingButton jsKey="valid-kakao-key" />)

    const button = screen.getByRole('button', { name: /카카오/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(
        screen.getByText(/카카오 간편 예약을 연결할 수 없습니다/i),
      ).toBeDefined()
    })
  })

  it('authorize 호출 중 예외 발생 시 에러 안내 문구를 표시한다', async () => {
    const mockKakao = {
      init: vi.fn(),
      isInitialized: vi.fn(() => true),
      Auth: {
        authorize: vi.fn(() => {
          throw new Error('Popup blocked or auth rejected')
        }),
      },
    }

    vi.spyOn(sdkLoader, 'loadKakaoSdk').mockResolvedValue({
      ok: true,
      kakao: mockKakao,
    })

    render(<KakaoSyncBookingButton jsKey="valid-kakao-key" />)

    const button = screen.getByRole('button', { name: /카카오/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(
        screen.getByText(/카카오 연결에 실패했습니다/i),
      ).toBeDefined()
    })
  })
})
