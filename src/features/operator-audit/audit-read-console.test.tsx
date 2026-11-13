import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditReadConsole } from './audit-read-console'

describe('AuditReadConsole', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
  })
  it('labels a global event as 전역 운영 without inventing a workspace', () => {
    render(<AuditReadConsole error={null} events={[{
      id: '22222222-2222-4222-8222-222222222222', workspaceId: null, workspaceName: null,
      action: 'audit.export.global.requested', targetType: 'platform_audit_export', targetLabel: null,
      result: 'succeeded', factKind: 'observed', reason: '점검', approvalRequestId: null,
      approvalStatus: 'none', before: {}, after: {}, createdAt: '2026-08-23T00:00:00.000Z',
      freshness: 'fresh', linkedEventCount: 0,
    }]} />)
    expect(screen.getByText('전역 운영')).toBeVisible()
  }, 15_000)
  it('renders safe export metadata without storage path or full hash', () => {
    render(<AuditReadConsole error={null} events={[]} exportJob={{ scope: 'workspace', workspaceName: '고객사 A', period: '31일 이내', generatedAt: '확인 전', rowCount: 2, fingerprintState: '기록됨 · abcd1234', hashState: 'hash_recorded', eventChainState: 'unknown', expiresAt: '2026-08-24T00:00:00.000Z', freshness: 'fresh' }} />)
    expect(screen.getByText(/행수: 2/)).toBeVisible()
    expect(screen.getByText(/고객사: 고객사 A/)).toBeVisible()
    expect(screen.getByText(/필터 지문: 기록됨 · abcd1234/)).toBeVisible()
    expect(screen.getByText(/이벤트 체인: unknown/)).toBeVisible()
    expect(screen.queryByText(/audit\.csv|storage|sha256/u)).toBeNull()
  }, 15_000)
})
