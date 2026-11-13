import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issuePassToken } from '@/features/kakao/booking-pass/pass-token'

// Mock createAdminSupabaseClient
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import BookingPassPage from './page'

describe('BookingPassPage (/booking-pass)', () => {
  const secret = 'test-pass-secret-token-key-123'
  const workspaceId = 'ws_salon_view_01'
  const bookingId = 'bk_view_001'

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.PASS_TOKEN_SECRET = secret
  })

  function createMockDb(
    reservationData: Record<string, unknown> | null,
    profileData?: Record<string, unknown> | null,
  ) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: reservationData,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: profileData ?? null,
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }
  }

  it('renders notice when token is missing from searchParams', async () => {
    const page = await BookingPassPage({ searchParams: Promise.resolve({}) })
    render(page)

    expect(screen.getByRole('heading', { name: '예약패스를 확인할 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByText(/예약패스 토큰이 전달되지 않았습니다/i)).toBeInTheDocument()
  })

  it('renders error view when token is invalid or tampered', async () => {
    const page = await BookingPassPage({
      searchParams: Promise.resolve({ token: 'invalid.tampered.token' }),
    })
    render(page)

    expect(screen.getByRole('heading', { name: '예약패스를 확인할 수 없습니다' })).toBeInTheDocument()
  })

  it('renders guidance view (토큰 검증 불가) when PASS_TOKEN_SECRET is missing, ignoring KAKAO_STATE_SECRET', async () => {
    delete process.env.PASS_TOKEN_SECRET
    process.env.KAKAO_STATE_SECRET = 'should-not-fallback'

    const page = await BookingPassPage({
      searchParams: Promise.resolve({ token: 'sample.token' }),
    })
    render(page)

    expect(screen.getByRole('heading', { name: '토큰 검증 불가' })).toBeInTheDocument()
    expect(screen.getByText(/토큰 검증 서비스를 이용할 수 없습니다/i)).toBeInTheDocument()
  })

  it('renders minimal view with reauth form when token requiresReauth is true', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds: 3600,
      requiresReauth: true,
    })

    const mockDb = createMockDb(
      {
        id: bookingId,
        workspace_id: workspaceId,
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '퍼스널 컬러 헤어 컨설팅',
        status: 'CONFIRMED',
        deposit_krw: 15000,
        total_amount_krw: 60000,
        payment_status: 'PAID',
        metadata: {
          startsAt: '2026-11-25 14:30',
          bookingNumber: 'RES-88991',
        },
      },
      {
        business_name: '살롱 드 소희 청담점',
        address: '서울 강남구 도산대로 101',
      },
    )
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const page = await BookingPassPage({
      searchParams: Promise.resolve({ token }),
    })
    render(page)

    // Minimal info is visible
    expect(screen.getByRole('heading', { name: '살롱 드 소희 청담점' })).toBeInTheDocument()
    expect(screen.getByText('예약 확정')).toBeInTheDocument()
    expect(screen.getByText('2026-11-25 14:30')).toBeInTheDocument()

    // Reauth verification form is presented
    expect(screen.getByRole('heading', { name: /예약자 본인 확인/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/전화번호 뒤 4자리/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /예약 상세 확인/i })).toBeInTheDocument()

    // Detailed sensitive data is hidden
    expect(screen.queryByText('퍼스널 컬러 헤어 컨설팅')).not.toBeInTheDocument()
    expect(screen.queryByText('홍*동')).not.toBeInTheDocument()
    expect(screen.queryByText(/15,000원 결제 완료/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /네이버 지도 길찾기/i })).not.toBeInTheDocument()
  })

  it('renders complete ticket pass view when requiresReauth is false and payment_status is PAID', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds: 3600,
      requiresReauth: false,
    })

    const mockDb = createMockDb(
      {
        id: bookingId,
        workspace_id: workspaceId,
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '퍼스널 컬러 헤어 컨설팅',
        status: 'CONFIRMED',
        deposit_krw: 15000,
        total_amount_krw: 60000,
        payment_status: 'PAID',
        metadata: {
          startsAt: '2026-11-25 14:30',
          bookingNumber: 'RES-88991',
        },
      },
      {
        business_name: '살롱 드 소희 청담점',
        address: '서울 강남구 도산대로 101',
      },
    )
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const page = await BookingPassPage({
      searchParams: Promise.resolve({ token }),
    })
    render(page)

    // Check title and details
    expect(screen.getByRole('heading', { name: '살롱 드 소희 청담점' })).toBeInTheDocument()
    expect(screen.getByText('예약 확정')).toBeInTheDocument()
    expect(screen.getByText('홍*동')).toBeInTheDocument()
    expect(screen.getByText('010-****-5678')).toBeInTheDocument()
    expect(screen.getByText('퍼스널 컬러 헤어 컨설팅')).toBeInTheDocument()
    expect(screen.getByText('2026-11-25 14:30')).toBeInTheDocument()
    expect(screen.getByText(/15,000원 결제 완료/)).toBeInTheDocument()

    // Naver Map Link
    const naverLink = screen.getByRole('link', { name: /네이버 지도 길찾기/i })
    expect(naverLink).toHaveAttribute('href', expect.stringContaining('map.naver.com'))
  })

  it('renders neutral payment wording when payment_status is absent', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      requiresReauth: false,
    })

    const mockDb = createMockDb(
      {
        id: bookingId,
        workspace_id: workspaceId,
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '퍼스널 컬러 헤어 컨설팅',
        status: 'CONFIRMED',
        deposit_krw: 15000,
        total_amount_krw: 60000,
        // No payment_status
        metadata: {
          startsAt: '2026-11-25 14:30',
        },
      },
      {
        business_name: '살롱 드 소희 청담점',
      },
    )
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const page = await BookingPassPage({
      searchParams: Promise.resolve({ token }),
    })
    render(page)

    expect(screen.getByText(/예약금 안내: 15,000원/)).toBeInTheDocument()
    expect(screen.queryByText(/결제 완료/)).not.toBeInTheDocument()
  })
})
