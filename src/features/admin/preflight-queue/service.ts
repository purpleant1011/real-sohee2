import { REASON_GROUP_IDS, REASON_GROUP_LABEL, reasonGroupOf, type ReasonGroupId } from './reason-groups'

export interface PreflightRunRow { id: string; workspace_id: string; vault_item_id: string; run_at: string; overall: string; items: unknown }
export interface OperatorEventRow { vault_item_id: string; event_type: string; payload: Record<string, unknown> | null; occurred_at: string }
export type OperatorEventType = 'operator.reconfirm_requested' | 'operator.memo_added' | 'operator.hold_kept'

/**
 * 좁은 포트: 읽기와 vault_events append만 가능하다. vault_items를 바꾸는 메서드는 존재하지 않는다.
 * 조회 실패는 throw로 전달되어 빈 큐와 구분된다.
 */
export interface PreflightQueueGateway {
  readRuns(sinceIso: string): Promise<PreflightRunRow[]>
  readLatestRun(workspaceId: string, vaultItemId: string): Promise<PreflightRunRow | null>
  readOperatorEvents(vaultItemIds: readonly string[]): Promise<OperatorEventRow[]>
  appendEvent(event: { workspaceId: string; vaultItemId: string; actorId: string; eventType: OperatorEventType; payload: Record<string, unknown> }): Promise<void>
}

export interface QueueReason { group: ReasonGroupId; groupLabel: string; message: string; action: string | null }
export interface QueueEntry {
  workspaceId: string; vaultItemId: string; runId: string; runAt: string
  reasons: QueueReason[]; handling: string | null; note: string | null
}
export interface QueueGroup { group: ReasonGroupId; label: string; count: number; entries: QueueEntry[] }
export interface TrendDay { date: string; counts: Record<ReasonGroupId, number> }
export type QueueResult =
  | { status: 'ok'; groups: QueueGroup[]; total: number; trend: TrendDay[]; windowDays: number }
  | { status: 'error'; message: string }

const MS_DAY = 86_400_000
const HANDLING_LABEL: Record<string, string> = {
  'operator.reconfirm_requested': '재확인 요청 기록됨', 'operator.hold_kept': '그대로 보관 유지', 'operator.memo_added': '메모 있음',
}

interface FailedReason { group: ReasonGroupId; message: string; action: string | null }
function failedReasons(items: unknown): FailedReason[] {
  if (!Array.isArray(items)) return []
  const out: FailedReason[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const check = raw as Record<string, unknown>
    if (check.status !== 'FAIL') continue // UNKNOWN은 실패가 아니라 판정 불가: 이 큐의 대상이 아니다
    out.push({
      group: reasonGroupOf(check.code),
      message: typeof check.message === 'string' ? check.message : '재검사에서 문제가 확인됐어요',
      action: typeof check.action === 'string' ? check.action : null,
    })
  }
  return out
}

const emptyCounts = (): Record<ReasonGroupId, number> =>
  Object.fromEntries([...REASON_GROUP_IDS, 'UNCLASSIFIED'].map(id => [id, 0])) as Record<ReasonGroupId, number>

