import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/features/sohee-ready/read-model', () => ({ getSoheeReadiness: vi.fn().mockResolvedValue(null) }))
import { SOHEE_READINESS_FACT_KEYS, type SoheeReadinessSnapshot, type SoheeReadinessFactKey } from '@/features/sohee-ready/types'
import { evaluateReadiness } from '@/features/readiness'
import { computeTutorialStagesStatus } from '@/features/tutorial-journey/tutorial-journey-read-model'
import { buildQueue, computeFunnel, partitionCohort, summarizeDropoff, type CohortWorkspaceInput } from './funnel'
import { loadCohort } from './repository'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

function snapshot(done: Partial<Record<SoheeReadinessFactKey, string>>): SoheeReadinessSnapshot {
  const facts = {} as SoheeReadinessSnapshot['facts']
  for (const key of SOHEE_READINESS_FACT_KEYS) {
    const at = done[key] ?? null
    facts[key] = { key, verified: at !== null, status: at ? 'VERIFIED' : 'MISSING', source: 'test', evidenceId: null, version: null, verifiedAt: at, freshness: 'FRESH' }
  }
  return { workspaceId: 'w', ready: false, facts, blockers: [], evaluatedAt: NOW.toISOString() }
}

const base = (over: Partial<CohortWorkspaceInput>): CohortWorkspaceInput => ({
  workspaceId: 'ws', name: 'ws', createdAt: hoursAgo(200), snapshot: snapshot({}),
  firstVaultAt: null, firstPublishAt: null, firstReactionAt: null, vaultRecheckCount: 0, channelProblemCount: 0, complaintCount: 0, ...over,
})

// 시드된 5개 워크스페이스: 각기 다른 막힘 단계
const seeded: CohortWorkspaceInput[] = [
  base({ workspaceId: 'a', name: 'A 가입만', createdAt: hoursAgo(30) }),
  base({ workspaceId: 'b', name: 'B 사업자만', snapshot: snapshot({ BUSINESS_VERIFIED: hoursAgo(50) }) }),
  base({ workspaceId: 'c', name: 'C 채널까지', snapshot: snapshot({ BUSINESS_VERIFIED: hoursAgo(90), INSTAGRAM_VERIFIED: hoursAgo(10) }) }),
  base({ workspaceId: 'd', name: 'D 보관까지', snapshot: snapshot({ BUSINESS_VERIFIED: hoursAgo(90), THREADS_VERIFIED: hoursAgo(80) }), firstVaultAt: hoursAgo(5), vaultRecheckCount: 2 }),
  base({
    workspaceId: 'e', name: 'E 게시까지', snapshot: snapshot({ BUSINESS_VERIFIED: hoursAgo(90), INSTAGRAM_VERIFIED: hoursAgo(80) }),
    firstVaultAt: hoursAgo(70), firstPublishAt: hoursAgo(26),
  }),
]

