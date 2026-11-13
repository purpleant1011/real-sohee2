import { describe, expect, it } from 'vitest'
import { canExecuteApproval, metricText, selectDecisions, confirmedEmpty, approvalKey, safeReturnPath } from './selectors'

describe('mobile decision truth', () => {
  it('preserves proven zero and distinguishes missing, error and stale metrics', () => {
    const metric = { value: 0, unit: '원', state: 'ready', evidenceRef: 'payment-1', source: 'payments.ledger', datasetMode: 'ACTUAL', period: { start: '2026-10-12', end: '2026-10-19', timeZone: 'Asia/Seoul' } } as const
    expect(metricText(metric)).toBe('0원')
    expect(metricText({ ...metric, state: 'error' })).toBe('확인 불가')
    expect(metricText({ ...metric, state: 'stale' })).toBe('업데이트 필요')
    expect(metricText({ ...metric, evidenceRef: null })).toBe('근거 확인 필요')
    expect(metricText({ ...metric, datasetMode: 'TEST' })).toBe('근거 확인 필요')
    expect(metricText({ ...metric, value: null })).toBe('근거 확인 필요')
  })
  it('does not print a ready value whose source is missing or blank', () => {
    const metric = { value: 150000, unit: '원', state: 'ready', evidenceRef: 'payment-1', source: 'payments.ledger', datasetMode: 'ACTUAL', period: { start: '2026-10-12', end: '2026-10-19', timeZone: 'Asia/Seoul' } } as const
    expect(metricText(metric)).toBe('150,000원')
    expect(metricText({ ...metric, source: '   ' })).toBe('근거 확인 필요')
    expect(metricText({ ...metric, source: null })).toBe('근거 확인 필요')
    // 출처가 응답에서 통째로 빠져도 숫자로 그리지 않는다.
    expect(metricText({ ...metric, source: undefined })).toBe('근거 확인 필요')
  })
  it('requires a complete successful query before saying there is no work', () => {
    expect(confirmedEmpty({ state: 'ready', data: { items: [], total: 0, complete: true } })).toBe(true)
    expect(confirmedEmpty({ state: 'error', data: null })).toBe(false)
    expect(confirmedEmpty({ state: 'ready', data: { items: [], total: null, complete: false } })).toBe(false)
  })
  it('sorts deadline first, then creation and id without mutating input', () => {
    const items = [
      { id: 'c', createdAt: '2026-10-14T00:00:00Z', expiresAt: null },
      { id: 'b', createdAt: '2026-10-15T00:00:00Z', expiresAt: '2026-10-17T00:00:00Z' },
      { id: 'a', createdAt: '2026-10-15T00:00:00Z', expiresAt: '2026-10-16T12:00:00Z' },
      { id: 'd', createdAt: '2026-10-16T00:00:00Z', expiresAt: null },
    ]
    expect(selectDecisions(items).map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect(items.map(row => row.id)).toEqual(['c', 'b', 'a', 'd'])
  })
  it('R1 never enables writes even if draft text exists', () => {
    expect(canExecuteApproval({ writeState: 'unsupported', fullContent: 'draft' }, Date.now())).toBe(false)
    expect(canExecuteApproval({ writeState: 'ready', fullContent: 'draft' }, Date.now())).toBe(false)
  })
  it('allows only typed UUID source keys and safe app return paths', () => {
    expect(approvalKey('dm:00000000-0000-4000-8000-000000000001')).toEqual({ kind: 'dm', id: '00000000-0000-4000-8000-000000000001' })
    expect(approvalKey('comment:00000000-0000-4000-8000-000000000002')).toEqual({ kind: 'comment', id: '00000000-0000-4000-8000-000000000002' })
    expect(approvalKey('post:00000000-0000-4000-8000-000000000003')).toEqual({ kind: 'post', id: '00000000-0000-4000-8000-000000000003' })
    // content: 접두사는 구형/비지원 키이므로 null을 반환하여 잘못된 캐스팅을 방지한다
    expect(approvalKey('content:2bf4bbe2-368d-4474-ae7e-792208e2b5fe')).toBeNull()
    expect(approvalKey('recall:person')).toBeNull()
    expect(approvalKey('dm:../../secret')).toBeNull()
    expect(safeReturnPath('//evil.example')).toBe('/app')
    expect(safeReturnPath('/app/content-other')).toBe('/app')
    expect(safeReturnPath('/app/content?tab=drafts')).toBe('/app/content?tab=drafts')
  })
})
