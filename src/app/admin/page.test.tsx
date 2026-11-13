import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const sourceMocks = vi.hoisted(() => ({
  workspaces: vi.fn(async () => ({ data: { items: [{ workspaceId: '48000000-0000-4000-8000-000000000001', workspaceName: '고객사 A', workspaceKind: 'production' as string, lifecycleStatus: 'active' }], nextCursor: null as string | null }, error: null as string | null })),
  lifecycle: vi.fn(async () => ({ data: [], error: null })),
  channels: vi.fn(async () => ({ data: [], error: null })),
  publishing: vi.fn(async () => ({ data: { items: [], nextCursor: null }, error: null })),
  billing: vi.fn(async () => ({ data: { items: [] as any[], summary: { state: 'empty', workspaceCount: null as number | null, sourceTimestamp: null as string | null } }, error: null })),
  audit: vi.fn(async () => ({ data: { items: [], nextCursor: null }, error: null })),
  support: vi.fn(async () => ({ data: [], error: null })),
  system: vi.fn(async () => ({ data: { items: [] as Array<{ source: string; state: string; freshness: string; observedAt: string | null; safeCode: string | null }>, observationWindow: '24h' }, error: null })),
  adminRpc: vi.fn(async () => ({ data: [{ is_formal: true }], error: null })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    rpc: sourceMocks.adminRpc,
  })),
}))

vi.mock('../../features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({
    userId: '10000000-0000-4000-8000-000000000001',
  })),
}))

vi.mock('../../features/operator-workspaces/repository', () => ({
  listOperatorWorkspaces: sourceMocks.workspaces,
}))
vi.mock('../../features/operator-workspaces/detail-read-orchestrator', () => ({
  readOperatorWorkspaceDetails: vi.fn(async () => ({
    lifecycle: { kind: 'unknown', data: null, message: '확인 전' },
    channels: { kind: 'unknown', data: null, message: '확인 전' },
    publishing: { kind: 'unknown', data: null, message: '확인 전' },
    billing: { kind: 'unknown', data: null, message: '확인 전' },
    support: { kind: 'unknown', data: null, message: '확인 전' },
    audit: { kind: 'unknown', data: null, message: '확인 전' },
  })),
}))
vi.mock('../../features/operator-onboarding/lifecycle-repository', () => ({ getOperatorOnboardingOverview: sourceMocks.lifecycle }))
vi.mock('../../features/operator-channels/repository', () => ({ listOperatorChannelConnections: sourceMocks.channels }))
vi.mock('../../features/operator-publishing/publish-read-repository', () => ({ listOperatorPublishOperations: sourceMocks.publishing }))
vi.mock('../../features/operator-billing/billing-read-repository', () => ({ listOperatorBillingOverview: sourceMocks.billing }))
vi.mock('../../features/operator-audit/audit-read-repository', () => ({ listOperatorAuditEvents: sourceMocks.audit }))
vi.mock('../../features/operator-support/support-session-repository', () => ({ listOperatorSupportSessions: sourceMocks.support }))
vi.mock('../../features/operator-system/repository', () => ({ getOperatorSystemObservations: sourceMocks.system }))

import OperatorPage from './page'
import { requireOperatorAnyScope } from '../../features/operator-auth/require-operator'

async function render() {
  return renderToStaticMarkup(await OperatorPage())
}

describe('OperatorPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('uses dashboard.read with any permitted workspace scope', async () => {
    await OperatorPage()
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('dashboard.read')
  })

  it('renders real numbers, an all-clear list and the intervention link without fake content', async () => {
    const text = await render()
    expect(text).toContain('운영 현황')
    expect(text).toContain('전체 고객사')
    expect(text).toContain('지금 확인이 필요한 일이 없어요')
    expect(text).toContain('긴급 개입 열기')
    expect(text).toContain('href="/admin/interventions"')
    expect(text).not.toMatch(/바이름|example-owner|f23209fb|V0\.4|에지 런타임|GUARDED|정상 작동|실시간 동기화|즉시 정산|Control Tower/u)
  })

  it('calls each aggregate source once', async () => {
    await render()
    for (const mock of [sourceMocks.workspaces, sourceMocks.lifecycle, sourceMocks.channels, sourceMocks.publishing, sourceMocks.billing, sourceMocks.audit, sourceMocks.support, sourceMocks.system, sourceMocks.adminRpc]) {
      expect(mock).toHaveBeenCalledTimes(1)
    }
  })

  it('shows a load error and refuses to claim all-clear when a source fails', async () => {
    sourceMocks.channels.mockResolvedValueOnce({ data: null as never, error: 'CHANNEL_LIST_UNAVAILABLE' as never })
    const text = await render()
    expect(text).toContain('role="alert"')
    expect(text).toContain('채널')
    expect(text).toContain('지금은 확인할 수 없어요')
    expect(text).not.toContain('지금 확인이 필요한 일이 없어요')
    expect(text).toContain('확인할 수 없어요')
  })

  it('surfaces a degraded system observation as an attention row', async () => {
    sourceMocks.system.mockResolvedValueOnce({ data: { items: [{ source: 'queue', state: 'degraded', freshness: 'fresh', observedAt: '2026-08-23T00:00:00.000Z', safeCode: 'QUEUE_LAG' }], observationWindow: '24h' }, error: null })
    const text = await render()
    expect(text).toContain('작업 대기열 지연')
    expect(text).not.toContain('QUEUE_LAG')
  })

  it('excludes demo workspaces from the customer count', async () => {
    sourceMocks.workspaces.mockResolvedValueOnce({
      data: { items: [
        { workspaceId: '48000000-0000-4000-8000-000000000001', workspaceName: '고객사 A', workspaceKind: 'production', lifecycleStatus: 'active' },
        { workspaceId: 'ws-demo-byreum', workspaceName: '쇼케이스', workspaceKind: 'demo', lifecycleStatus: 'active' },
      ], nextCursor: null },
      error: null,
    })
    const text = await render()
    expect(text).not.toContain('쇼케이스')
    expect(text).toMatch(/전체 고객사<\/div><div[^>]*>1</u)
  })
})
