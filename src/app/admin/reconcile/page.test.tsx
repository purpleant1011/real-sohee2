import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({
    userId: '10000000-0000-4000-8000-000000000001',
    permissionScopes: [{ permission: 'publish.read', workspaceScope: 'all' }],
  })),
}))

vi.mock('@/features/admin/reconcile/repository', () => ({
  SupabaseReconcileStore: vi.fn(),
}))

vi.mock('@/features/admin/reconcile/service', () => ({
  loadReconcileQueue: vi.fn(async () => ({
    verifiedCount: 5,
    items: [],
  })),
  readableScopes: vi.fn(() => 'all'),
}))

import { requireOperator } from '@/features/operator-auth/require-operator'
import { loadReconcileQueue } from '@/features/admin/reconcile/service'
import Page from './page'

describe('AdminReconcilePage', () => {
  it('guards page with publish.read and renders header and metric tiles', async () => {
    const view = await Page()
    expect(requireOperator).toHaveBeenCalledWith('publish.read')
    const html = renderToStaticMarkup(view)
    expect(html).toContain('외부 대사')
    expect(html).toContain('확인 완료 게시')
    expect(html).toContain('5건')
    expect(html).toContain('현재 대사할 게시 기록이 없어요')
  })

  it('renders LoadErrorNotice when queue loading fails', async () => {
    vi.mocked(loadReconcileQueue).mockRejectedValueOnce(new Error('fail'))
    const view = await Page()
    const html = renderToStaticMarkup(view)
    expect(html).toContain('외부 대사 대기열')
    expect(html).toContain('불러오지 못했어요')
    expect(html).toContain('/admin/reconcile')
  })
})
