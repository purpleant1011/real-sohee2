import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WeeklyCeoReportService } from '../weekly-ceo-report-service'

const date = new Date('2026-10-15T09:00:00Z')
function clientFor(results: Record<string, unknown>) {
  const filters: unknown[][] = []
  const client = {
    from: vi.fn((table: string) => {
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'gte', 'lt', 'lte', 'order', 'range', 'maybeSingle', 'in']) {
        query[method] = (...args: unknown[]) => { filters.push([table, method, ...args]); return query }
      }
      query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        const result = results[table] ?? { data: table === 'workspace_registry' ? { workspace_id: 'ws-test', dataset_mode: 'ACTUAL' } : table === 'channel_connections' ? [{ workspace_id: 'ws-test', id: 'channel-1', channel: 'instagram', status: 'connected' }] : [], error: null }
        return (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject)
      }
      return query
    }),
  }
  return { client, filters }
}

async function generate(results: Record<string, unknown> = {}) {
  const { client, filters } = clientFor(results)
  const report = await new WeeklyCeoReportService(client as never).generateReport('ws-test', date)
  return { report, filters, client }
}

describe('WeeklyCeoReportService truth contract', () => {
  it('reports observed empty data as zero without inventing savings or revenue', async () => {
    const { report } = await generate()
    expect(report.confirmedBookingsCount).toBe(0)
    expect(report.publishedPostsCount).toBe(0)
    expect(report.totalRevenueWon).toBeNull()
    expect(report.hoursSaved).toBeNull()
    expect(report.costSavedWon).toBeNull()
    expect(report.executiveSummary).not.toMatch(/160,000|350,000|창출|돌려드렸/)
  })

  it.each(['TEST', 'CANARY', 'SHOWCASE_DEMO'])('excludes %s workspaces from actual outcomes', async (mode) => {
    const { report, client } = await generate({ workspace_registry: { data: { workspace_id: 'ws-test', dataset_mode: mode }, error: null },
      reservations: { data: [{ workspace_id: 'ws-test', id: 'sample', status: 'CONFIRMED' }], error: null } })
    expect(report.datasetMode).toBe('EXCLUDED')
    expect(report.confirmedBookingsCount).toBeNull()
    expect(report.metrics.bookingConfirmed.state).toBe('NOT_OBSERVED')
    expect(client.from).not.toHaveBeenCalledWith('reservations')
  })

  it('fails closed when workspace classification is unavailable', async () => {
    const { report } = await generate({ workspace_registry: { data: null, error: { message: 'permission denied' } } })
    expect(report.confirmedBookingsCount).toBeNull()
    expect(report.metrics.bookingConfirmed.state).toBe('ERROR')
  })

  it('does not turn a missing client into observed zero', async () => {
    const report = await new WeeklyCeoReportService().generateReport('ws-test', date)
    expect(report.confirmedBookingsCount).toBeNull()
    expect(report.metrics.bookingConfirmed.state).toBe('NOT_OBSERVED')
  })

  it.each([{ data: null, error: { message: 'unavailable' } }, new Error('offline')])(
    'keeps reservation query failure distinct from empty data', async (failure) => {
      const { report } = await generate({ reservations: failure })
      expect(report.confirmedBookingsCount).toBeNull()
      expect(report.metrics.bookingConfirmed.state).toBe('ERROR')
      expect(report.metrics.verifiedPublishedPosts.value).toBe(0)
    },
  )

  it('excludes canceled and unconfirmed reservations and never treats their amounts as income', async () => {
    const { report } = await generate({ reservations: { data: [
      { workspace_id: 'ws-test', id: 'active', status: 'CONFIRMED', total_amount_krw: 90000, deposit_krw: 20000 },
      { workspace_id: 'ws-test', id: 'canceled', status: 'CANCELLED', total_amount_krw: 120000 },
      { workspace_id: 'ws-test', id: 'proposed', status: 'PROPOSED', total_amount_krw: 80000 },
    ], error: null } })
    expect(report.confirmedBookingsCount).toBe(1)
    expect(report.metrics.bookingCanceled.value).toBe(1)
    expect(report.totalRevenueWon).toBeNull()
    expect(report.metrics.paymentCapturedVerified.state).toBe('NOT_OBSERVED')
    expect(report.metrics.bookingConfirmed.evidenceIds).toEqual(['active'])
  })

  it('does not count content items or provider acceptance as verified publication', async () => {
    const { report, client } = await generate({
      content_items: { count: 20 },
      external_action_receipts: { data: [
        { workspace_id: 'ws-test', id: 'requested', receipt_kind: 'submission', provider_reference: 'post' },
        { workspace_id: 'ws-test', id: 'not-read', receipt_kind: 'observed_result', provider_reference: 'post', observed_payload: { verified: true } },
      ], error: null },
    })
    expect(report.publishedPostsCount).toBe(0)
    expect(client.from).not.toHaveBeenCalledWith('content_items')
  })

  it('deduplicates independently verified provider posts', async () => {
    const receipt = { workspace_id: 'ws-test', receipt_kind: 'observed_result', provider_reference: 'post-1',
      observed_payload: { channel: 'instagram', published_post_id: 'post-1', verified: true, read_after_write: true } }
    const { report } = await generate({ external_action_receipts: { data: [
      { ...receipt, id: 'receipt-1' }, { ...receipt, id: 'receipt-2' },
    ], error: null } })
    expect(report.publishedPostsCount).toBe(1)
    expect(report.metrics.verifiedPublishedPosts.evidenceIds).toEqual(['receipt-1'])
  })

  it('counts succeeded publish_attempts with verified permalink tracking into verifiedPublishedPosts alongside receipts without duplicate count', async () => {
    const attemptId = '40000000-0000-4000-8000-000000000001'
    const scheduleId = '50000000-0000-4000-8000-000000000001'
    const { report, filters } = await generate({
      publish_attempts: {
        data: [
          {
            workspace_id: 'ws-test',
            id: attemptId,
            schedule_id: scheduleId,
            status: 'succeeded',
            error_code: null,
            provider_request_id: 'req-123',
            provider_reference: 'ig-post-999',
            finished_at: '2026-10-14T10:02:12Z',
          },
        ],
        error: null,
      },
      schedules: {
        data: [
          {
            workspace_id: 'ws-test',
            id: scheduleId,
            channel_connection_id: 'channel-1', // 실제 스키마: channel 없고 channel_connection_id FK만 존재
          },
        ],
        error: null,
      },
      channel_connections: {
        data: [
          {
            workspace_id: 'ws-test',
            id: 'channel-1',
            channel: 'instagram',
            status: 'connected',
          },
        ],
        error: null,
      },
      social_post_tracking: {
        data: [
          {
            workspace_id: 'ws-test',
            id: 'track-1',
            publish_attempt_id: attemptId,
            destination_url: 'https://www.instagram.com/p/DA123',
          },
        ],
        error: null,
      },
    })

    // 실제 LivePublish 스키마 검증: schedules 테이블을 조회하며 선택 컬럼에 channel이 없어야 함
    const scheduleQueries = filters.filter((f) => f[0] === 'schedules')
    expect(scheduleQueries.length).toBeGreaterThan(0)
    expect(scheduleQueries.some((f) => f[1] === 'select' && String(f[2]).includes('channel_connection_id') && !String(f[2]).includes('channel,'))).toBe(true)

    expect(report.publishedPostsCount).toBe(1)
    expect(report.metrics.verifiedPublishedPosts.evidenceIds).toEqual([attemptId])
    expect(report.metrics.verifiedPublishedPosts.state).toBe('OBSERVED')
    expect(report.metrics.verifiedPublishedPosts.source).toBe('publish_attempts.finished_at/permalink_readback')
  })

  it('fails closed to ERROR when publish_attempts query fails rather than reporting false zero', async () => {
    const { report } = await generate({
      publish_attempts: { data: null, error: { message: 'db query failed' } },
    })
    expect(report.publishedPostsCount).toBeNull()
    expect(report.metrics.verifiedPublishedPosts.state).toBe('ERROR')
  })

  it('fails closed to ERROR when connections query fails while valid legacy publish_attempts exist', async () => {
    const attemptId = '40000000-0000-4000-8000-000000000001'
    const scheduleId = '50000000-0000-4000-8000-000000000001'
    const { report } = await generate({
      publish_attempts: {
        data: [
          {
            workspace_id: 'ws-test',
            id: attemptId,
            schedule_id: scheduleId,
            status: 'succeeded',
            error_code: null,
            provider_request_id: 'req-123',
            provider_reference: 'ig-post-999',
            finished_at: '2026-10-14T10:02:12Z',
          },
        ],
        error: null,
      },
      channel_connections: {
        data: null,
        error: { message: 'connections table unavailable' },
      },
    })
    expect(report.publishedPostsCount).toBeNull()
    expect(report.metrics.verifiedPublishedPosts.state).toBe('ERROR')
  })

  it('shows pending publication separately when a post receipt has no independent verification', async () => {
    const { report } = await generate({ external_action_receipts: { data: [
      { workspace_id: 'ws-test', id: 'pending', action_request_id: 'action-1', receipt_kind: 'submission', provider_reference: 'post-1',
        observed_payload: { channel: 'instagram', published_post_id: 'post-1' } },
    ], error: null } })
    expect(report.publishedPostsCount).toBe(0)
    expect(report.metrics.publicationPending.value).toBe(1)
    expect(report.executiveSummary).toContain('게시 확인 대기')
  })

  it('distinguishes no connected channel from observed social zero', async () => {
    const { report } = await generate({ channel_connections: { data: [], error: null } })
    expect(report.metrics.bookingConfirmed.value).toBe(0)
    expect(report.metrics.verifiedPublishedPosts.state).toBe('CONNECTION_REQUIRED')
    expect(report.metrics.verifiedPublishedPosts.value).toBeNull()
    expect(report.metrics.storedComments.state).toBe('CONNECTION_REQUIRED')
  })

  it('uses the same UTC daily reporting boundary by default on every surface', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-15T12:34:56Z'))
      const report = await new WeeklyCeoReportService().generateReport('ws-test')
      expect(report.period.end).toBe('2026-10-16T00:00:00.000Z')
      expect(report.period.start).toBe('2026-10-09T00:00:00.000Z')
    } finally { vi.useRealTimers() }
  })

  it('uses a tenant-scoped half-open UTC period consistently', async () => {
    const { report, filters } = await generate()
    expect(report.period).toEqual({ start: '2026-10-08T09:00:00.000Z', end: date.toISOString() })
    for (const table of ['reservations', 'external_action_receipts', 'social_comments']) {
      expect(filters).toContainEqual([table, 'eq', 'workspace_id', 'ws-test'])
      expect(filters.some(([t, op, , value]) => t === table && op === 'lt' && value === date.toISOString())).toBe(true)
    }
    expect(report.metrics.bookingConfirmed.period).toEqual(report.period)
  })
})

