import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))
const mockGetOverview = vi.fn(async (): Promise<{ data: any; error: any }> => ({ data: [], error: null }))
const mockListReconsent = vi.hoisted(() => vi.fn(async (): Promise<{ data: any; error: any }> => ({ data: { documentType: 'privacy_consent', activeDocument: null, state: 'empty', items: [] }, error: null })))
vi.mock('../../../features/operator-onboarding/lifecycle-repository', () => ({
  getOperatorOnboardingOverview: () => mockGetOverview(),
}))
vi.mock('../../../features/operator-onboarding/document-reconsent-repository', () => ({
  listOperatorDocumentReconsentTargets: mockListReconsent,
}))
const mockPendingQueue = vi.fn(async (): Promise<{ data: any; error: any }> => ({ data: [], error: null }))
vi.mock('../../../features/operator-onboarding/business-verification-queue', () => ({
  getPendingBusinessVerifications: () => mockPendingQueue(),
  pendingBusinessStatusLabel: vi.fn((status: string) => status),
}))

import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import Page from './page'

describe('OperatorOnboardingPage', () => {
  it('guards onboarding directly and renders an honest empty state', async () => {
    const view = await Page()
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('agreement.read')
    expect(view).toBeTruthy()
    expect(JSON.stringify(view)).not.toMatch(/token|secret|password|비밀번호/iu)
  })

  it('renders the onboarding pipeline structure even before lifecycle data is connected', async () => {
    const view = await Page()
    expect(view).toBeTruthy()
  })

  it('surfaces LoadErrorNotice when overview fetch fails', async () => {
    mockGetOverview.mockResolvedValueOnce({ data: null, error: 'ONBOARDING_UNAVAILABLE' as any })
    const view = await Page()
    render(view)
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByText(/온보딩 및 계약 현황을\(를\) 불러오지 못했어요/)).toBeVisible()
  })

  it('shows the additional-authentication action when the overview RPC requires MFA', async () => {
    mockGetOverview.mockResolvedValueOnce({ data: null, error: 'MFA_REQUIRED' })
    render(await Page())
    expect(screen.getByRole('alert')).toHaveTextContent('이 화면은 추가 인증(2단계)을 마친 뒤에 볼 수 있어요. 인증을 완료한 뒤 다시 열어 주세요.')
    expect(screen.getByRole('link', { name: '추가 인증하러 가기' })).toHaveAttribute('href', '/auth/admin-setup')
    expect(screen.queryByText(/온보딩 및 계약 현황을\(를\) 불러오지 못했어요/)).not.toBeInTheDocument()
  })

  it('shows the authentication action when any reconsent RPC requires MFA', async () => {
    mockListReconsent.mockResolvedValueOnce({ data: null, error: 'MFA_REQUIRED' })
    render(await Page())
    expect(screen.getByRole('alert')).toHaveTextContent('추가 인증(2단계)')
    expect(screen.getByRole('link', { name: '추가 인증하러 가기' })).toHaveAttribute('href', '/auth/admin-setup')
    expect(screen.queryByText(/재동의 대상 목록을\(를\) 불러오지 못했어요/)).not.toBeInTheDocument()
  })

  it('renders "서류 보기" link only when hasDocument is true', async () => {
    mockPendingQueue.mockResolvedValueOnce({
      data: [
        {
          workspaceId: 'ws-with-doc',
          workspaceName: '서류있는매장',
          status: 'PENDING',
          companyName: '서류상호',
          businessNumber: '1234567890',
          representativeName: '대표',
          hasDocument: true,
          createdAt: new Date().toISOString(),
          updatedAt: null,
        },
        {
          workspaceId: 'ws-without-doc',
          workspaceName: '서류없는매장',
          status: 'NOT_SUBMITTED',
          companyName: null,
          businessNumber: null,
          representativeName: null,
          hasDocument: false,
          createdAt: new Date().toISOString(),
          updatedAt: null,
        },
      ],
      error: null,
    })

    render(await Page())

    const docLink = screen.getByRole('link', { name: '서류 보기' })
    expect(docLink).toBeInTheDocument()
    expect(docLink).toHaveAttribute('href', '/api/admin/workspaces/ws-with-doc/business-document?redirect=1')
    expect(docLink).toHaveAttribute('target', '_blank')
    expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')

    // ws-without-doc 에는 서류 보기 링크가 없어야 함
    const allDocLinks = screen.getAllByRole('link', { name: '서류 보기' })
    expect(allDocLinks).toHaveLength(1)
  })
})

