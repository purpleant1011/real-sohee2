import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({
    userId: '10000000-0000-4000-8000-000000000001',
    permissionScopes: [{ permission: 'system.read', workspaceScope: 'all' }],
  })),
}))

vi.mock('@/features/admin/interventions/intervention-form', () => ({
  InterventionForm: () => <div>개입 폼</div>,
}))

import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import Page from './page'

describe('AdminInterventionsPage', () => {
  it('guards page with system.read and renders header and form', async () => {
    const view = await Page()
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('system.read')
    const html = renderToStaticMarkup(view)
    expect(html).toContain('긴급 개입')
    expect(html).toContain('개입 폼')
  })
})
