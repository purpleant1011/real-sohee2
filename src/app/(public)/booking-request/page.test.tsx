import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issueRequestToken } from '@/features/booking-request/request-token'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import BookingRequestPage from './page'

describe('BookingRequestPage (/booking-request)', () => {
  const secret = 'test-pass-secret-token-key-12345'
  const workspaceId = 'ws_salon_view_01'

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.PASS_TOKEN_SECRET = secret
  })

  function createMockDb(profileData?: Record<string, unknown> | null) {
    return {
      from: vi.fn((table: string) => {
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
    const page = await BookingRequestPage({ searchParams: Promise.resolve({}) })
    render(page)

    expect(screen.getByRole('heading', { name: '예약 링크를 확인할 수 없어요' })).toBeInTheDocument()
    expect(screen.getByText(/예약 신청 링크가 전달되지 않았습니다/i)).toBeInTheDocument()
  })

  it('renders guidance view when PASS_TOKEN_SECRET is missing', async () => {
    delete process.env.PASS_TOKEN_SECRET

    const page = await BookingRequestPage({
      searchParams: Promise.resolve({ token: 'sample.token' }),
    })
    render(page)

    expect(screen.getByRole('heading', { name: '서비스 준비 중' })).toBeInTheDocument()
    expect(screen.getByText(/예약 신청 서비스를 현재 이용할 수 없습니다/i)).toBeInTheDocument()
  })

  it('renders error view when token is invalid or tampered', async () => {
    const page = await BookingRequestPage({
      searchParams: Promise.resolve({ token: 'invalid.tampered.token' }),
    })
    render(page)

    expect(screen.getByRole('heading', { name: '예약 링크를 확인할 수 없어요' })).toBeInTheDocument()
    expect(screen.getByText(/유효하지 않거나 손상된 예약 링크입니다/i)).toBeInTheDocument()
  })

  it('renders error view when token is expired', async () => {
    const fixedNow = 1762300000
    const token = await issueRequestToken({
      workspaceId,
      secret,
      ttlSeconds: 60,
      now: fixedNow,
    })

    // verifyRequestToken inside page uses Date.now(), so let's mock Date.now() to future
    const realNow = Date.now
    try {
      Date.now = () => (fixedNow + 120) * 1000
      const page = await BookingRequestPage({
        searchParams: Promise.resolve({ token: token! }),
      })
      render(page)

      expect(screen.getByRole('heading', { name: '예약 링크를 확인할 수 없어요' })).toBeInTheDocument()
      expect(screen.getByText(/예약 신청 링크의 유효기간이 지났습니다/i)).toBeInTheDocument()
    } finally {
      Date.now = realNow
    }
  })

  it('renders client form with store name when token is valid', async () => {
    const mockDb = createMockDb({ business_name: '살롱 드 소희 강남점' })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const token = await issueRequestToken({ workspaceId, secret })
    const page = await BookingRequestPage({
      searchParams: Promise.resolve({ token: token! }),
    })
    render(page)

    expect(screen.getByRole('heading', { name: '살롱 드 소희 강남점' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^이름/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^휴대폰 번호/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^희망 일시/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '예약 신청하기' })).toBeInTheDocument()
  })

  it('falls back to default store name "예약 신청" if business_name is missing', async () => {
    const mockDb = createMockDb(null)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const token = await issueRequestToken({ workspaceId, secret })
    const page = await BookingRequestPage({
      searchParams: Promise.resolve({ token: token! }),
    })
    render(page)

    expect(screen.getByRole('heading', { name: '예약 신청' })).toBeInTheDocument()
  })
})
