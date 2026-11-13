import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({})),
}))

vi.mock('@/features/feedback/repository', () => ({
  listFeedbackForAdmin: vi.fn(async () => ({ status: 'OK', items: [] })),
}))

import { requireOperator } from '@/features/operator-auth/require-operator'
import { listFeedbackForAdmin } from '@/features/feedback/repository'
import Page from './page'

describe('AdminFeedbackPage', () => {
  it('guards page with workspace.read and renders header and empty state when no items', async () => {
    const view = await Page()
    expect(requireOperator).toHaveBeenCalledWith('workspace.read')
    const html = renderToStaticMarkup(view)
    expect(html).toContain('고객 의견')
    expect(html).toContain('접수된 고객 의견이 없어요')
    expect(html).toContain('접수된 의견')
  })

  it('renders LoadErrorNotice on fetch failure', async () => {
    vi.mocked(listFeedbackForAdmin).mockResolvedValueOnce({ status: 'ERROR' })
    const view = await Page()
    const html = renderToStaticMarkup(view)
    expect(html).toContain('고객 의견 목록')
    expect(html).toContain('불러오지 못했어요')
    expect(html).toContain('/admin/feedback')
  })

  it('uses Korean fallbacks rather than exposing unknown feedback codes', async () => {
    vi.mocked(listFeedbackForAdmin).mockResolvedValueOnce({
      status: 'OK',
      items: [{ id: 'fb-2', workspace_id: 'a1234567-89ab-cdef-0123-456789abcdef', screen: 'dashboard', kind: 'UNMAPPED_KIND', rating: null, status: 'UNMAPPED_STATUS', message: '의견', tags: ['UNMAPPED_TAG'], content_id: null, run_id: null, admin_note: null, created_at: '2026-10-08T03:00:00.000Z' }],
    } as never)
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('기타 의견')
    expect(html).toContain('상태 미확인')
    expect(html).not.toMatch(/UNMAPPED_KIND|UNMAPPED_STATUS|UNMAPPED_TAG/)
  })

  it('renders feedback items with formatted dates and reference codes', async () => {
    vi.mocked(listFeedbackForAdmin).mockResolvedValueOnce({
      status: 'OK',
      items: [{
        id: 'fb-1',
        workspace_id: 'a1234567-89ab-cdef-0123-456789abcdef',
        screen: 'dashboard',
        kind: 'IDEA',
        rating: 5,
        status: 'NEW',
        message: '더 빠른 발행을 원해요',
        tags: ['SPEC'],
        content_id: null,
        run_id: null,
        admin_note: null,
        created_at: '2026-10-08T03:00:00.000Z',
      }],
    } as never)
    const view = await Page()
    const html = renderToStaticMarkup(view)
    expect(html).toContain('사업장 참조번호 a1234567')
    expect(html).toContain('더 빠른 발행을 원해요')
    expect(html).toContain('이런 기능이 있으면 좋겠어요')
    expect(html).toContain('평점 5점')
    expect(html).not.toContain('사업장 a1234567-89ab-cdef')
  })
})