// ANI-1782 직접 선택 구간: 넘긴 반개구간을 그대로 읽고, 잘못된 구간은 조회 전에 거절한다.
describe('WeeklyCeoReportService direct range', () => {
  const INVALID_PERIOD = '유효한 사업장과 조회 기간이 필요합니다.'
  const NOW = new Date('2026-10-15T12:34:56Z') // 이번 주 종료 = 2026-10-16T00:00Z

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  async function generateRange(results: Record<string, unknown>, period: { start: string; end: string }) {
    const { client, filters } = clientFor(results)
    const report = await new WeeklyCeoReportService(client as never).generateRangeReport('ws-test', period)
    return { report, filters, client }
  }

  it('넘긴 반개구간을 그대로 gte/lt 조회에 쓴다', async () => {
    const period = { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' }
    const { report, filters } = await generateRange({}, period)
    expect(report.period).toEqual(period)
    expect(report.metrics.bookingConfirmed.period).toEqual(period)
    for (const [table, column] of [['reservations', 'created_at'], ['external_action_receipts', 'recorded_at'], ['social_comments', 'created_at']]) {
      expect(filters).toContainEqual([table, 'gte', column, period.start])
      expect(filters).toContainEqual([table, 'lt', column, period.end])
    }
  })

  it('1일 구간과 92일 경계는 통과하고 93일은 조회 전에 거절한다', async () => {
    await expect(generateRange({}, { start: '2026-10-15T00:00:00.000Z', end: '2026-10-16T00:00:00.000Z' })).resolves.toBeDefined()
    // 92일 = 2026-07-01 ~ 2026-09-30 (종료는 배타)
    await expect(generateRange({}, { start: '2026-07-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' })).resolves.toBeDefined()
    await expect(generateRange({}, { start: '2026-07-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' })).rejects.toThrow(INVALID_PERIOD)
  })

  it.each([
    ['역순', '2026-10-05T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    ['빈 구간', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z'],
    ['미래 종료', '2026-10-15T00:00:00.000Z', '2026-10-17T00:00:00.000Z'],
    ['시작 값 형식 오류', 'not-a-date', '2026-10-05T00:00:00.000Z'],
    ['종료 값 형식 오류', '2026-10-01T00:00:00.000Z', 'not-a-date'],
  ])('%s 구간은 조회하지 않고 거절한다', async (_label, start, end) => {
    const { client } = clientFor({})
    await expect(new WeeklyCeoReportService(client as never).generateRangeReport('ws-test', { start, end })).rejects.toThrow(INVALID_PERIOD)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('사업장 식별자가 비어 있으면 거절한다', async () => {
    await expect(new WeeklyCeoReportService().generateRangeReport(' ', { start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' }))
      .rejects.toThrow(INVALID_PERIOD)
  })

  it('기본 경로와 같은 7일 구간을 넘기면 결과가 기본 경로와 같다(리팩터링 회귀)', async () => {
    const base = await generate()
    const ranged = await generateRange({}, { start: '2026-10-08T09:00:00.000Z', end: date.toISOString() })
    expect(ranged.report).toEqual(base.report)
  })
})

describe('WeeklyCeoReportService learning hypotheses & next actions contract (ANI-1882)', () => {
  it('excludes learning-linked proposals and preserves unlinked proposals when learnings query errors', async () => {
    const { report } = await generate({
      performance_learning_candidates: { data: null, error: { message: 'db query failed' } },
      marketing_missions: {
        data: [
          {
            workspace_id: 'ws-test',
            id: 'msn-linked',
            status: 'NEXT_ACTION_READY',
            metadata: {
              learning_candidate_id: 'cand-unverified',
              next_best_action: { actionId: 'nba-linked', title: '가설 연계 제안' },
            },
          },
          {
            workspace_id: 'ws-test',
            id: 'msn-unlinked',
            status: 'NEXT_ACTION_READY',
            metadata: {
              next_best_action: { actionId: 'nba-unlinked', title: '가설 무관 일반 제안' },
            },
          },
        ],
        error: null,
      },
    })

    expect(report.learningHypothesesState).toBe('ERROR')
    expect(report.learningHypotheses).toBeNull()

    // Linked proposal must fail closed; unlinked proposal must be preserved
    expect(report.proposedNextActions).toHaveLength(1)
    expect(report.proposedNextActions![0].id).toBe('nba-unlinked')
  })

  it('excludes proposals linked to rejected or superseded candidates even if created outside report period', async () => {
    const { report } = await generate({
      performance_learning_candidates: {
        data: [
          {
            workspace_id: 'ws-test',
            id: 'cand-old-rejected',
            status: 'rejected',
            created_at: '2026-07-01T00:00:00Z', // 3 months ago (outside report period)
          },
          {
            workspace_id: 'ws-test',
            id: 'cand-old-superseded',
            status: 'superseded',
            created_at: '2026-07-01T00:00:00Z', // 3 months ago (outside report period)
          },
        ],
        error: null,
      },
      marketing_missions: {
        data: [
          {
            workspace_id: 'ws-test',
            id: 'msn-rej',
            status: 'NEXT_ACTION_READY',
            metadata: {
              learning_candidate_id: 'cand-old-rejected',
              next_best_action: { actionId: 'nba-rej', title: '과거 거절 가설 기반 제안' },
            },
          },
          {
            workspace_id: 'ws-test',
            id: 'msn-sup',
            status: 'NEXT_ACTION_READY',
            metadata: {
              learning_candidate_id: 'cand-old-superseded',
              next_best_action: { actionId: 'nba-sup', title: '과거 대체 가설 기반 제안' },
            },
          },
        ],
        error: null,
      },
    })

    expect(report.learningHypothesesState).toBe('OBSERVED')
    expect(report.learningHypotheses).toEqual([]) // None created within period
    expect(report.proposedNextActions).toHaveLength(0) // Both suppressed
  })

  it('correctly filters weekly hypotheses by period while projecting valid approved proposals', async () => {
    const { report } = await generate({
      performance_learning_candidates: {
        data: [
          {
            workspace_id: 'ws-test',
            id: 'cand-in-period-approved',
            status: 'approved',
            created_at: '2026-10-10T00:00:00Z', // inside report period (2026-10-08 ~ 2026-10-15)
            interpretation: { hypothesis: '기간 내 승인 가설' },
            observation: { evidenceRefs: ['booking:bk-1'] },
          },
          {
            workspace_id: 'ws-test',
            id: 'cand-out-period-approved',
            status: 'approved',
            created_at: '2026-07-01T00:00:00Z', // outside report period
            interpretation: { hypothesis: '기간 밖 승인 가설' },
            observation: { evidenceRefs: [] },
          },
        ],
        error: null,
      },
      marketing_missions: {
        data: [
          {
            workspace_id: 'ws-test',
            id: 'msn-in',
            status: 'NEXT_ACTION_READY',
            metadata: {
              learning_candidate_id: 'cand-in-period-approved',
              next_best_action: { actionId: 'nba-in', title: '기간 내 가설 기반 제안' },
            },
          },
          {
            workspace_id: 'ws-test',
            id: 'msn-out',
            status: 'NEXT_ACTION_READY',
            metadata: {
              learning_candidate_id: 'cand-out-period-approved',
              next_best_action: { actionId: 'nba-out', title: '기간 밖 가설 기반 제안' },
            },
          },
        ],
        error: null,
      },
    })

    expect(report.learningHypothesesState).toBe('OBSERVED')
    // Only candidate created within report period is projected in weekly hypotheses
    expect(report.learningHypotheses).toHaveLength(1)
    expect(report.learningHypotheses![0].id).toBe('cand-in-period-approved')

    // Both proposals are grounded in approved candidates, so both are validly projected
    expect(report.proposedNextActions).toHaveLength(2)
    const actionIds = report.proposedNextActions!.map((a) => a.id)
    expect(actionIds).toContain('nba-in')
    expect(actionIds).toContain('nba-out')
  })
})
