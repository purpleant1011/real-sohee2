import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockListAuditEvents = vi.fn(async () => ({ data: { items: [], nextCursor: null }, error: null }))
const mockGetAuditEvent = vi.fn(async () => ({ data: null, error: null }))

vi.mock('../../../features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))
vi.mock('../../../features/operator-audit/audit-read-repository', () => ({
  listOperatorAuditEvents: () => mockListAuditEvents(),
  getOperatorAuditEvent: () => mockGetAuditEvent(),
}))
vi.mock('../../../features/operator-audit/audit-export-job-repository', () => ({
  listOperatorAuditExportJobs: vi.fn(async () => ({ data: [], error: null })),
}))

import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { AuditReadConsole } from '../../../features/operator-audit/audit-read-console'
import Page from './page'

describe('OperatorAuditPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
  })
  it('guards audit directly without importing Task 3 data and renders the audit view', async () => {
    const view = await Page()
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('audit.read')
    render(<AuditReadConsole {...view.props} />)
    expect(screen.getByRole('heading', { name: '감사 기록' })).toBeVisible()
    expect(screen.getByText('감사 이벤트 수집 전')).toBeVisible()
    expect(screen.getByText('내보내기 상태')).toBeVisible()
    expect(screen.getAllByText('자료 없음').length).toBeGreaterThan(0)
    expect(screen.getByText('변경 불가 기록')).toBeVisible()
    expect(screen.getByRole('textbox', { name: '고객사' })).toBeVisible()
    expect(screen.getByRole('button', { name: '감사 보고서 만들기' })).toBeDisabled()
  }, 15_000)

  it('surfaces detail.error when fetching event detail fails', async () => {
    mockGetAuditEvent.mockResolvedValueOnce({ data: null, error: 'AUDIT_EVENT_NOT_FOUND' as any })
    const view = await Page({ searchParams: Promise.resolve({ event: 'event-123' }) })
    render(<AuditReadConsole {...view.props} />)
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByText(/선택한 감사 상세 내역을\(를\) 불러오지 못했어요/)).toBeVisible()
  }, 15_000)

  it('renders Korean labels for fact filter enums', async () => {
    const view = await Page({ searchParams: Promise.resolve({ fact: 'observed' }) })
    render(<AuditReadConsole {...view.props} />)
    expect(screen.getByText('사실 유형 필터:')).toBeVisible()
    expect(screen.getByRole('link', { name: '실제 관측' })).toBeVisible()
    expect(screen.getByRole('link', { name: '고객 진술' })).toBeVisible()
    expect(screen.getByRole('link', { name: '추론' })).toBeVisible()
    expect(screen.getByRole('link', { name: '미확인' })).toBeVisible()
    expect(screen.getByText(/선택된 필터: 실제 관측/)).toBeVisible()
  }, 15_000)
})
