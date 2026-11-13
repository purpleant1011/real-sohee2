import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => ({ data: { items: [] as unknown[], nextCursor: null as string | null }, error: null })),
  registry: vi.fn(async () => [] as unknown[]),
  vault: vi.fn(async () => 0),
}))

vi.mock('../../../features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('../../../features/operator-workspaces/repository', () => ({
  listOperatorWorkspaces: mocks.list,
}))

vi.mock('../../../features/admin/same-truth/repository', () => ({
  createSameTruthGateway: () => ({ readRegistry: mocks.registry, countVault: mocks.vault }),
}))

import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import Page, { parseWorkspaceSearchParams } from './page'

describe('OperatorWorkspacesPage', () => {
  const ws = (over: Record<string, unknown> = {}) => ({
    workspaceId: '81111111-1111-4111-8111-111111111111', workspaceName: '카페 하나', businessName: '하나 커피', workspaceKind: 'production',
    lifecycleStatus: 'active', planCode: 'GROWTH_PLUS', availableCredits: 1200, instagramStatus: 'connected', threadsStatus: 'expired',
    publishedThisMonth: 7, failedThisMonth: 2, lastActivityAt: '2026-10-07T11:00:00Z', updatedAt: '2026-10-07T11:00:00Z', memberStatus: 'FORMAL', ...over,
  })

  it('guards the page directly and renders an honest empty state', async () => {
    const html = renderToStaticMarkup(await Page())
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('workspace.read')
    expect(html).toContain('표시할 고객사 데이터가 없습니다.')
    expect(html).not.toMatch(/Energy|Connectors|FREE_TASTE|4채널|DEMO|목록 갱신/u)
  })

  it('renders real rows with Korean labels, honest credits and no raw ids', async () => {
    mocks.list.mockResolvedValueOnce({ data: { items: [ws(), ws({ workspaceId: '82222222-2222-4222-8222-222222222222', workspaceName: '신규', businessName: null, availableCredits: null, planCode: null, lifecycleStatus: 'channel_pending', instagramStatus: 'unknown', threadsStatus: 'unknown', memberStatus: 'APPLICANT' })], nextCursor: 'abc' }, error: null })
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('하나 커피')
    expect(html).toContain('정회원')
    expect(html).toContain('가입자(미인증)')
    expect(html).toContain('운영 중')
    expect(html).toContain('그로스 플러스')
    expect(html).toContain('1,200 크레딧')
    expect(html).toContain('확인할 수 없어요')
    expect(html).toContain('채널 연결 대기')
    expect(html).toContain('스레드 재연결 필요')
    expect(html).toContain('연결 기록 없음')
    expect(html).toContain('실패 2건')
    expect(html).toContain('다음 페이지')
    expect(html).toContain('cursor=abc')
    expect(html).toContain('다시 불러오기')
    expect(html).not.toContain('>50<')
    expect(html).not.toMatch(/GROWTH_PLUS/u)
  })

  it('shows a load error instead of zeros when the list read fails', async () => {
    mocks.list.mockResolvedValueOnce({ data: null as never, error: 'WORKSPACE_LIST_UNAVAILABLE' } as never)
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('불러오지 못했어요')
    expect(html).not.toContain('0곳')
  })

  it('explains the additional authentication requirement for a workspace list read', async () => {
    mocks.list.mockResolvedValueOnce({ data: null as never, error: 'MFA_REQUIRED' } as never)
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('추가 인증(2단계)')
    expect(html).toContain('href="/auth/admin-setup"')
    expect(html).not.toContain('고객사 목록을(를) 불러오지 못했어요')
  })

  it('wires a GET search form with the real lifecycle and member filter', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ query: '하나', status: 'paused', member: 'formal' }) }))
    expect(html).toContain('method="get"')
    expect(html).toContain('name="query"')
    expect(html).toContain('name="status"')
    expect(html).toContain('name="member"')
    expect(html).toContain('value="ready_for_activation"')
    expect(html).toContain('정회원')
    expect(html).toContain('일시 중지')
    expect(mocks.list).toHaveBeenLastCalledWith({ cursor: null, query: '하나', status: 'paused', member: 'formal', limit: 50 })
  })

  it('strictly parses query, cursor, lifecycle status, member filter and bounded limit', () => {
    expect(parseWorkspaceSearchParams({ query: ['cafe'], limit: '50' })).toBeNull()
    expect(parseWorkspaceSearchParams({ status: 'not-a-lifecycle' })).toBeNull()
    expect(parseWorkspaceSearchParams({ member: 'invalid-filter' })).toBeNull()
    expect(parseWorkspaceSearchParams({ status: 'active' })).toEqual({ cursor: null, query: null, status: 'active', member: 'formal', limit: 50 })
    expect(parseWorkspaceSearchParams({ query: ' cafe ', limit: '20', member: 'applicant' })).toEqual({ cursor: null, query: 'cafe', status: null, member: 'applicant', limit: 20 })
  })

  it('accepts the filter form defaults and rejects statuses outside the real lifecycle', () => {
    expect(parseWorkspaceSearchParams({ status: '', query: '', member: '' })).toEqual({ cursor: null, query: null, status: null, member: 'formal', limit: 50 })
    expect(parseWorkspaceSearchParams({ status: 'suspended' })).toBeNull()
    expect(parseWorkspaceSearchParams({ status: 'ready_for_activation', member: 'all' })).toEqual({ cursor: null, query: null, status: 'ready_for_activation', member: 'all', limit: 50 })
  })
})
