import { describe, expect, it } from 'vitest'
import {
  resolveApprovedFacts,
  assertFactSnapshotCurrent,
  assessFactSnapshotCurrent,
  loadApprovedFactSnapshot,
  type ApprovedFactRow,
} from './approved-fact-resolver'

const workspaceId = 'shop-a'
const old = {
  id: 'price-v1', workspace_id: workspaceId, category: 'PRICE', content: '서비스 40,000원',
  status: 'active', source_candidate_id: 'candidate-1', approved_by_user_id: 'owner',
  approved_at: '2026-10-01T00:00:00Z', valid_from: '2026-10-01T00:00:00Z',
  valid_until: null, supersedes_fact_id: null, created_at: '2026-10-01T00:00:00Z',
}
const next = { ...old, id: 'price-v2', content: '서비스 50,000원', source_candidate_id: 'candidate-2',
  valid_from: '2026-10-31T15:00:00Z', supersedes_fact_id: old.id }
const resolve = (rows: ApprovedFactRow[] = [old], at = '2026-10-30T00:00:00Z') => resolveApprovedFacts({ workspaceId, at, rows })

describe('approved fact resolver', () => {
  it('uses the old price until the Seoul effective-date boundary, then the new revision', () => {
    expect(resolve([old, next]).facts.map(f => f.id)).toEqual([old.id])
    expect(resolve([old, next], next.valid_from).facts.map(f => f.id)).toEqual([next.id])
  })
  it('keeps the old revision before a future replacement even when marked superseded', () => {
    expect(resolve([{ ...old, status: 'superseded' }, next]).facts.map(f => f.id)).toEqual([old.id])
  })
  it('excludes expired events at the exclusive upper bound', () => {
    expect(resolve([{ ...old, valid_until: '2026-10-30T00:00:00Z' }]).facts).toEqual([])
  })
  it('does not treat candidate or unapproved rows as facts', () => {
    expect(resolve([{ ...old, approved_by_user_id: '' }, { ...next, status: 'proposed' }]).facts).toEqual([])
  })
  it('never uses an approved placeholder as a business fact', () => {
    const placeholder = { ...old, id: 'template', content: '대표 메뉴는 [시그니처 메뉴]입니다.' }
    expect(resolve([old, placeholder]).facts.map(fact => fact.id)).toEqual(['price-v1'])
  })
  it('rejects cross-workspace rows rather than silently producing a mixed snapshot', () => {
    expect(() => resolve([{ ...old, workspace_id: 'shop-b' }])).toThrow('FACT_WORKSPACE_MISMATCH')
  })
  it('rejects invalid timestamps and duplicate revision IDs', () => {
    expect(() => resolve([{ ...old, valid_from: 'tomorrow' }])).toThrow()
    expect(() => resolve([old, old])).toThrow()
  })
  it('fails closed on malformed source content and cyclic replacements', () => {
    expect(() => resolve([{ ...old, content: undefined } as any])).toThrow('INVALID_FACT_ROW')
    expect(() => resolve([{ ...old, supersedes_fact_id: next.id }, next], next.valid_from)).toThrow('INVALID_FACT_LINEAGE')
  })
  it('rejects overlapping replacement branches rather than offering two prices', () => {
    const competing = { ...next, id: 'price-v3', content: '서비스 60,000원' }
    expect(() => resolve([old, next, competing], next.valid_from)).toThrow('FACT_VERSION_CONFLICT')
  })
  it('does not resurrect an old promotion when its replacement expires', () => {
    expect(resolve([old, { ...next, valid_until: '2026-11-02T00:00:00Z' }], '2026-11-03T00:00:00Z').facts).toEqual([])
  })
  it('hashes content and provenance deterministically, independent of retrieval order and time', () => {
    const location = { ...old, id: 'location', category: 'LOCATION', content: '서울' }
    expect(resolve([old, location]).hash).toBe(resolve([location, old], '2026-10-29T00:00:00Z').hash)
    expect(resolve().hash).not.toBe(resolve([{ ...old, content: '서비스 60,000원' }]).hash)
  })
  it('requires review after a price change or event expiry without mutating the prior snapshot', () => {
    const snapshot = resolve([old, next])
    const saved = JSON.stringify(snapshot)
    expect(() => assertFactSnapshotCurrent(snapshot, resolve([old, next], next.valid_from))).toThrow('FACT_SNAPSHOT_STALE')
    expect(JSON.stringify(snapshot)).toBe(saved)
    expect(() => assertFactSnapshotCurrent(snapshot, snapshot)).not.toThrow()
  })
  it('does not turn a failed database read into an empty fact set', async () => {
    const query = { select: () => query, eq: async () => ({ data: null, error: { code: 'unavailable' } }) }
    await expect(loadApprovedFactSnapshot({ from: () => query }, workspaceId)).rejects.toThrow('FACT_READ_FAILED')
  })
  it('assesses current vs review_required with exact reasons and owner review requirements', () => {
    const snapshot = resolve([old, next])
    expect(assessFactSnapshotCurrent(snapshot, snapshot)).toEqual({
      state: 'CURRENT',
      requiresOwnerReview: false,
    })
    expect(assessFactSnapshotCurrent(null, snapshot)).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'SNAPSHOT_MISSING',
    })
    expect(assessFactSnapshotCurrent(undefined, snapshot)).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'SNAPSHOT_MISSING',
    })
    const foreign = { ...snapshot, workspaceId: 'shop-b' }
    expect(assessFactSnapshotCurrent(foreign, snapshot)).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'WORKSPACE_MISMATCH',
    })
    const futureSnapshot = resolve([old, next], next.valid_from)
    expect(assessFactSnapshotCurrent(snapshot, futureSnapshot)).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'FACTS_CHANGED',
    })
    const expiredSnapshot = resolve([{ ...old, valid_until: '2026-10-30T00:00:00Z' }])
    expect(assessFactSnapshotCurrent(snapshot, expiredSnapshot)).toEqual({
      state: 'REVIEW_REQUIRED',
      requiresOwnerReview: true,
      reason: 'FACTS_CHANGED',
    })
  })
  it('requests exact count and rejects truncated or incomplete fact reads instead of hashing truncated snapshots', async () => {
    let capturedOptions: any
    const makeClient = (response: { data: any; error: any; count?: any }) => ({
      from: () => ({
        select: (_cols: string, options?: { count?: string }) => {
          capturedOptions = options
          return {
            eq: async () => response,
          }
        },
      }),
    })

    // 1. Must request { count: 'exact' }
    await loadApprovedFactSnapshot(makeClient({ data: [old], count: 1, error: null }), workspaceId)
    expect(capturedOptions).toEqual({ count: 'exact' })

    // 2. Reject truncated response: L rows returned but count is L+1 (e.g. 1000 vs 1001)
    const truncated = makeClient({ data: [old], count: 2, error: null })
    await expect(loadApprovedFactSnapshot(truncated, workspaceId)).rejects.toThrow('FACT_READ_INCOMPLETE')

    // 3. Reject count: null, undefined, negative, non-integer, unsafe
    for (const invalidCount of [null, undefined, -1, 1.5, Number.POSITIVE_INFINITY, NaN]) {
      const client = makeClient({ data: [old], count: invalidCount, error: null })
      await expect(loadApprovedFactSnapshot(client, workspaceId)).rejects.toThrow('FACT_READ_INCOMPLETE')
    }

    // 4. Accept count 0 with empty data array
    const emptyClient = makeClient({ data: [], count: 0, error: null })
    const emptySnapshot = await loadApprovedFactSnapshot(emptyClient, workspaceId)
    expect(emptySnapshot.facts).toEqual([])

    // 5. Accept exact match (count === data.length)
    const exactClient = makeClient({ data: [old], count: 1, error: null })
    const snapshot = await loadApprovedFactSnapshot(exactClient, workspaceId)
    expect(snapshot.facts.map(f => f.id)).toEqual([old.id])
  })
})
