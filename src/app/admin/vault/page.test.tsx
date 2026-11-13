import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({})),
}))

vi.mock('@/features/admin/vault-monitor/monitor', () => ({
  buildVaultMonitor: vi.fn(async () => ({
    kind: 'ok',
    observedAt: '2026-10-08T03:00:00.000Z',
    staleAfterDays: 14,
    failedWorkspaceCount: 0,
    cards: {
      stored: { value: 10, status: 'FRESH', source: 'vault_items', freshness_at: '2026-10-08T03:00:00.000Z' },
      needsReapproval: { value: 0, status: 'FRESH', source: 'vault_items', freshness_at: '2026-10-08T03:00:00.000Z' },
      invalidated: { value: 0, status: 'FRESH', source: 'vault_items', freshness_at: '2026-10-08T03:00:00.000Z' },
      violations: { value: 0, status: 'FRESH', source: 'vault_items', freshness_at: '2026-10-08T03:00:00.000Z' },
      staleHeld: { value: 0, status: 'FRESH', source: 'vault_items', freshness_at: '2026-10-08T03:00:00.000Z' },
      neglectedInvalidated: { value: 0, status: 'FRESH', source: 'vault_items', freshness_at: '2026-10-08T03:00:00.000Z' },
    },
    workspaces: [],
    violations: [],
    detailsWithheld: false,
    staleHeld: [],
    neglectedInvalidated: [],
  })),
  parseStaleAfterDays: vi.fn(() => 14),
}))

import { requireOperator } from '@/features/operator-auth/require-operator'
import Page from './page'

describe('AdminVaultPage', () => {
  it('guards page with audit.read and renders vault monitor view', async () => {
    const view = await Page()
    expect(requireOperator).toHaveBeenCalledWith('audit.read')
    const html = renderToStaticMarkup(view)
    expect(html).toContain('보관함 감시')
    expect(html).toContain('보관 건수')
    expect(html).toContain('10건')
    expect(html).toContain('출처: 보관함 기록')
    expect(html).not.toContain('vault_items')
  })
})
