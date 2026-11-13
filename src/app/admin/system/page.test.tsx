import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../../features/operator-auth/require-operator', () => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))
vi.mock('../../../features/operator-system/repository', () => ({
  getOperatorSystemObservations: vi.fn(async () => ({ data: { items: [] }, error: null })),
  getNaverPostQueueSummary: vi.fn(async () => ({
    data: { pending: 0, running: 0, failed: 0, creditReconcileNeededCount: 0 },
    error: null,
  })),
  listNaverPostDlqItems: vi.fn(async () => ({ data: [], error: null })),
}))
vi.mock('../../../features/operator-incidents/repository', () => ({
  listOperatorIncidents: vi.fn(async () => ({ data: { items: [] }, error: null })),
}))

import { requireOperator } from '../../../features/operator-auth/require-operator'
import {
  getOperatorSystemObservations,
  getNaverPostQueueSummary,
  listNaverPostDlqItems,
} from '../../../features/operator-system/repository'
import { listOperatorIncidents } from '../../../features/operator-incidents/repository'
import OperatorSystemPage from './page'

const dump = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'type' ? undefined : x))

describe('OperatorSystemPage', () => {
  it('requires system.read and shows Korean queue labels without raw enums or a fake diagnostic button', async () => {
    const html = renderToStaticMarkup(await OperatorSystemPage())
    expect(requireOperator).toHaveBeenCalledWith('system.read')
    expect(html).toContain('작업 큐')
    expect(html).toContain('네이버 블로그 발행 큐')
    expect(html).toContain('크레딧 환불 대기열 (DLQ)')
    for (const label of ['대기', '처리 중', '재시도 필요', '실패 보관']) expect(html).toContain(label)
    expect(html).not.toMatch(/진단 실행|Fail-closed|Infrastructure Nodes|HEALTHY|DEGRADED|UNKNOWN|Active/)
  })

  it('treats failed reads as unknown, never as healthy or empty', async () => {
    vi.mocked(getOperatorSystemObservations).mockResolvedValueOnce({ data: null, error: 'SYSTEM_OBSERVATION_UNAVAILABLE' })
    vi.mocked(listOperatorIncidents).mockResolvedValueOnce({ data: null, error: 'INCIDENT_READ_UNAVAILABLE' })
    vi.mocked(getNaverPostQueueSummary).mockResolvedValueOnce({ data: null, error: 'NAVER_QUEUE_READ_UNAVAILABLE' })
    vi.mocked(listNaverPostDlqItems).mockResolvedValueOnce({ data: null, error: 'NAVER_DLQ_READ_UNAVAILABLE' })
    const text = dump(await OperatorSystemPage())
    expect(text).toContain('시스템 상태')
    expect(text).toContain('장애 목록')
    expect(text).not.toContain('열려 있는 장애가 없어요')
    expect(text).not.toContain('해결되지 않은 장애가 없어요')
    expect(text).not.toContain('"정상"')
  })

  it('shows one authentication action when a system or incident RPC requires MFA', async () => {
    vi.mocked(getOperatorSystemObservations).mockResolvedValueOnce({ data: null, error: 'MFA_REQUIRED' })
    vi.mocked(listOperatorIncidents).mockResolvedValueOnce({ data: null, error: 'MFA_REQUIRED' })
    const html = renderToStaticMarkup(await OperatorSystemPage())
    expect(html).toContain('추가 인증(2단계)')
    expect(html).toContain('href="/auth/admin-setup"')
    expect(html.match(/추가 인증하러 가기/gu)).toHaveLength(1)
  })

  it('shows queue counts and open incidents when available', async () => {
    vi.mocked(getOperatorSystemObservations).mockResolvedValueOnce({
      data: { items: [{ source: 'queue', state: 'healthy', freshness: 'fresh', observedAt: '2026-10-08T01:00:00.000Z', safeCode: null, metricValue: 1, observationWindow: '24h', factKind: 'observed' }], observationWindow: '24h', queue: [{ kind: 'dead_letter', count: 4, state: 'degraded', freshness: 'fresh', observedAt: null, safeCode: null, factKind: 'observed' }] },
      error: null,
    })
    vi.mocked(listOperatorIncidents).mockResolvedValueOnce({
      data: { items: [{ id: 'i1', title: '발행 지연', severity: 'high', status: 'open', openedAt: '2026-10-08T01:00:00.000Z' }] as never }, error: null,
    })
    vi.mocked(getNaverPostQueueSummary).mockResolvedValueOnce({
      data: { pending: 1, running: 2, failed: 3, creditReconcileNeededCount: 4 },
      error: null,
    })
    vi.mocked(listNaverPostDlqItems).mockResolvedValueOnce({
      data: [
        {
          id: '11000000-0000-4000-8000-000000000001',
          workspaceId: '22000000-0000-4000-8000-000000000001',
          requestKey: '33000000-0000-4000-8000-000000000001',
          userId: '44000000-0000-4000-8000-000000000001',
          status: 'failed',
          contentId: null,
          versionId: null,
          creditReconcileNeeded: true,
          createdAt: '2026-10-14T01:00:00.000Z',
          updatedAt: '2026-10-14T01:15:00.000Z',
        },
      ],
      error: null,
    })
    const html = renderToStaticMarkup(await OperatorSystemPage())
    expect(html).toContain('작업 큐')
    expect(html).toContain('네이버 블로그 발행 큐')
    expect(html).toContain('크레딧 환불 대기열 (DLQ)')
    expect(html).toContain('수동 환불')
    expect(html).toContain('발행 지연')
    expect(html).toContain('주의 필요')
    expect(html).toContain('높음')
  })
})