describe('코호트 저장소 No False Green', () => {
  function clientFor(rows: Record<string, Record<string, unknown>[]>) {
    return { from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const query: any = {
        select: () => query, order: () => query, limit: () => query,
        in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return query },
        eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return query },
        is: (column: string, value: unknown) => { filters.push(row => row[column] === value); return query },
        gt: (column: string, value: number) => { filters.push(row => Number(row[column]) > value); return query },
        then: (resolve: (v: unknown) => void) => Promise.resolve({ data: (rows[table] ?? []).filter(row => filters.every(f => f(row))).slice(0, 1000), error: null }).then(resolve),
      }
      return query
    } }
  }

  it('삭제되지 않은 재확인/무효 승인 상태를 세고 hold_reason에 의존하지 않는다', async () => {
    const result = await loadCohort(clientFor({
      workspace_registry: [{ workspace_id: 'w', display_name: '가게', dataset_mode: 'ACTUAL', actor_kind: 'CUSTOMER', created_at: hoursAgo(1) }],
      vault_items: [
        { workspace_id: 'w', approval_state: 'NEEDS_REAPPROVAL', hold_reason: null, deleted_at: null },
        { workspace_id: 'w', approval_state: 'INVALIDATED', hold_reason: null, deleted_at: null },
        { workspace_id: 'w', approval_state: 'APPROVED', hold_reason: 'USER_HELD', deleted_at: null },
        { workspace_id: 'w', approval_state: 'NEEDS_REAPPROVAL', deleted_at: hoursAgo(1) },
      ],
    }) as any)
    if (result.status !== 'OK') throw new Error('expected ok')
    expect(result.inputs[0].vaultRecheckCount).toBe(2)
  })

  it('1000행으로 절단된 소스는 0건 또는 확정 수로 보고하지 않는다', async () => {
    const result = await loadCohort(clientFor({
      workspace_registry: [{ workspace_id: 'w', display_name: '가게', dataset_mode: 'ACTUAL', actor_kind: 'CUSTOMER', created_at: hoursAgo(1) }],
      vault_items: Array.from({ length: 1001 }, (_, i) => ({ workspace_id: 'w', created_at: hoursAgo(1000 - i), deleted_at: null, approval_state: 'APPROVED' })),
      publish_attempts: Array.from({ length: 1001 }, (_, i) => ({ workspace_id: 'w', finished_at: hoursAgo(1000 - i), status: 'succeeded' })),
      channel_metric_values: Array.from({ length: 1001 }, (_, i) => ({ workspace_id: 'w', created_at: hoursAgo(1000 - i), state: 'available', value: 1 })),
    }) as any) as any
    expect(result.inputs[0]).toMatchObject({ firstVaultAt: undefined, firstPublishAt: undefined, firstReactionAt: undefined })
  })
})

describe('코호트 퍼널 단계 판정', () => {
  const funnels = seeded.map((i) => computeFunnel(i, NOW))

  it('5개 워크스페이스가 각기 올바른 막힘 단계와 경과 시간으로 나온다', () => {
    expect(funnels.map((f) => [f.blockedStage, f.elapsedHours])).toEqual([
      ['BUSINESS_VERIFIED', 30],
      ['CHANNEL_CONNECTED', 50],
      ['FIRST_VAULT', 10],
      ['FIRST_PUBLISH', 5],
      ['FIRST_REACTION', 26],
    ])
  })

  it('24시간 이상 정체된 사람만 큐에 오르고, 재확인 필요도 함께 오른다', () => {
    const queue = buildQueue(seeded, funnels)
    expect(queue.items.map((i) => [i.workspaceId, i.reasons])).toEqual([
      ['a', ['STALLED']], ['b', ['STALLED']], ['d', ['VAULT_RECHECK']], ['e', ['STALLED']],
    ])
    expect(queue.sources.BILLING).toBe('NOT_CONNECTED')
    expect(queue.sources.COMPLAINT).toBe('OK')
  })

  it('사용자 불만이 접수된 사람은 오늘 챙길 사람에 오르고, 조회 실패는 불완전으로 표시한다', () => {
    const inputs = [base({ workspaceId: 'x', name: 'X', complaintCount: 2 })]
    const queue = buildQueue(inputs, inputs.map((i) => computeFunnel(i, NOW)))
    expect(queue.items.map((i) => i.reasons)).toContainEqual(['STALLED', 'COMPLAINT'])
    const failed = [base({ complaintCount: undefined })]
    const broken = buildQueue(failed, failed.map((i) => computeFunnel(i, NOW)))
    expect(broken.sources.COMPLAINT).toBe('ERROR')
    expect(broken.complete).toBe(false)
  })

  it('이탈 요약이 단계별 도달/멈춤 수를 센다', () => {
    const rows = summarizeDropoff(funnels)
    expect(rows.map((r) => [r.stage, r.reached, r.blockedHere])).toEqual([
      ['SIGNUP', 5, 0], ['BUSINESS_VERIFIED', 4, 1], ['CHANNEL_CONNECTED', 3, 1],
      ['FIRST_VAULT', 2, 1], ['FIRST_PUBLISH', 1, 1], ['FIRST_REACTION', 0, 1],
    ])
  })
})

