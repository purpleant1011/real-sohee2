import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/features/admin/cohort/repository', () => ({
  loadCohort: vi.fn(async () => ({ status: 'OK', inputs: [], unclassified: 0, totalConfirmed: true })),
}))

import { requireOperator } from '@/features/operator-auth/require-operator'
import { loadCohort } from '@/features/admin/cohort/repository'
import Page from './page'

describe('AdminCohortPage', () => {
  it('guards page with workspace.read and renders header and metrics', async () => {
    const view = await Page()
    expect(requireOperator).toHaveBeenCalledWith('workspace.read')
    const html = renderToStaticMarkup(view)
    expect(html).toContain('코호트')
    expect(html).toContain('실운영 사업장')
    expect(html).toContain('집중 케어 필요')
  })

  it('renders LoadErrorNotice on load failure', async () => {
    vi.mocked(loadCohort).mockResolvedValueOnce({ status: 'ERROR' })
    const view = await Page()
    const html = renderToStaticMarkup(view)
    expect(html).toContain('코호트 데이터')
    expect(html).toContain('불러오지 못했어요')
    expect(html).toContain('/admin/cohort')
  })
})
