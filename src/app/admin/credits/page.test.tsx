import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: vi.fn(async () => ({ userId: 'b7000000-0000-4000-8000-000000000001' })) }))
const list = vi.hoisted(() => vi.fn())
vi.mock('@/features/operator-credits/bulk-grant-repository', () => ({ listBulkGrantCampaigns: list }))
import Page from './page'

describe('일괄 지급 화면', () => {
  it('이전 캠페인이 없으면 실제 빈 상태와 미리보기·확인 폼을 보여준다', async () => {
    list.mockResolvedValueOnce([])
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('크레딧 일괄 지급')
    expect(html).toContain('대상 확인')
    expect(html).toContain('이전 지급 내역이 없어요')
    expect(html).not.toContain('ws-sample-')
  })
  it('이력 조회 실패를 0건으로 표시하지 않는다', async () => {
    list.mockRejectedValueOnce(new Error('db'))
    const html = renderToStaticMarkup(await Page())
    expect(html).toContain('불러오지 못했어요')
    expect(html).not.toContain('이전 지급 내역이 없어요')
  })
})
