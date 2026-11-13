import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  getOperatorWorkspace: vi.fn(),
  readOperatorWorkspaceDetails: vi.fn(),
}))

vi.mock('../../../../features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({})),
}))
vi.mock('../../../../features/operator-workspaces/repository', () => ({
  getOperatorWorkspace: mocks.getOperatorWorkspace,
}))
vi.mock('../../../../features/operator-workspaces/detail-read-orchestrator', () => ({
  readOperatorWorkspaceDetails: mocks.readOperatorWorkspaceDetails,
}))
const createServerQueryBuilder = () => {
  const qb: any = {
    select: vi.fn(() => qb),
    eq: vi.fn(() => qb),
    in: vi.fn(() => qb),
    order: vi.fn(() => qb),
    limit: vi.fn(() => qb),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({ data: null, error: null })),
    then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  return qb
}

const adminRead = vi.hoisted(() => ({
  verification: { data: null as unknown, error: null as unknown },
  signupApp: { data: null as unknown, error: null as unknown },
  members: { data: [{ user_id: 'user-owner' }] as unknown, error: null as unknown },
}))
vi.mock('../../../../lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const qb = createServerQueryBuilder()
      if (table === 'business_verifications') qb.maybeSingle = vi.fn(async () => adminRead.verification)
      if (table === 'signup_applications') qb.maybeSingle = vi.fn(async () => adminRead.signupApp)
      if (table === 'workspace_members') qb.then = (resolve: any) => Promise.resolve(adminRead.members).then(resolve)
      return qb
    }),
  })),
}))

import { requireOperator } from '../../../../features/operator-auth/require-operator'
import Page, { resolveCreditTotal } from './page'

describe('OperatorWorkspaceDetailPage', () => {
  beforeEach(() => {
    mocks.getOperatorWorkspace.mockResolvedValue({ data: null, error: 'WORKSPACE_DETAIL_UNAVAILABLE' })
    mocks.readOperatorWorkspaceDetails.mockResolvedValue({
      lifecycle: { kind: 'not_connected', message: '가입·계약 자료 연결 전' },
      channels: { kind: 'not_connected', message: '채널 자료 연결 전' },
      publishing: { kind: 'not_connected', message: '게시 자료 연결 전' },
      billing: { kind: 'not_connected', message: '결제 자료 연결 전' },
      support: { kind: 'not_connected', message: '지원 기록 연결 전' },
      audit: { kind: 'not_connected', message: '감사 기록 연결 전' },
    })
  })

  it('performs the direct workspace guard before safe failure rendering', async () => {
    const view = await Page({ params: Promise.resolve({ workspaceId: '11111111-1111-4111-8111-111111111111' }) })
    expect(requireOperator).toHaveBeenCalledWith('workspace.read', '11111111-1111-4111-8111-111111111111')
    expect(JSON.stringify(view)).toContain('고객사 상세')
  })

  it('shows the authentication action when the workspace detail RPC requires MFA', async () => {
    mocks.getOperatorWorkspace.mockResolvedValueOnce({ data: null, error: 'MFA_REQUIRED' })
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ workspaceId: '11111111-1111-4111-8111-111111111111' }) }))
    expect(html).toContain('추가 인증(2단계)')
    expect(html).toContain('href="/auth/admin-setup"')
  })

  it('loads the workspace-scoped read sections only after the base workspace succeeds', async () => {
    const summary = {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      workspaceName: 'Workspace A',
      timezone: 'Asia/Seoul',
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
      lifecycleStatus: null,
      businessName: null,
      agreementStatus: 'unknown' as const,
      instagramStatus: 'unknown',
      threadsStatus: 'unknown',
      publishedThisMonth: null,
      failedThisMonth: null,
      lastActivityAt: null,
      dataFreshness: 'unknown' as const,
      memberAggregates: [],
      channels: [],
    }
    mocks.getOperatorWorkspace.mockResolvedValue({ data: summary, error: null })
    const view = await Page({ params: Promise.resolve({ workspaceId: summary.workspaceId }) })

    expect(mocks.readOperatorWorkspaceDetails).toHaveBeenCalledWith(summary.workspaceId)
    const dynamicDetail = Array.isArray(view.props.children)
      ? view.props.children.find((c: any) => c?.props?.reads)
      : view
    expect(dynamicDetail?.props?.reads).toEqual(expect.objectContaining({ billing: expect.objectContaining({ kind: 'not_connected' }) }))
  })

  it('shows a notice instead of an unverified status when the verification read fails', async () => {
    adminRead.verification = { data: null, error: { message: 'boom' } }
    const summary = { workspaceId: '11111111-1111-4111-8111-111111111111', workspaceName: 'A', availableCredits: null, businessName: null }
    mocks.getOperatorWorkspace.mockResolvedValue({ data: summary, error: null })
    const view = await Page({ params: Promise.resolve({ workspaceId: summary.workspaceId }) })
    expect(JSON.stringify(view)).toContain('사업자 심사 정보')
    adminRead.verification = { data: null, error: null }
  })

  it('resolves credit total strictly from authoritative spend balance without falling back to inflated legacy figures', () => {
    expect(resolveCreditTotal(10350)).toBe(10350)
    expect(resolveCreditTotal(null)).toBeNull()
    expect(resolveCreditTotal(undefined)).toBeNull()
  })

  it('shows LoadErrorNotice for credit balance when authoritative RPC is unavailable and never falls back to inflated figures', async () => {
    const wsId = '11111111-1111-4111-8111-111111111111'
    const summary = { workspaceId: wsId, workspaceName: '해드림', availableCredits: 12000, businessName: null }
    mocks.getOperatorWorkspace.mockResolvedValue({ data: summary, error: null })

    // Without authoritative balance RPC, view must render credit balance error notice
    const view = await Page({ params: Promise.resolve({ workspaceId: wsId }) })
    expect(JSON.stringify(view)).toContain('크레딧 잔액')
  })

  it('renders business information from signup_applications when verifications row is missing', async () => {
    const wsId = '11111111-1111-4111-8111-111111111111'
    adminRead.verification = { data: null, error: null }
    adminRead.signupApp = {
      data: {
        workspace_id: wsId,
        user_id: 'user-owner',
        company_name: '해드림물류',
        representative_name: '홍길동',
        business_number: '2208199999',
        state: 'COMPLETED',
      },
      error: null,
    }
    const summary = { workspaceId: wsId, workspaceName: '해드림', availableCredits: null, businessName: null }
    mocks.getOperatorWorkspace.mockResolvedValue({ data: summary, error: null })

    const view = await Page({ params: Promise.resolve({ workspaceId: wsId }) })
    const c360 = Array.isArray(view.props.children)
      ? view.props.children.find((c: any) => c?.props?.initialData?.workspaceId === wsId)
      : null

    expect(c360?.props?.initialData?.companyName).toBe('해드림물류')
    expect(c360?.props?.initialData?.businessNumber).toBe('2208199999')
    expect(c360?.props?.initialData?.representativeName).toBe('홍길동')
    expect(c360?.props?.initialData?.businessVerificationStatus).toBe('PENDING')
    expect(c360?.props?.verificationUnknown).toBe(false)

    const dynamicDetail = Array.isArray(view.props.children)
      ? view.props.children.find((c: any) => c?.props?.businessInfo)
      : null
    expect(dynamicDetail?.props?.businessInfo?.companyName?.value).toBe('해드림물류')
    expect(dynamicDetail?.props?.businessInfo?.businessNumber?.value).toBe('2208199999')

    adminRead.signupApp = { data: null, error: null }
  })
})
