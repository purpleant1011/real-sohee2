import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GovernanceView } from './governance-view'

describe('GovernanceView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
  })

  it('renders honest Korean header without fake metrics or dead buttons', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/governance/approvals')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ approvals: [] }),
        })
      }
      if (url.includes('/api/admin/system/kill-switches')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ switches: [] }),
        })
      }
      return Promise.resolve({ ok: false })
    }))

    render(
      <GovernanceView
        adminSummary={{
          data: {
            items: [
              {
                userId: '30000000-0000-4000-8000-000000000001',
                email: 'admin@example.com',
                status: 'active',
                roleKeys: ['operations_admin'],
                roleDisplayNames: ['운영 관리자'],
                scopeSummary: { kind: 'global', workspaceCount: 0 },
                mfaRequired: true,
                mfaEnrolled: true,
                mfaExceptionState: 'none',
                mfaExceptionUntil: null,
                passwordSetAt: '2026-08-23T10:00:00.000Z',
                activatedAt: '2026-08-23T10:05:00.000Z',
                lastReviewedAt: '2026-08-23T11:00:00.000Z',
                createdAt: '2026-08-23T09:00:00.000Z',
                updatedAt: '2026-08-23T11:00:00.000Z',
                dataFreshness: 'fresh',
                sessionState: 'unknown',
                lastLoginAt: null,
              },
            ],
            nextCursor: null,
          },
          error: null,
        }}
      />
    )

    expect(screen.getByRole('heading', { name: '보안 설정' })).toBeVisible()
    expect(screen.queryByText(/AAL2 & Two-Man Rule/i)).toBeNull()
    expect(screen.queryByText(/owner@sohee\.ai\.kr/i)).toBeNull()
    expect(screen.queryByText(/거버넌스 상태 갱신/i)).toBeNull()
    expect(screen.queryByText(/신규 관리자 초대/i)).toBeNull()
    expect(screen.queryByText(/MFA 등록률 100%/i)).toBeNull()
    expect(screen.queryByText(/SHA-256 검증 완료/i)).toBeNull()

    // Has link to interventions
    expect(screen.getByRole('link', { name: /긴급 개입 열기/i })).toHaveAttribute('href', '/admin/interventions')
  })

  it('shows LoadErrorNotice when approval load fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/governance/approvals')) {
        return Promise.resolve({ ok: false, status: 500 })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ switches: [] }) })
    }))

    render(<GovernanceView />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeVisible()
      expect(screen.getByText(/승인 대기 목록을\(를\) 불러오지 못했어요/)).toBeVisible()
    })
  })

  it('disables approve and reject buttons when stepUpToken is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/governance/approvals')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            approvals: [
              {
                id: '12345678-1234-1234-1234-123456789abc',
                title: '긴급 킬스위치 가동 요청',
                domain: 'RUNTIME_CONTROL',
                riskLevel: 'CRITICAL',
                sourceKind: 'CANONICAL',
                proposerActorId: 'actor-1',
                proposerEmail: 'requester@example.com',
                proposedAt: '2026-10-08T10:00:00.000Z',
                reason: '긴급 차단',
                status: 'PENDING_SECOND_APPROVAL',
                isExecutable: true,
                correlationId: 'corr-1',
              },
            ],
          }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ switches: [] }) })
    }))

    render(<GovernanceView />)

    await waitFor(() => {
      expect(screen.getByText('긴급 킬스위치 가동 요청')).toBeVisible()
    })

    const rejectBtn = screen.getByRole('button', { name: '반려' })
    const approveBtn = screen.getByRole('button', { name: '승인' })
    expect(rejectBtn).toBeDisabled()
    expect(approveBtn).toBeDisabled()
    expect(screen.getByText('추가 인증 토큰을 입력해야 승인하거나 반려할 수 있습니다.')).toBeVisible()
  })
})
