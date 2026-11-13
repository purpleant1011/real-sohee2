import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/features/admin/preflight-queue/repository', () => ({
  createPreflightQueueGateway: vi.fn(() => ({})),
}))

vi.mock('@/features/admin/preflight-queue/service', () => ({
  loadPreflightQueue: vi.fn(async () => ({
    status: 'ok',
    total: 0,
    windowDays: 7,
    groups: [],
    trend: [],
  })),
}))

vi.mock('@/features/admin/preflight-queue/session-health', () => ({
  currentSessionHealth: vi.fn(() => [
    { channel: 'instagram', channelLabel: '인스타그램', state: 'HEALTHY', label: '정상 연결' },
  ]),
}))

import { requireOperator } from '@/features/operator-auth/require-operator'
import { loadPreflightQueue } from '@/features/admin/preflight-queue/service'
import Page from './page'

describe('AdminPreflightPage', () => {
  it('guards page with publish.read and renders header and empty notice', async () => {
    const view = await Page()
    expect(requireOperator).toHaveBeenCalledWith('publish.read')
    const html = renderToStaticMarkup(view)
    expect(html).toContain('발행 전 점검')
    expect(html).toContain('재검사 실패 건수')
    expect(html).toContain('최근 7일 동안 재검사에 실패한 콘텐츠가 없어요')
  })

  it('renders LoadErrorNotice on load failure', async () => {
    vi.mocked(loadPreflightQueue).mockResolvedValueOnce({
      status: 'error',
      message: '조회 실패',
    } as never)
    const view = await Page()
    const html = renderToStaticMarkup(view)
    expect(html).toContain('재검사 실패 큐')
    expect(html).toContain('불러오지 못했어요')
    expect(html).toContain('/admin/preflight')
  })
})
