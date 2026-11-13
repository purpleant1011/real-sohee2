import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceList from './workspace-list'

const item = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  workspaceName: 'Workspace A',
  timezone: 'Asia/Seoul',
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  workspaceKind: 'production' as const,
  lifecycleStatus: null,
  businessName: 'Business A',
  agreementStatus: 'unknown' as const,
  planCode: null,
  memberCount: 0,
  availableCredits: null,
  instagramStatus: 'unknown',
  threadsStatus: 'unknown',
  publishedThisMonth: 0,
  failedThisMonth: 0,
  lastActivityAt: null,
  dataFreshness: 'unknown' as const,
  memberStatus: 'FORMAL' as const,
}

describe('WorkspaceList', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
  })
  it('renders an honest empty state without fake rows', () => {
    render(<WorkspaceList items={[]} nextCursor={null} query={null} status={null} />)
    expect(screen.getByText('표시할 고객사 데이터가 없습니다.')).toBeVisible()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('links the validated workspace identity and renders observed operational counts', () => {
    render(<WorkspaceList items={[item]} nextCursor={null} query={null} status={null} />)
    expect(screen.getByRole('link', { name: 'Workspace A' })).toHaveAttribute('href', '/admin/workspaces/11111111-1111-4111-8111-111111111111')
    expect(screen.getByText('정회원')).toBeVisible()
    expect(screen.getByText('0건')).toBeVisible()
    expect(screen.getByText('실패 0건')).toBeVisible()
  })

  it('exposes the design-table fields without inventing missing operational values', () => {
    render(<WorkspaceList items={[item]} nextCursor={null} query={null} status={null} />)
    expect(screen.getByRole('columnheader', { name: '고객사' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '가입·계약' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '채널' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '게시' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '크레딧' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '최근 활동' })).toBeVisible()
    expect(screen.getAllByText('확인 전').length).toBeGreaterThan(0)
    expect(screen.queryByText('0')).toBeNull()
  })
})
