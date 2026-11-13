import { z } from 'zod'
import { inspectPublicUrl } from '@/features/local-presence/audit'

interface Row { id: string; workspaceId: string }
export interface ReadSet<T> {
  state: 'OBSERVED' | 'MISSING' | 'ERROR'
  rows: T[]
  source: string
  observedAt: string
}
interface Journey extends Row {
  actorId: string; startedAt: string; usableAt: string | null
  artifactRef: string | null; usableEvidenceRef: string | null
  rightsConfirmed: boolean; copyReady: boolean; mediaReady: boolean
  returns: { at: string; evidenceRef: string }[]
  ownerReviewMs: number | null; operatorSetupMs: number | null
}
interface Approval extends Row { taskId: string; revision: number; fingerprint: string; at: string }
interface Post extends Row {
  approvalId: string; revision: number; fingerprint: string; stage: string
  providerId: string | null; readbackAt: string | null; readbackEvidenceRef: string | null; url: string | null
}
interface Usefulness extends Row { taskId: string; completed: boolean; useful: boolean; confirmedBy: string; at: string; evidenceRef: string }
interface Cost extends Row { taskId: string; at: string; amountMinor: number | null; currency: string; evidenceRef: string }
interface Credit extends Row { taskId: string; at: string; reserved: number; charged: number; released: number; evidenceRef: string }
export interface CustomerValueInput {
  workspaceId: string; datasetMode: 'ACTUAL' | 'TEST'; now: string
  window: { from: string; until: string }
  journeys: ReadSet<Journey>; approvals: ReadSet<Approval>; posts: ReadSet<Post>
  usefulness: ReadSet<Usefulness>; costs: ReadSet<Cost>; credits: ReadSet<Credit>
}
type MetricState = ReadSet<Row>['state'] | 'PARTIAL' | 'NOT_APPLICABLE'
interface Metric<T> { state: MetricState; value: T | null; sources: string[]; observedAt: string[] }
const dateSchema = z.string().datetime({ offset: true })
function time(value: string): number {
  if (!dateSchema.safeParse(value).success) throw new Error('INVALID_KPI_TIME')
  return Date.parse(value)
}
function integer(value: number, error = 'INVALID_KPI_AMOUNT'): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(error)
  return value
}
function add(a: number, b: number): number { return integer(a + b) }
function unique<T extends Row>(rows: readonly T[]): T[] {
  const found = new Map<string, T>()
  for (const row of rows) {
    if (!row.id?.trim()) throw new Error('INVALID_EVIDENCE_ID')
    const previous = found.get(row.id)
    const stable = (value: T) => JSON.stringify(value, (_key, item: unknown) =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
    if (previous && stable(previous) !== stable(row)) throw new Error('CONFLICTING_EVIDENCE')
    found.set(row.id, row)
  }
  return [...found.values()]
}
function percentile(samples: number[], p: number): number | null {
  if (!samples.length) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const low = Math.floor(index)
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
}

/** Pure read-model calculator. No events, database rows, thresholds or provider requests are written. */
export function summarizeCustomerValue(input: CustomerValueInput) {
  if (!input.workspaceId?.trim() || !['ACTUAL', 'TEST'].includes(input.datasetMode)) throw new Error('INVALID_KPI_SCOPE')
  const now = time(input.now), from = time(input.window.from), until = time(input.window.until)
  if (from >= until || from > now) throw new Error('INVALID_KPI_WINDOW')
  const cutoff = Math.min(now, until)
  const inside = (at: string) => { const value = time(at); return value >= from && value < cutoff }
  const sets = [input.journeys, input.approvals, input.posts, input.usefulness, input.costs, input.credits]
  for (const set of sets) {
    if (!['OBSERVED', 'MISSING', 'ERROR'].includes(set.state) || !set.source?.trim() || !Array.isArray(set.rows)) throw new Error('INVALID_KPI_READ')
    if (time(set.observedAt) > now) throw new Error('FUTURE_KPI_READ')
    if (set.state !== 'OBSERVED' && set.rows.length) throw new Error('UNTRUSTED_KPI_ROWS')
    if (set.rows.some(row => row.workspaceId !== input.workspaceId)) throw new Error('WORKSPACE_MISMATCH')
    unique<Row>(set.rows)
  }
  const compute = <T>(reads: ReadSet<Row>[], calculate: () => { state?: MetricState; value: T }): Metric<T> => {
    const meta = { sources: reads.map(r => r.source), observedAt: reads.map(r => r.observedAt) }
    const unavailable = reads.some(r => r.state === 'ERROR') ? 'ERROR' : reads.some(r => r.state === 'MISSING') ? 'MISSING'
      : reads.some(r => time(r.observedAt) < cutoff) ? 'PARTIAL' : null
    if (unavailable) return { ...meta, state: unavailable, value: null }
    const result = calculate()
    return { ...meta, state: result.state ?? 'OBSERVED', value: result.value }
  }
  const allJourneys = unique(input.journeys.rows).sort((a, b) => time(a.startedAt) - time(b.startedAt) || a.id.localeCompare(b.id))
  const actors = new Set<string>()
  const journeys = allJourneys.filter(row => {
    if (!row.actorId?.trim()) throw new Error('INVALID_KPI_ACTOR')
    if (actors.has(row.actorId)) return false
    actors.add(row.actorId)
    return inside(row.startedAt)
  })
  const ttfv = compute([input.journeys], () => {
    const samples = journeys.flatMap(row => {
      if (!row.usableAt || !row.artifactRef || !row.usableEvidenceRef || row.rightsConfirmed !== true || row.copyReady !== true || row.mediaReady !== true) return []
      const duration = time(row.usableAt) - time(row.startedAt)
      return duration >= 0 && time(row.usableAt) <= Math.min(now, time(input.journeys.observedAt)) ? [duration] : []
    })
    return { state: !journeys.length ? 'NOT_APPLICABLE' as const : samples.length < journeys.length ? 'PARTIAL' as const : 'OBSERVED' as const,
      value: { cohortSize: journeys.length, sampleCount: samples.length, incompleteCount: journeys.length - samples.length,
        p50Ms: percentile(samples, 0.5), p90Ms: percentile(samples, 0.9), withinTenMinutes: samples.filter(ms => ms <= 600000).length,
        percentileMethod: 'LINEAR_TYPE_7' as const } }
  })
  const approvalGroups = new Map<string, Approval>()
  const alias = new Map<string, string>()
  for (const row of unique(input.approvals.rows).sort((a, b) => time(a.at) - time(b.at))) {
    integer(row.revision)
    if (!row.taskId?.trim() || !row.fingerprint?.trim() || row.revision < 1) throw new Error('INVALID_APPROVAL_EVIDENCE')
    const key = JSON.stringify([row.taskId, row.revision])
    const previous = approvalGroups.get(key)
    if (previous && previous.fingerprint !== row.fingerprint) throw new Error('CONFLICTING_APPROVAL')
    if (!previous) approvalGroups.set(key, row)
    alias.set(row.id, key)
  }
  const approved = [...approvalGroups.entries()].filter(([, row]) => inside(row.at))
  const approvedKeys = new Set(approved.map(([key]) => key))
  const verifiedKeys = new Set<string>()
  for (const post of unique(input.posts.rows)) {
    const key = alias.get(post.approvalId), approval = key ? approvalGroups.get(key) : undefined
    if (!key || !approvedKeys.has(key) || !approval || post.stage !== 'EXTERNALLY_VERIFIED' || !post.providerId?.trim() ||
      !post.readbackEvidenceRef?.trim() || !post.readbackAt || !post.url || post.revision !== approval.revision || post.fingerprint !== approval.fingerprint) continue
    if (inspectPublicUrl(post.url) && inside(post.readbackAt) && time(post.readbackAt) >= time(approval.at)) verifiedKeys.add(key)
  }
  const publication = compute([input.approvals, input.posts], () => ({ state: approved.length ? 'OBSERVED' : 'NOT_APPLICABLE',
    value: { approvedCount: approved.length, verifiedCount: verifiedKeys.size, ratio: approved.length ? verifiedKeys.size / approved.length : null } }))
  const weeklyUsefulness = compute([input.usefulness], () => {
    const useful = new Set(unique(input.usefulness.rows).filter(row => inside(row.at) && row.completed === true && row.useful === true && row.taskId?.trim() && row.confirmedBy?.trim() && row.evidenceRef?.trim()).map(row => row.taskId))
    return { value: { usefulTaskCount: useful.size, usefulWorkspace: useful.size > 0, attribution: 'OWNER_CONFIRMED_NOT_CAUSAL' as const } }
  })
  const return7d = compute([input.journeys], () => {
    const week = 7 * 86400000
    const matured = journeys.filter(row => time(row.startedAt) + week <= Math.min(now, time(input.journeys.observedAt)))
    const returned = matured.filter(row => row.returns.some(event => event.evidenceRef?.trim() && time(event.at) > time(row.startedAt) && time(event.at) <= time(row.startedAt) + week))
    return { state: matured.length ? 'OBSERVED' : 'NOT_APPLICABLE', value: { maturedCount: matured.length, returnedCount: returned.length, ratio: matured.length ? returned.length / matured.length : null } }
  })
  const verifiedTasks = new Set(approved.filter(([key]) => verifiedKeys.has(key)).map(([, row]) => row.taskId))
  const costs = compute([input.costs, input.approvals], () => {
    const currencies = new Map<string, { knownMinor: number; missingCount: number }>()
    const tasks = new Map<string, { taskId: string; currency: string; knownMinor: number; missingCount: number }>()
    const taskIds = new Set<string>()
    for (const row of unique(input.costs.rows).filter(row => inside(row.at))) {
      if (!/^[A-Z]{3}$/.test(row.currency) || !row.taskId?.trim()) throw new Error('INVALID_COST_EVIDENCE')
      taskIds.add(row.taskId)
      const bucket = currencies.get(row.currency) ?? { knownMinor: 0, missingCount: 0 }
      const taskKey = JSON.stringify([row.taskId, row.currency])
      const task = tasks.get(taskKey) ?? { taskId: row.taskId, currency: row.currency, knownMinor: 0, missingCount: 0 }
      if (row.amountMinor === null || !row.evidenceRef?.trim()) { bucket.missingCount++; task.missingCount++ }
      else { bucket.knownMinor = add(bucket.knownMinor, integer(row.amountMinor)); task.knownMinor = add(task.knownMinor, integer(row.amountMinor)) }
      currencies.set(row.currency, bucket)
      tasks.set(taskKey, task)
    }
    const missingTaskCount = new Set(approved.map(([, row]) => row.taskId).filter(id => !taskIds.has(id))).size
    const partial = missingTaskCount > 0 || [...currencies.values()].some(row => row.missingCount > 0)
    return { state: partial ? 'PARTIAL' : 'OBSERVED', value: { missingTaskCount,
      tasks: [...tasks.values()].sort((a, b) => a.taskId.localeCompare(b.taskId) || a.currency.localeCompare(b.currency))
        .map(task => ({ ...task, totalMinor: partial ? null : task.knownMinor })),
      byCurrency: [...currencies.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, row]) => ({ currency, ...row,
        totalMinor: partial ? null : row.knownMinor,
        costPerVerifiedTaskMinor: !partial && publication.state === 'OBSERVED' && verifiedTasks.size ? row.knownMinor / verifiedTasks.size : null })) } }
  })
  const credits = compute([input.credits, input.approvals], () => {
    let reserved = 0, charged = 0, released = 0, unsettledCount = 0
    const taskIds = new Set<string>()
    for (const row of unique(input.credits.rows).filter(row => inside(row.at))) {
      if (!row.taskId?.trim()) throw new Error('INVALID_CREDIT_LEDGER')
      taskIds.add(row.taskId)
      for (const amount of [row.reserved, row.charged, row.released]) integer(amount, 'INVALID_CREDIT_LEDGER')
      if (row.charged + row.released > row.reserved) throw new Error('INVALID_CREDIT_LEDGER')
      if (!row.evidenceRef?.trim() || row.charged + row.released < row.reserved) unsettledCount++
      reserved = add(reserved, row.reserved); charged = add(charged, row.charged); released = add(released, row.released)
    }
    const missingTaskCount = new Set(approved.map(([, row]) => row.taskId).filter(id => !taskIds.has(id))).size
    const partial = unsettledCount > 0 || missingTaskCount > 0
    return { state: partial ? 'PARTIAL' : 'OBSERVED', value: {
      reserved: partial ? null : reserved, charged: partial ? null : charged, released: partial ? null : released,
      knownReserved: reserved, knownCharged: charged, knownReleased: released,
      unsettledCount, missingTaskCount, unit: 'CREDITS_NOT_CURRENCY' as const } }
  })
  const durationMetric = (field: 'ownerReviewMs' | 'operatorSetupMs') => compute([input.journeys], () => {
    const values = journeys.map(row => row[field]).filter((value): value is number => value !== null)
    values.forEach(value => integer(value))
    return { state: values.length < journeys.length ? 'PARTIAL' : 'OBSERVED', value: { sampleCount: values.length, missingCount: journeys.length - values.length,
      knownTotalMs: values.reduce(add, 0), totalMs: values.length === journeys.length ? values.reduce(add, 0) : null } }
  })
  return { scope: { workspaceId: input.workspaceId, datasetMode: input.datasetMode, window: input.window, observedUntil: new Date(cutoff).toISOString(), calculatedAt: input.now,
    verificationLevel: 'NORMALIZED_READ_MODEL_ONLY' as const, targetThresholds: 'NOT_BASELINED' as const },
    ttfv, publication, weeklyUsefulness, return7d, costs, credits, ownerReview: durationMetric('ownerReviewMs'), operatorSetup: durationMetric('operatorSetupMs') }
}