export async function loadPreflightQueue(gateway: PreflightQueueGateway, options: { now?: Date; windowDays?: number } = {}): Promise<QueueResult> {
  const now = options.now ?? new Date()
  const windowDays = Math.min(Math.max(Math.trunc(options.windowDays ?? 14), 1), 90)
  try {
    const rows = await gateway.readRuns(new Date(now.getTime() - windowDays * MS_DAY).toISOString())
    const latest = new Map<string, PreflightRunRow>()
    for (const row of rows) {
      const key = `${row.workspace_id}:${row.vault_item_id}`
      const prev = latest.get(key)
      if (!prev || Date.parse(row.run_at) > Date.parse(prev.run_at)) latest.set(key, row)
    }
    const failing = [...latest.values()].filter(row => failedReasons(row.items).length > 0)
    const events = failing.length ? await gateway.readOperatorEvents(failing.map(row => row.vault_item_id)) : []
    const lastEvent = new Map<string, OperatorEventRow>()
    const lastNote = new Map<string, string>()
    for (const event of [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))) {
      lastEvent.set(event.vault_item_id, event)
      const note = event.payload?.note
      if (typeof note === 'string' && note) lastNote.set(event.vault_item_id, note)
    }
    const groups = new Map<ReasonGroupId, QueueGroup>()
    for (const row of failing.sort((a, b) => Date.parse(b.run_at) - Date.parse(a.run_at))) {
      const reasons: QueueReason[] = failedReasons(row.items).map(r => ({
        group: r.group, groupLabel: REASON_GROUP_LABEL[r.group], message: r.message, action: r.action,
      }))
      const entry: QueueEntry = {
        workspaceId: row.workspace_id, vaultItemId: row.vault_item_id, runId: row.id, runAt: row.run_at, reasons,
        handling: HANDLING_LABEL[lastEvent.get(row.vault_item_id)?.event_type ?? ''] ?? null,
        note: lastNote.get(row.vault_item_id) ?? null,
      }
      for (const group of new Set(reasons.map(r => r.group))) {
        const bucket = groups.get(group) ?? { group, label: REASON_GROUP_LABEL[group], count: 0, entries: [] }
        bucket.count += 1; bucket.entries.push(entry); groups.set(group, bucket)
      }
    }
    const ordered = ([...REASON_GROUP_IDS, 'UNCLASSIFIED'] as ReasonGroupId[]).flatMap(id => groups.get(id) ?? [])
    return { status: 'ok', groups: ordered, total: failing.length, trend: buildTrend(rows, now, windowDays), windowDays }
  } catch {
    return { status: 'error', message: '재검사 결과를 불러오지 못했어요. 빈 목록이 아니라 조회 실패예요. 잠시 뒤 다시 확인해 주세요.' }
  }
}

/** 최근 N일 사유별 건수: 재검사 실행 1회에서 같은 그룹은 1건으로 센다. */
export function buildTrend(rows: readonly PreflightRunRow[], now: Date, windowDays: number): TrendDay[] {
  const days = new Map<string, Record<ReasonGroupId, number>>()
  for (let i = windowDays - 1; i >= 0; i--) days.set(new Date(now.getTime() - i * MS_DAY).toISOString().slice(0, 10), emptyCounts())
  for (const row of rows) {
    const at = Date.parse(row.run_at)
    if (!Number.isFinite(at)) continue
    const bucket = days.get(new Date(at).toISOString().slice(0, 10))
    if (!bucket) continue
    for (const group of new Set(failedReasons(row.items).map(r => r.group))) bucket[group] += 1
  }
  return [...days].map(([date, counts]) => ({ date, counts }))
}

export type OperatorActionInput = { kind: 'request_reconfirm' | 'add_memo' | 'keep_hold'; workspaceId: string; vaultItemId: string; note: string }
export type OperatorActionResult = { ok: true } | { ok: false; message: string }

const EVENT_FOR: Record<OperatorActionInput['kind'], OperatorEventType> = {
  request_reconfirm: 'operator.reconfirm_requested', add_memo: 'operator.memo_added', keep_hold: 'operator.hold_kept',
}

/**
 * 운영자 행동은 vault_events 기록만 남긴다. 알림 발송과 승인 상태 변경은 하지 않는다.
 * 재확인 요청의 실제 안내는 이 기록을 읽는 후속 작업이 처리한다.
 */
export async function recordOperatorAction(gateway: PreflightQueueGateway, actorId: string, input: OperatorActionInput): Promise<OperatorActionResult> {
  const note = input.note.trim()
  if (note.length > 500) return { ok: false, message: '메모는 500자 이내로 적어 주세요.' }
  if (input.kind !== 'keep_hold' && note.length === 0) return { ok: false, message: '사유 메모를 입력해 주세요.' }
  try {
    const run = await gateway.readLatestRun(input.workspaceId, input.vaultItemId)
    const reasons = run ? failedReasons(run.items) : []
    if (!run || reasons.length === 0) return { ok: false, message: '재검사 실패 큐에 없는 항목이에요.' }
    await gateway.appendEvent({
      workspaceId: input.workspaceId, vaultItemId: input.vaultItemId, actorId, eventType: EVENT_FOR[input.kind],
      payload: { note, reason_groups: [...new Set(reasons.map(r => r.group))], preflight_run_id: run.id, source: 'admin_preflight_queue' },
    })
    return { ok: true }
  } catch {
    return { ok: false, message: '기록하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }
  }
}
