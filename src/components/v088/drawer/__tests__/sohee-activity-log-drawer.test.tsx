import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SoheeActivityLogDrawer } from '../sohee-activity-log-drawer'

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    balance: 84000,
    capacity: 100000,
    remainingPercentage: 84,
  }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user', email: 'test@example.com' } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          }),
        }),
        order: () => ({
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    }),
  }),
}))

describe('SoheeActivityLogDrawer UX Audit & Copywriting Invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tokens 수치를 화면에 노출하지 않는다 (크레딧/토큰 숫자 노출 금지 정책)', async () => {
    render(<SoheeActivityLogDrawer isOpen={true} onClose={vi.fn()} />)

    // tokens 단위 텍스트가 노출되지 않아야 함
    expect(screen.queryByText(/tokens/i)).toBeNull()
  })

  it('긴 설명문단이 20자 안팎의 간결한 한 줄로 축약되어 있다', async () => {
    render(<SoheeActivityLogDrawer isOpen={true} onClose={vi.fn()} />)

    // 축약된 헤더 서브텍스트 확인
    expect(screen.getByText('상황 파악부터 실행까지 실시간 기록해요.')).toBeDefined()
  })

  it('영문 상태 코드(HTTP 200) 및 개발자 API 스펙 대신 한국어 상태 문구를 표시한다', async () => {
    render(<SoheeActivityLogDrawer isOpen={true} onClose={vi.fn()} />)

    // 실행 탭으로 전환
    const actionsTab = screen.getByRole('button', { name: /실행 및 액션 기록/ })
    fireEvent.click(actionsTab)

    // 비동기 계정 로딩 대기 후 검증
    await waitFor(() => {
      expect(screen.getAllByText(/성공 \(발행 완료\)|실발행 완료/).length).toBeGreaterThan(0)
    })
    // HTTP 200 원문은 노출되지 않아야 함
    expect(screen.queryByText(/HTTP 200/)).toBeNull()
  })

  it('버튼 문구가 행동 동사로 구성된다', async () => {
    render(<SoheeActivityLogDrawer isOpen={true} onClose={vi.fn()} />)

    // "나의 소희 셋업" 대신 행동 동사 "설정 확인하기"
    expect(screen.getByRole('link', { name: /설정 확인하기/ })).toBeDefined()
  })
})