describe('데이터 소스 오류는 비었음으로 보이지 않는다', () => {
  it('진행률을 읽지 못하면 단계/경과를 단정하지 않고 큐는 불완전으로 표시', () => {
    const inputs = [base({ snapshot: null })]
    const funnels = inputs.map((i) => computeFunnel(i, NOW))
    expect(funnels[0]).toMatchObject({ status: 'UNKNOWN', blockedStage: null, elapsedHours: null })
    const queue = buildQueue(inputs, funnels)
    expect(queue.items).toEqual([])
    expect(queue.complete).toBe(false)
    expect(summarizeDropoff(funnels).every((r) => r.reached === null && r.blockedHere === null)).toBe(true)
  })

  it('보관/채널 소스 실패(undefined)는 0이 아니라 ERROR', () => {
    const inputs = [base({ vaultRecheckCount: undefined, channelProblemCount: undefined })]
    const queue = buildQueue(inputs, inputs.map((i) => computeFunnel(i, NOW)))
    expect(queue.sources.VAULT_RECHECK).toBe('ERROR')
    expect(queue.sources.CHANNEL_PROBLEM).toBe('ERROR')
    expect(queue.complete).toBe(false)
  })

  it('첫 보관 소스를 읽지 못하면 보관 이후 단계를 막힘으로 단정하지 않는다', () => {
    const f = computeFunnel(base({ snapshot: snapshot({ BUSINESS_VERIFIED: hoursAgo(9), INSTAGRAM_VERIFIED: hoursAgo(8) }), firstVaultAt: undefined }), NOW)
    expect(f.status).toBe('UNKNOWN')
  })

  it('기준 시각을 모르면 경과 시간을 지어내지 않는다', () => {
    const f = computeFunnel(base({ snapshot: snapshot({ BUSINESS_VERIFIED: hoursAgo(9) }), createdAt: 'invalid' }), NOW)
    expect(f.blockedStage).toBe('CHANNEL_CONNECTED')
    expect(f.elapsedHours).toBe(9)
    const g = computeFunnel(base({ createdAt: 'invalid' }), NOW)
    expect(g.elapsedHours).toBeNull()
  })
})

describe('사용자 진행률과 같은 판정 (계약)', () => {
  const combos: Partial<Record<SoheeReadinessFactKey, string>>[] = [
    {}, { BUSINESS_VERIFIED: 'x' }, { INSTAGRAM_VERIFIED: 'x' }, { THREADS_VERIFIED: 'x' },
    { BUSINESS_VERIFIED: 'x', INSTAGRAM_VERIFIED: 'x', THREADS_VERIFIED: 'x' },
  ]
  it.each(combos.map((c, i) => [i, c] as const))('조합 %s: 사업자/채널 도달이 evaluateReadiness·tutorial stage2와 일치', (_i, facts) => {
    const snap = snapshot(Object.fromEntries(Object.entries(facts).map(([k]) => [k, '2026-10-01T00:00:00.000Z'])))
    const f = computeFunnel(base({ snapshot: snap }), NOW)
    expect(f.reach.BUSINESS_VERIFIED.state === 'REACHED').toBe(evaluateReadiness(snap).businessVerified)
    expect(f.reach.CHANNEL_CONNECTED.state === 'REACHED').toBe(computeTutorialStagesStatus(snap).stage2Done)
  })
})

describe('분류 누락은 숫자 확정 금지', () => {
  const row = (id: string, mode: string, kind: string) => ({ workspace_id: id, display_name: id, dataset_mode: mode, actor_kind: kind, created_at: hoursAgo(1) })
  it('ACTUAL+CUSTOMER만 포함, 누락이 있으면 totalConfirmed=false', () => {
    const p = partitionCohort([row('1', 'ACTUAL', 'CUSTOMER'), row('2', 'TEST', 'TESTER'), row('3', 'ACTUAL', 'UNCLASSIFIED')])
    expect(p.included.map((r) => r.workspace_id)).toEqual(['1'])
    expect(p.unclassified).toBe(1)
    expect(p.totalConfirmed).toBe(false)
    expect(partitionCohort([row('1', 'ACTUAL', 'CUSTOMER')]).totalConfirmed).toBe(true)
  })
})
