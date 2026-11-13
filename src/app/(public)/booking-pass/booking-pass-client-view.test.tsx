import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import BookingPassClientView from './booking-pass-client-view'
import type { BookingPassViewData } from '@/features/kakao/booking-pass/pass-view'

describe('BookingPassClientView', () => {
  const originalPublicId = process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID
  const originalJsKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY

  const minimalPass: BookingPassViewData = {
    bookingId: 'bk_client_test',
    workspaceId: 'ws_test',
    status: 'CONFIRMED',
    statusLabel: '예약 확정',
    shopName: '살롱 드 소희',
    startsAt: '2026-11-20 14:00',
    requiresReauth: true,
  }

  const fullPass: BookingPassViewData = {
    bookingId: 'bk_client_test',
    workspaceId: 'ws_test',
    status: 'CONFIRMED',
    statusLabel: '예약 확정',
    shopName: '살롱 드 소희',
    startsAt: '2026-11-20 14:00',
    serviceName: '프리미엄 헤어컷',
    paymentSummary: '예약금 안내: 20,000원',
    customerNameMasked: '홍*동',
    customerPhoneMasked: '010-****-5678',
    address: '서울 강남구 도산대로 101',
    naverMapUrl: 'https://map.naver.com/test',
    requiresReauth: false,
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID
    delete process.env.NEXT_PUBLIC_KAKAO_JS_KEY
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = originalPublicId
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = originalJsKey
  })

  it('renders reauth form and keeps button disabled until 4 digits are entered', () => {
    render(<BookingPassClientView initialPass={minimalPass} token="test.token" />)

    const input = screen.getByLabelText(/전화번호 뒤 4자리/i)
    const button = screen.getByRole('button', { name: /예약 상세 확인/i })

    expect(button).toBeDisabled()

    fireEvent.change(input, { target: { value: '12' } })
    expect(button).toBeDisabled()

    fireEvent.change(input, { target: { value: '5678' } })
    expect(button).not.toBeDisabled()
  })

  it('displays error message when verification fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: '전화번호 뒤 4자리가 일치하지 않습니다.' }),
    } as Response)

    render(<BookingPassClientView initialPass={minimalPass} token="test.token" />)

    const input = screen.getByLabelText(/전화번호 뒤 4자리/i)
    const button = screen.getByRole('button', { name: /예약 상세 확인/i })

    fireEvent.change(input, { target: { value: '9999' } })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('전화번호 뒤 4자리가 일치하지 않습니다.')
    })

    // Still locked
    expect(screen.queryByText('프리미엄 헤어컷')).not.toBeInTheDocument()
  })

  it('unlocks and displays full booking pass upon successful verification', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, pass: fullPass }),
    } as Response)

    render(<BookingPassClientView initialPass={minimalPass} token="test.token" />)

    const input = screen.getByLabelText(/전화번호 뒤 4자리/i)
    const button = screen.getByRole('button', { name: /예약 상세 확인/i })

    fireEvent.change(input, { target: { value: '5678' } })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('프리미엄 헤어컷')).toBeInTheDocument()
      expect(screen.getByText('홍*동')).toBeInTheDocument()
      expect(screen.getByText('010-****-5678')).toBeInTheDocument()
      expect(screen.getByText('서울 강남구 도산대로 101')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /네이버 지도 길찾기/i })).toBeInTheDocument()
    })
  })

  describe('KakaoChannelCtaGroup mount gate', () => {
    it('(1) env(NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID, NEXT_PUBLIC_KAKAO_JS_KEY)가 모두 있으면 상세 화면에서 CTA 노출', () => {
      process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = '_testChannelId'
      process.env.NEXT_PUBLIC_KAKAO_JS_KEY = 'test_js_key_123'

      render(<BookingPassClientView initialPass={fullPass} token="test.token" />)

      expect(screen.getByRole('button', { name: /카카오톡 채널 추가/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })).toBeInTheDocument()
    })

    it('(2) env가 하나라도 없으면 미노출 (public ID 누락)', () => {
      delete process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID
      process.env.NEXT_PUBLIC_KAKAO_JS_KEY = 'test_js_key_123'

      render(<BookingPassClientView initialPass={fullPass} token="test.token" />)

      expect(screen.queryByRole('button', { name: /카카오톡 채널 추가/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /카카오톡 1:1 상담 문의/i })).not.toBeInTheDocument()
    })

    it('(2) env가 하나라도 없으면 미노출 (jsKey 누락)', () => {
      process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = '_testChannelId'
      delete process.env.NEXT_PUBLIC_KAKAO_JS_KEY

      render(<BookingPassClientView initialPass={fullPass} token="test.token" />)

      expect(screen.queryByRole('button', { name: /카카오톡 채널 추가/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /카카오톡 1:1 상담 문의/i })).not.toBeInTheDocument()
    })

    it('(3) 본인확인(requiresReauth) 통과 전 상태에서는 env가 있어도 CTA 미노출', () => {
      process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = '_testChannelId'
      process.env.NEXT_PUBLIC_KAKAO_JS_KEY = 'test_js_key_123'

      render(<BookingPassClientView initialPass={minimalPass} token="test.token" />)

      expect(screen.queryByRole('button', { name: /카카오톡 채널 추가/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /카카오톡 1:1 상담 문의/i })).not.toBeInTheDocument()
    })

    it('(3) 본인확인 통과 후(상세 노출)에는 CTA 노출로 전환됨', async () => {
      process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = '_testChannelId'
      process.env.NEXT_PUBLIC_KAKAO_JS_KEY = 'test_js_key_123'

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, pass: fullPass }),
      } as Response)

      render(<BookingPassClientView initialPass={minimalPass} token="test.token" />)

      // Before verify: no CTA
      expect(screen.queryByRole('button', { name: /카카오톡 채널 추가/i })).not.toBeInTheDocument()

      const input = screen.getByLabelText(/전화번호 뒤 4자리/i)
      const button = screen.getByRole('button', { name: /예약 상세 확인/i })

      fireEvent.change(input, { target: { value: '5678' } })
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /카카오톡 채널 추가/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /카카오톡 1:1 상담 문의/i })).toBeInTheDocument()
      })
    })
  })
})
