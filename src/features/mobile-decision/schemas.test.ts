import { describe, expect, it } from 'vitest'
import { mobileHomeSchema } from './schemas'

const observedAt = '2026-10-24T01:00:00.000Z'
const ready = <T,>(data: T) => ({ state: 'ready' as const, data, observedAt, validUntil: null })

function home(result: Record<string, unknown>) {
  return {
    workspaceId: 'ws-1',
    businessName: null,
    timeZone: 'Asia/Seoul',
    generatedAt: observedAt,
    agent: ready({ label: '소희', detailHref: '/app/command' }),
    decisions: ready({ items: [], total: 0, complete: true }),
    activity: ready([]),
    results: ready([{
      id: 'revenue',
      label: '확인된 매출',
      value: 150000,
      unit: '원',
      state: 'ready',
      evidenceRef: 'payment-1',
      source: 'payments.ledger',
      datasetMode: 'ACTUAL',
      period: { start: '2026-10-17', end: '2026-10-24', timeZone: 'UTC' },
      ...result,
    }]),
  }
}

describe('mobile home schema provenance', () => {
  // Codex P2: 스키마가 source 를 선언하지 않으면 Zod 가 값을 지워 화면이 출처 없이 숫자를 그린다.
  it('keeps the metric source through client parsing', () => {
    const view = mobileHomeSchema.parse(home({}))
    expect(view.results.data?.[0]).toMatchObject({ value: 150000, source: 'payments.ledger' })
  })

  it('accepts a response without source but leaves it undefined so the display guard fails closed', () => {
    const view = mobileHomeSchema.parse(home({ source: undefined }))
    expect(view.results.data?.[0]?.source).toBeUndefined()
  })
})
