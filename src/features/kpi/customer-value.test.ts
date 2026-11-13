import { describe, expect, it } from 'vitest'
import { summarizeCustomerValue, type CustomerValueInput } from './customer-value'
const time = '2026-10-01T00:00:00Z'
const read = <T>(rows: T[]) => ({ state: 'OBSERVED' as const, rows, source: 'fixture-ledger', observedAt: '2026-10-09T00:00:00Z' })
function input(): CustomerValueInput {
  return { workspaceId: 'shop-a', datasetMode: 'TEST', now: '2026-10-09T00:00:00Z', window: { from: time, until: '2026-10-08T00:00:00Z' },
    journeys: read([{ id: 'journey-1', workspaceId: 'shop-a', actorId: 'owner', startedAt: time, usableAt: '2026-10-01T00:05:00Z', artifactRef: 'kit:1', usableEvidenceRef: 'usable:1', rightsConfirmed: true, copyReady: true, mediaReady: true, returns: [{ at: '2026-10-02T00:00:00Z', evidenceRef: 'return:1' }], ownerReviewMs: 2000, operatorSetupMs: null }]),
    approvals: read([{ id: 'approval-1', workspaceId: 'shop-a', taskId: 'task-1', revision: 1, fingerprint: 'approved-hash', at: time }]),
    posts: read([{ id: 'post-1', workspaceId: 'shop-a', approvalId: 'approval-1', revision: 1, fingerprint: 'approved-hash', stage: 'EXTERNALLY_VERIFIED', providerId: 'provider-1', readbackAt: time, readbackEvidenceRef: 'readback:1', url: 'https://example.com/post/1' }]),
    usefulness: read([{ id: 'useful-1', workspaceId: 'shop-a', taskId: 'task-1', completed: true, useful: true, confirmedBy: 'owner', at: time, evidenceRef: 'owner:1' }]),
    costs: read([{ id: 'receipt-1', workspaceId: 'shop-a', taskId: 'task-1', at: time, amountMinor: 250, currency: 'KRW', evidenceRef: 'receipt:1' }]),
    credits: read([{ id: 'credit-1', workspaceId: 'shop-a', taskId: 'task-1', at: time, reserved: 100, charged: 100, released: 0, evidenceRef: 'credit:1' }]),
  }
}
describe('evidence-based customer value KPI read model', () => {
  it('keeps usable-kit TTFV separate from publish time and from credits/cash cost', () => {
    const result = summarizeCustomerValue(input())
    expect(result.ttfv.value).toMatchObject({ p50Ms: 300000, p90Ms: 300000, sampleCount: 1, cohortSize: 1, withinTenMinutes: 1 })
    expect(result.publication.value).toMatchObject({ approvedCount: 1, verifiedCount: 1, ratio: 1 })
    expect(result.costs.value?.byCurrency).toEqual([{ currency: 'KRW', knownMinor: 250, totalMinor: 250, missingCount: 0, costPerVerifiedTaskMinor: 250 }])
    expect(result.credits.value).toMatchObject({ charged: 100, released: 0, unsettledCount: 0 })
    expect(result.weeklyUsefulness.value).toMatchObject({ usefulTaskCount: 1, usefulWorkspace: true })
    expect(result.return7d.value).toMatchObject({ maturedCount: 1, returnedCount: 1, ratio: 1 })
    expect(result.operatorSetup.state).toBe('PARTIAL')
  })
  it('does not count uploaded/unusable previews or incomplete journeys as TTFV', () => {
    for (const patch of [{ mediaReady: false }, { rightsConfirmed: false }, { usableEvidenceRef: '' }, { usableAt: null }]) {
      const data = input(); Object.assign(data.journeys.rows[0], patch)
      const result = summarizeCustomerValue(data)
      expect(result.ttfv.value).toMatchObject({ p50Ms: null, sampleCount: 0, cohortSize: 1, incompleteCount: 1 })
    }
  })
  it('uses declared linear percentile interpolation and counts each actor only once', () => {
    const data = input(); const row = data.journeys.rows[0]
    data.journeys.rows.push({ ...row, id: 'journey-2', actorId: 'owner-2', usableAt: '2026-10-01T00:15:00Z' }, { ...row, id: 'retry' })
    expect(summarizeCustomerValue(data).ttfv.value).toMatchObject({ p50Ms: 600000, p90Ms: 840000, sampleCount: 2, cohortSize: 2 })
  })
  it('separates genuine observed zero from a missing or failed read', () => {
    const zero = input(); zero.approvals.rows = []; zero.posts.rows = []
    expect(summarizeCustomerValue(zero).publication).toMatchObject({ state: 'NOT_APPLICABLE', value: { approvedCount: 0, verifiedCount: 0, ratio: null } })
    const missing = input(); missing.approvals = { ...read([]), state: 'MISSING' }
    expect(summarizeCustomerValue(missing).publication).toMatchObject({ state: 'MISSING', value: null })
    missing.approvals.state = 'ERROR'
    expect(summarizeCustomerValue(missing).publication.state).toBe('ERROR')
  })
  it('does not count accepted, manual, stale-revision, or unproven posts as verified', () => {
    for (const patch of [{ stage: 'PROVIDER_ACCEPTED' }, { stage: 'MANUAL' }, { revision: 2 }, { fingerprint: 'wrong' }, { readbackEvidenceRef: '' }, { providerId: '' }]) {
      const data = input(); Object.assign(data.posts.rows[0], patch)
      expect(summarizeCustomerValue(data).publication.value?.verifiedCount).toBe(0)
    }
  })
  it('deduplicates delivery, approvals and receipt retries without double counting', () => {
    const data = input(); data.posts.rows.push({ ...data.posts.rows[0], id: 'delivery-retry' }); data.costs.rows.push({ ...data.costs.rows[0] }); data.approvals.rows.push({ ...data.approvals.rows[0], id: 'approval-retry' })
    const result = summarizeCustomerValue(data)
    expect(result.publication.value?.approvedCount).toBe(1)
    expect(result.publication.value?.verifiedCount).toBe(1)
    expect(result.costs.value?.byCurrency[0].totalMinor).toBe(250)
  })
  it('retains known subtotal while keeping incomplete cost totals unknown', () => {
    const data = input(); data.costs.rows.push({ ...data.costs.rows[0], id: 'missing-cost', taskId: 'task-2', amountMinor: null, evidenceRef: '' })
    expect(summarizeCustomerValue(data).costs).toMatchObject({ state: 'PARTIAL', value: { byCurrency: [{ knownMinor: 250, totalMinor: null, missingCount: 1 }] } })
  })
  it('never converts mixed currencies or credits into a fabricated monetary total', () => {
    const data = input(); data.costs.rows.push({ ...data.costs.rows[0], id: 'usd', currency: 'USD', amountMinor: 10 })
    expect(summarizeCustomerValue(data).costs.value?.byCurrency.map(c => [c.currency, c.totalMinor])).toEqual([['KRW', 250], ['USD', 10]])
    data.credits.rows[0].charged = 40
    expect(summarizeCustomerValue(data).credits).toMatchObject({ state: 'PARTIAL', value: { unsettledCount: 1 } })
  })
  it('rejects cross-tenant rows, conflicting receipt IDs and invalid credit arithmetic', () => {
    const foreign = input(); foreign.costs.rows[0].workspaceId = 'shop-b'
    expect(() => summarizeCustomerValue(foreign)).toThrow('WORKSPACE_MISMATCH')
    const conflict = input(); conflict.costs.rows.push({ ...conflict.costs.rows[0], amountMinor: 999 })
    expect(() => summarizeCustomerValue(conflict)).toThrow('CONFLICTING_EVIDENCE')
    const credit = input(); credit.credits.rows[0].released = 1
    expect(() => summarizeCustomerValue(credit)).toThrow('INVALID_CREDIT_LEDGER')
  })
  it('does not use events beyond the observation snapshot or mature unobserved follow-up', () => {
    const data = input(); data.now = '2026-10-20T00:00:00Z'
    data.journeys.rows[0].usableAt = '2026-10-10T00:00:00Z'
    expect(summarizeCustomerValue(data).ttfv.value?.sampleCount).toBe(0)
    data.journeys.rows[0].startedAt = '2026-10-07T00:00:00Z'
    expect(summarizeCustomerValue(data).return7d.value?.maturedCount).toBe(0)
  })
  it('detects conflicting nested journey evidence, not just top-level differences', () => {
    const data = input(); data.journeys.rows.push({ ...data.journeys.rows[0], returns: [{ at: '2026-10-03T00:00:00Z', evidenceRef: 'different' }] })
    expect(() => summarizeCustomerValue(data)).toThrow('CONFLICTING_EVIDENCE')
  })
  it('keeps task-level receipt costs and flags a missing credit ledger instead of zero charge', () => {
    const data = input()
    expect(summarizeCustomerValue(data).costs.value?.tasks).toEqual([{ taskId: 'task-1', currency: 'KRW', knownMinor: 250, totalMinor: 250, missingCount: 0 }])
    data.credits.rows = []
    expect(summarizeCustomerValue(data).credits).toMatchObject({ state: 'PARTIAL', value: { missingTaskCount: 1, charged: null, knownCharged: 0 } })
  })
  it('rejects truthy non-booleans and private URLs as successful evidence', () => {
    const data = input(); Object.assign(data.journeys.rows[0], { rightsConfirmed: 'false' })
    Object.assign(data.usefulness.rows[0], { useful: 'false' })
    data.posts.rows[0].url = 'https://127.0.0.1/post'
    const result = summarizeCustomerValue(data)
    expect(result.ttfv.value?.sampleCount).toBe(0)
    expect(result.weeklyUsefulness.value?.usefulTaskCount).toBe(0)
    expect(result.publication.value?.verifiedCount).toBe(0)
  })
  it('does not count unbound task confirmations or unbound credit rows', () => {
    const data = input(); data.usefulness.rows[0].taskId = ''
    expect(summarizeCustomerValue(data).weeklyUsefulness.value?.usefulTaskCount).toBe(0)
    data.credits.rows[0].taskId = ''
    expect(() => summarizeCustomerValue(data)).toThrow('INVALID_CREDIT_LEDGER')
  })
  it('excludes right-boundary events and does not count immature retention cohorts', () => {
    const data = input(); data.approvals.rows[0].at = data.window.until; data.now = '2026-10-03T00:00:00Z'
    // Read evidence must not be from the future.
    for (const key of ['journeys', 'approvals', 'posts', 'usefulness', 'costs', 'credits'] as const) data[key].observedAt = data.now
    const result = summarizeCustomerValue(data)
    expect(result.publication.value?.approvedCount).toBe(0)
    expect(result.return7d.value).toMatchObject({ maturedCount: 0, ratio: null })
  })
})
